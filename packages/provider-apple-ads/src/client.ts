import { createHash, createPrivateKey, sign } from "node:crypto";
import type { output, ZodTypeAny } from "zod";
import { OAuthTokenResponseSchema } from "./schemas.js";

export interface AppleAdsCredentials {
  profileName: string;
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
  adAccountId: string;
  authBackend: string;
}

export type AppleAdsCredentialsResolver = () => Promise<AppleAdsCredentials | null>;

export class AppleAdsCredentialUnavailableError extends Error {
  constructor() {
    super("Configure an Apple Ads API key before using Apple Ads tools.");
    this.name = "AppleAdsCredentialUnavailableError";
  }
}

interface AppleAdsErrorDetail {
  code?: string;
  message?: string | null;
}

export class AppleAdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly details: AppleAdsErrorDetail[],
  ) {
    super(message);
    this.name = "AppleAdsApiError";
  }
}

export interface AppleAdsClientOptions {
  credentials: AppleAdsCredentials | AppleAdsCredentialsResolver;
  baseUrl?: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  retry?: boolean;
}

interface CachedAccessToken {
  credentialDigest: string;
  expiresAt: number;
  value: string;
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const retryDelay = (response: Response, attempt: number) => {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1_000, 5_000);
  return [250, 750, 1_500][attempt] ?? 1_500;
};

const parseError = (value: unknown) => {
  if (!value || typeof value !== "object" || !("error" in value) || !value.error || typeof value.error !== "object") {
    return { code: "REQUEST_FAILED", message: null, details: [] as AppleAdsErrorDetail[] };
  }
  const error = value.error as Record<string, unknown>;
  const details = Array.isArray(error.details)
    ? error.details.flatMap((candidate): AppleAdsErrorDetail[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const detail = candidate as Record<string, unknown>;
      return [{
        ...(typeof detail.code === "string" ? { code: detail.code } : {}),
        ...(typeof detail.message === "string" || detail.message === null ? { message: detail.message } : {}),
      }];
    })
    : [];
  return {
    code: typeof error.code === "string" ? error.code : "REQUEST_FAILED",
    message: typeof error.message === "string" ? error.message : null,
    details,
  };
};

export class AppleAdsClient {
  private readonly baseUrl: URL;
  private readonly tokenUrl: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private cachedAccessToken: CachedAccessToken | null = null;

  constructor(private readonly options: AppleAdsClientOptions) {
    this.baseUrl = new URL(options.baseUrl ?? "https://api.ads.apple.com");
    this.tokenUrl = new URL(options.tokenUrl ?? "https://appleid.apple.com/auth/oauth2/token");
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async credentials() {
    const credentials = typeof this.options.credentials === "function"
      ? await this.options.credentials()
      : this.options.credentials;
    if (!credentials) throw new AppleAdsCredentialUnavailableError();
    return credentials;
  }

  async request<Schema extends ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: Schema,
    options: RequestOptions = {},
  ): Promise<output<Schema>> {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new Error("Refusing to send Apple Ads credentials to another origin.");
    const mayRetry = options.retry ?? method === "GET";
    for (let attempt = 0; attempt < (mayRetry ? 3 : 1); attempt += 1) {
      const credentials = await this.credentials();
      const token = await this.accessToken(credentials);
      const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-ap-context": `adAccountId=${credentials.adAccountId}`,
      });
      let body: string | undefined;
      if (options.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(options.body);
      }
      const response = await this.fetchImplementation(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.ok) {
        const payload = await this.parseJson(response, "Apple Ads returned invalid JSON.");
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          const location = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
          throw new AppleAdsApiError(
            `Apple Ads returned an unsupported response shape${location}.`,
            response.status,
            "INVALID_RESPONSE",
            response.headers.get("x-request-id"),
            [],
          );
        }
        return parsed.data;
      }
      if (mayRetry && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        await wait(retryDelay(response, attempt));
        continue;
      }
      const payload = await this.parseJson(response, "Apple Ads request failed.").catch(() => null);
      const error = parseError(payload);
      const detailMessage = error.details.find((detail) => detail.message)?.message;
      throw new AppleAdsApiError(
        detailMessage ?? error.message ?? `Apple Ads request failed with HTTP ${response.status}.`,
        response.status,
        error.code,
        response.headers.get("x-request-id"),
        error.details,
      );
    }
    throw new Error("Apple Ads request retry loop ended unexpectedly.");
  }

  private async parseJson(response: Response, fallback: string) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) as unknown : null;
    } catch {
      throw new AppleAdsApiError(
        fallback,
        response.status,
        "INVALID_RESPONSE",
        response.headers.get("x-request-id"),
        [],
      );
    }
  }

  private async accessToken(credentials: AppleAdsCredentials) {
    const credentialDigest = createHash("sha256")
      .update(credentials.clientId).update("\0")
      .update(credentials.teamId).update("\0")
      .update(credentials.keyId).update("\0")
      .update(credentials.privateKey).digest("hex");
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (
      this.cachedAccessToken
      && this.cachedAccessToken.credentialDigest === credentialDigest
      && this.cachedAccessToken.expiresAt - nowSeconds > 60
    ) return this.cachedAccessToken.value;

    const clientSecret = this.clientSecret(credentials, nowSeconds);
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "searchadsorg",
    });
    const response = await this.fetchImplementation(this.tokenUrl, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = await this.parseJson(response, "Apple returned an invalid OAuth response.");
    if (!response.ok) {
      const error = parseError(payload);
      throw new AppleAdsApiError(
        error.message ?? "Apple Ads OAuth rejected the configured API credentials.",
        response.status,
        error.code,
        response.headers.get("x-request-id"),
        error.details,
      );
    }
    const parsed = OAuthTokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AppleAdsApiError(
        "Apple returned an unsupported OAuth response shape.",
        response.status,
        "INVALID_RESPONSE",
        response.headers.get("x-request-id"),
        [],
      );
    }
    const expiresAt = nowSeconds + parsed.data.expires_in;
    this.cachedAccessToken = { credentialDigest, expiresAt, value: parsed.data.access_token };
    return parsed.data.access_token;
  }

  private clientSecret(credentials: AppleAdsCredentials, nowSeconds: number) {
    const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
    const payload = base64url(JSON.stringify({
      sub: credentials.clientId,
      aud: "https://appleid.apple.com",
      iat: nowSeconds,
      exp: nowSeconds + 24 * 60 * 60,
      iss: credentials.teamId,
    }));
    const signingInput = `${header}.${payload}`;
    let key;
    try {
      key = createPrivateKey(credentials.privateKey);
    } catch {
      throw new Error("The Apple Ads private key is not a valid PEM key.");
    }
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("The Apple Ads private key must use the P-256 elliptic curve.");
    }
    const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
    return `${signingInput}.${base64url(signature)}`;
  }
}
