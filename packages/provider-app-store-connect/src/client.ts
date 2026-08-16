import { createHash, createPrivateKey, sign } from "node:crypto";
import type { output, ZodTypeAny } from "zod";

export interface AppStoreConnectCredentials {
  profileName: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
  authBackend: string;
}

export type CredentialsResolver = () => Promise<AppStoreConnectCredentials | null>;

export class CredentialUnavailableError extends Error {
  constructor() {
    super("Connect an App Store Connect API key before using live mode.");
    this.name = "CredentialUnavailableError";
  }
}

interface AppleErrorItem {
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
}

export class AppStoreConnectApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly errors: AppleErrorItem[],
  ) {
    super(message);
    this.name = "AppStoreConnectApiError";
  }
}

export interface AppStoreConnectClientOptions {
  credentials: CredentialsResolver;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  expectedStatus?: number | number[];
  retry?: boolean;
}

interface CachedToken {
  credentialDigest: string;
  expiresAt: number;
  value: string;
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

const parseErrorItems = (value: unknown): AppleErrorItem[] => {
  if (!value || typeof value !== "object" || !("errors" in value) || !Array.isArray(value.errors)) return [];
  return value.errors.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    return [{
      ...(typeof item.status === "string" ? { status: item.status } : {}),
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    }];
  });
};

const retryDelay = (response: Response, attempt: number) => {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1_000, 5_000);
  return [250, 750, 1_500][attempt] ?? 1_500;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AppStoreConnectClient {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private cachedToken: CachedToken | null = null;

  constructor(private readonly options: AppStoreConnectClientOptions) {
    this.baseUrl = new URL(options.baseUrl ?? "https://api.appstoreconnect.apple.com");
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async credentials() {
    const credentials = await this.options.credentials();
    if (!credentials) throw new CredentialUnavailableError();
    return credentials;
  }

  async request<Schema extends ZodTypeAny>(
    method: string,
    path: string | URL,
    schema: Schema,
    options: RequestOptions = {},
  ): Promise<output<Schema>> {
    const response = await this.authorizedRequest(method, path, options);
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new AppStoreConnectApiError(
        "App Store Connect returned invalid JSON.",
        response.status,
        "INVALID_RESPONSE",
        response.headers.get("x-request-id"),
        [],
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const location = firstIssue?.path.length ? ` at ${firstIssue.path.join(".")}` : "";
      throw new AppStoreConnectApiError(
        `App Store Connect returned an unsupported response shape${location}.`,
        response.status,
        "INVALID_RESPONSE",
        response.headers.get("x-request-id"),
        [],
      );
    }
    return parsed.data;
  }

  async requestNoContent(method: string, path: string | URL, options: RequestOptions = {}) {
    await this.authorizedRequest(method, path, options);
  }

  async upload(operation: {
    method: string;
    url: string;
    offset: number;
    length: number;
    requestHeaders: Array<{ name: string; value: string }>;
  }, body: Buffer) {
    const url = new URL(operation.url);
    if (url.protocol !== "https:" && this.baseUrl.protocol === "https:") {
      throw new Error("App Store Connect returned an insecure asset upload URL.");
    }
    if (operation.offset < 0 || operation.length < 1 || operation.offset + operation.length > body.length) {
      throw new Error("App Store Connect returned an invalid asset upload operation.");
    }
    const headers = new Headers();
    for (const header of operation.requestHeaders) headers.set(header.name, header.value);
    const chunk = Uint8Array.from(body.subarray(operation.offset, operation.offset + operation.length));
    const response = await this.fetchImplementation(url, {
      method: operation.method,
      headers,
      body: chunk,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new AppStoreConnectApiError(
        `The screenshot upload failed with HTTP ${response.status}.`,
        response.status,
        "ASSET_UPLOAD_FAILED",
        response.headers.get("x-request-id"),
        [],
      );
    }
  }

  resolveNext(value: string) {
    const next = new URL(value, this.baseUrl);
    if (next.origin !== this.baseUrl.origin) throw new Error("App Store Connect returned an invalid pagination URL.");
    return next;
  }

  private async authorizedRequest(method: string, path: string | URL, options: RequestOptions) {
    const url = path instanceof URL ? path : new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) throw new Error("Refusing to send App Store Connect credentials to another origin.");
    const expectedStatuses = Array.isArray(options.expectedStatus)
      ? options.expectedStatus
      : [options.expectedStatus ?? (method === "POST" ? 201 : method === "DELETE" ? 204 : method === "PATCH" ? 200 : 200)];
    const mayRetry = options.retry ?? method === "GET";
    for (let attempt = 0; attempt < (mayRetry ? 3 : 1); attempt += 1) {
      const token = await this.token();
      const headers = new Headers({
        accept: "application/json",
        authorization: `Bearer ${token}`,
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
      if (expectedStatuses.includes(response.status)) return response;
      if (mayRetry && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel().catch(() => undefined);
        await wait(retryDelay(response, attempt));
        continue;
      }
      const payload = await response.json().catch(() => null) as unknown;
      const errors = parseErrorItems(payload);
      const first = errors[0];
      const message = first?.detail ?? first?.title ?? `App Store Connect request failed with HTTP ${response.status}.`;
      throw new AppStoreConnectApiError(
        message,
        response.status,
        first?.code ?? "REQUEST_FAILED",
        response.headers.get("x-request-id"),
        errors,
      );
    }
    throw new Error("App Store Connect request retry loop ended unexpectedly.");
  }

  private async token() {
    const credentials = await this.credentials();
    const credentialDigest = createHash("sha256")
      .update(credentials.issuerId)
      .update("\0")
      .update(credentials.keyId)
      .update("\0")
      .update(credentials.privateKey)
      .digest("hex");
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (
      this.cachedToken
      && this.cachedToken.credentialDigest === credentialDigest
      && this.cachedToken.expiresAt - nowSeconds > 60
    ) return this.cachedToken.value;

    const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
    const expiresAt = nowSeconds + 10 * 60;
    const payload = base64url(JSON.stringify({
      iss: credentials.issuerId,
      iat: nowSeconds - 5,
      exp: expiresAt,
      aud: "appstoreconnect-v1",
    }));
    const signingInput = `${header}.${payload}`;
    let key;
    try {
      key = createPrivateKey(credentials.privateKey);
    } catch {
      throw new Error("The App Store Connect private key is not a valid .p8 key.");
    }
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      throw new Error("The App Store Connect private key must use the P-256 elliptic curve.");
    }
    const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
    const value = `${signingInput}.${base64url(signature)}`;
    this.cachedToken = { credentialDigest, expiresAt, value };
    return value;
  }
}
