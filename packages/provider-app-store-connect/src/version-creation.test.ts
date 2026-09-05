import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppStoreConnectProvider } from "./index.js";
import type { CreateVersionInput } from "@asc-studio/contracts";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const input: CreateVersionInput = {
  appId: "app-1",
  platform: "IOS",
  versionString: "4.0.0",
  copyMetadataFrom: "3.8.0",
  releaseType: "MANUAL",
  excludeWhatsNew: false,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const version = (id: string, versionString: string) => ({
  type: "appStoreVersions",
  id,
  attributes: { platform: "IOS", versionString, appStoreState: "PREPARE_FOR_SUBMISSION", copyright: "2026 Example" },
});
const localization = (id: string, locale: string) => ({
  type: "appStoreVersionLocalizations",
  id,
  attributes: {
    locale,
    description: `${locale} description`,
    whatsNew: `${locale} release notes`,
    promotionalText: null as string | null,
    keywords: `${locale},example`,
    marketingUrl: null as string | null,
    supportUrl: `https://example.com/${locale}/support`,
  },
});

const harness = (options: {
  failSourceRead?: boolean;
  failLocale?: string;
  ignoreNotes?: boolean;
  existingLocales?: string[];
} = {}) => {
  const source = [localization("source-ar", "ar-SA"), localization("source-en", "en-US"), localization("source-fr", "fr-FR")];
  const target: ReturnType<typeof localization>[] = [];
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let created = false;
  const fetch = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : request.toString());
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== "GET") writes.push({ method, path: url.pathname, body });
    if (method === "GET" && url.pathname === "/v1/apps/app-1/appStoreVersions") {
      return json({ data: [version("source-version", "3.8.0"), ...(created ? [version("new-version", "4.0.0")] : [])], links: {} });
    }
    if (method === "GET" && url.pathname === "/v1/appStoreVersions/source-version/appStoreVersionLocalizations") {
      if (options.failSourceRead) return json({ errors: [{ code: "FORBIDDEN", detail: "Cannot read source metadata." }] }, 403);
      return json({ data: source, links: {} });
    }
    if (method === "POST" && url.pathname === "/v1/appStoreVersions") {
      created = true;
      // Apple carries locales forward when it creates the version, leaving notes blank.
      for (const locale of options.existingLocales ?? ["ar-SA", "en-US"]) {
        target.push({
          ...localization(`new-${locale}`, locale),
          attributes: { ...localization("", locale).attributes, whatsNew: "", description: "Automatically inherited description", promotionalText: "Old promotion" },
        });
      }
      return json({ data: version("new-version", "4.0.0") }, 201);
    }
    if (method === "GET" && url.pathname === "/v1/appStoreVersions/new-version/appStoreVersionLocalizations") {
      // Keep the target paginated so a locale on a later page must also be updated.
      return url.searchParams.has("cursor")
        ? json({ data: target.slice(1), links: {} })
        : json({ data: target.slice(0, 1), links: { next: "/v1/appStoreVersions/new-version/appStoreVersionLocalizations?cursor=2" } });
    }
    if (method === "PATCH" && url.pathname.startsWith("/v1/appStoreVersionLocalizations/")) {
      const existing = target.find((item) => item.id === decodeURIComponent(url.pathname.split("/").at(-1)!));
      if (!existing) throw new Error("Tried to update a source localization or an unknown target.");
      if (existing.attributes.locale === options.failLocale) {
        return json({ errors: [{ code: "FORBIDDEN", detail: "Metadata access denied." }] }, 403);
      }
      expect(body.data.id).toBe(existing.id);
      expect(body.data.attributes).not.toHaveProperty("locale");
      existing.attributes = { ...existing.attributes, ...body.data.attributes, ...(options.ignoreNotes ? { whatsNew: "" } : {}) };
      return json({ data: existing });
    }
    if (method === "POST" && url.pathname === "/v1/appStoreVersionLocalizations") {
      if (target.some((item) => item.attributes.locale === body.data.attributes.locale)) {
        return json({ errors: [{ code: "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE", detail: `Entity with locale: ${body.data.attributes.locale} already exists. Try updating.` }] }, 409);
      }
      expect(body.data.relationships.appStoreVersion.data.id).toBe("new-version");
      const added = { type: "appStoreVersionLocalizations", id: `new-${body.data.attributes.locale}`, attributes: body.data.attributes };
      target.push(added);
      return json({ data: added }, 201);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const provider = new AppStoreConnectProvider({
    credentials: {
      profileName: "Test",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      authBackend: "Test memory",
    },
    fetch,
  });
  return { provider, source, target, writes, isCreated: () => created };
};

describe("version creation with localized metadata", () => {
  it.each([false, true])("updates inherited locales and creates missing ones (excludeWhatsNew=%s)", async (excludeWhatsNew) => {
    const { provider, source, target, writes } = harness();
    const before = structuredClone(source);

    await expect(provider.createVersion({ ...input, excludeWhatsNew })).resolves.toMatchObject({ id: "new-version", copiedFrom: "3.8.0" });

    expect(target).toHaveLength(source.length);
    for (const original of source) {
      expect(target.find((item) => item.attributes.locale === original.attributes.locale)?.attributes).toEqual({
        ...original.attributes,
        whatsNew: excludeWhatsNew ? null : original.attributes.whatsNew,
      });
    }
    expect(source).toEqual(before);
    expect(writes.filter((item) => item.path === "/v1/appStoreVersions")).toHaveLength(1);
    expect(writes.filter((item) => item.method === "PATCH").map((item) => item.body.data.id)).toEqual(["new-ar-SA", "new-en-US"]);
    expect(writes.filter((item) => item.path === "/v1/appStoreVersionLocalizations").map((item) => item.body.data.attributes.locale)).toEqual(["fr-FR"]);
  });

  it("copies every locale when Apple returns no inherited localizations", async () => {
    const { provider, source, target } = harness({ existingLocales: [] });
    await provider.createVersion(input);
    expect(target.map((item) => item.attributes)).toEqual(source.map((item) => item.attributes));
  });

  it("does not create a version if source metadata cannot be read", async () => {
    const { provider, writes, isCreated } = harness({ failSourceRead: true });
    await expect(provider.createVersion(input)).rejects.toThrow("Cannot read source metadata.");
    expect(isCreated()).toBe(false);
    expect(writes).toEqual([]);
  });

  it("reports that the version exists when a later locale fails to copy", async () => {
    const { provider, target, writes, isCreated } = harness({ failLocale: "en-US" });
    await expect(provider.createVersion(input)).rejects.toMatchObject({
      code: "VERSION_METADATA_COPY_FAILED",
      message: expect.stringMatching(/4\.0\.0 was created.*Metadata access denied/),
    });
    expect(isCreated()).toBe(true);
    expect(target[0]?.attributes.whatsNew).toBe("ar-SA release notes");
    expect(target[1]?.attributes.whatsNew).toBe("");
    expect(writes.filter((item) => item.path === "/v1/appStoreVersions")).toHaveLength(1);
  });

  it("rejects success when Apple has not saved the copied release notes", async () => {
    const { provider, isCreated } = harness({ ignoreNotes: true });
    await expect(provider.createVersion(input)).rejects.toMatchObject({
      code: "VERSION_METADATA_COPY_FAILED",
      message: expect.stringContaining("did not save whatsNew for ar-SA"),
    });
    expect(isCreated()).toBe(true);
  });

  it("does not copy metadata when no source was requested", async () => {
    const { provider, writes } = harness({ failSourceRead: true });
    await expect(provider.createVersion({ ...input, copyMetadataFrom: null })).resolves.toMatchObject({ id: "new-version", copiedFrom: null });
    expect(writes.map((item) => item.path)).toEqual(["/v1/appStoreVersions"]);
  });
});
