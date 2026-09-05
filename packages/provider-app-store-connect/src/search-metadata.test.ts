import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppStoreConnectProvider } from "./index.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const harness = (options: { failKeywords?: boolean; ignoreName?: boolean; missingLocale?: boolean; ambiguous?: boolean } = {}) => {
  const shared = { type: "appInfoLocalizations", id: "shared-en", attributes: { locale: "en-US", name: "Orbit Notes", subtitle: "Capture ideas", privacyPolicyUrl: "https://example.com/privacy" } };
  const localized = { type: "appStoreVersionLocalizations", id: "version-en", attributes: { locale: "en-US", keywords: "notes,ideas", description: "Keep your thoughts together", whatsNew: "Faster sync" } };
  const writes: Array<{ path: string; attributes: Record<string, unknown> }> = [];
  let editable = true;
  const provider = new AppStoreConnectProvider({
    credentials: { profileName: "Test", issuerId: "11111111-2222-3333-4444-555555555555", keyId: "ABC123DEFG", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), authBackend: "Test" },
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (init?.method === "GET" && url.pathname === "/v1/appStoreVersions/version-1") return json({ data: { type: "appStoreVersions", id: "version-1", attributes: { platform: "IOS", versionString: "4.0.0", appVersionState: editable ? "PREPARE_FOR_SUBMISSION" : "WAITING_FOR_REVIEW" }, relationships: { app: { data: { type: "apps", id: "app-1" } } } } });
      if (init?.method === "GET" && url.pathname === "/v1/apps/app-1/appInfos") {
        // The editable record is on a later page; never use the live record's IDs.
        if (!url.searchParams.has("cursor")) return json({ data: [{ type: "appInfos", id: "live-info", attributes: { state: "READY_FOR_DISTRIBUTION" } }], links: { next: "/v1/apps/app-1/appInfos?cursor=2" } });
        return json({ data: [{ type: "appInfos", id: "editable-info", attributes: { state: "PREPARE_FOR_SUBMISSION" } }, ...(options.ambiguous ? [{ type: "appInfos", id: "other-info", attributes: { state: "PREPARE_FOR_SUBMISSION" } }] : [])], links: {} });
      }
      if (init?.method === "GET" && url.pathname === "/v1/appStoreVersions/version-1/appStoreVersionLocalizations") return json({ data: [localized], links: {} });
      if (init?.method === "GET" && ["/v1/appInfos/editable-info/appInfoLocalizations", "/v1/appInfos/live-info/appInfoLocalizations"].includes(url.pathname)) return json({ data: options.missingLocale ? [] : [shared], links: {} });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        writes.push({ path: url.pathname, attributes: body.data.attributes });
        if (url.pathname === "/v1/appInfoLocalizations/shared-en") {
          if (!options.ignoreName) Object.assign(shared.attributes, body.data.attributes);
          return json({ data: shared });
        }
        if (url.pathname === "/v1/appStoreVersionLocalizations/version-en") {
          if (options.failKeywords) return json({ errors: [{ code: "FORBIDDEN", detail: "Keywords could not be changed." }] }, 403);
          Object.assign(localized.attributes, body.data.attributes);
          return json({ data: localized });
        }
      }
      throw new Error(`Unexpected request ${init?.method} ${url}`);
    },
  });
  return { provider, shared, localized, writes, lock: () => { editable = false; } };
};

describe("App Store search metadata transport", () => {
  it("reads the editable shared record and patches only the reviewed fields on the correct resources", async () => {
    const { provider, shared, localized, writes } = harness();
    const expected = await provider.getSearchMetadata("app-1", "version-1", "en-US");
    expect(expected).toMatchObject({ appInfoId: "editable-info", appInfoLocalizationId: "shared-en", versionLocalizationId: "version-en", values: { name: "Orbit Notes", subtitle: "Capture ideas", keywords: "notes,ideas" } });
    await provider.applySearchMetadata(expected, { name: "Orbit: Notes & Tasks", subtitle: "Capture ideas", keywords: "journal,writing" });
    expect(writes).toEqual([
      { path: "/v1/appInfoLocalizations/shared-en", attributes: { name: "Orbit: Notes & Tasks" } },
      { path: "/v1/appStoreVersionLocalizations/version-en", attributes: { keywords: "journal,writing" } },
    ]);
    expect(shared.attributes.privacyPolicyUrl).toBe("https://example.com/privacy");
    expect(localized.attributes.description).toBe("Keep your thoughts together");
    expect(localized.attributes.whatsNew).toBe("Faster sync");
  });
  it("clears a subtitle without rewriting the name or release keywords", async () => {
    const { provider, writes } = harness();
    const expected = await provider.getSearchMetadata("app-1", "version-1", "en-US");
    await provider.applySearchMetadata(expected, { ...expected.values, subtitle: "" });
    expect(writes).toEqual([{ path: "/v1/appInfoLocalizations/shared-en", attributes: { subtitle: null } }]);
  });
  it.each(["shared", "keywords", "state"])("does not write when %s changes before applying", async (change) => {
    const { provider, shared, localized, writes, lock } = harness();
    const expected = await provider.getSearchMetadata("app-1", "version-1", "en-US");
    if (change === "shared") shared.attributes.name = "Changed elsewhere";
    else if (change === "keywords") localized.attributes.keywords = "fresh";
    else lock();
    await expect(provider.applySearchMetadata(expected, { ...expected.values, keywords: "journal" })).rejects.toMatchObject({ code: "SEARCH_METADATA_CHANGED" });
    expect(writes).toEqual([]);
  });
  it("reports partial failure and never retries a write", async () => {
    const { provider, shared, writes } = harness({ failKeywords: true });
    const expected = await provider.getSearchMetadata("app-1", "version-1", "en-US");
    await expect(provider.applySearchMetadata(expected, { ...expected.values, name: "Orbit Journal", keywords: "journal" })).rejects.toMatchObject({ code: "SEARCH_METADATA_APPLY_FAILED", message: expect.stringContaining("Some changes may already be saved") });
    expect(shared.attributes.name).toBe("Orbit Journal");
    expect(writes).toHaveLength(2);
  });
  it("does not report success when Apple ignores a write", async () => {
    const { provider } = harness({ ignoreName: true });
    const expected = await provider.getSearchMetadata("app-1", "version-1", "en-US");
    await expect(provider.applySearchMetadata(expected, { ...expected.values, name: "Orbit Journal" })).rejects.toMatchObject({ code: "SEARCH_METADATA_APPLY_FAILED" });
  });
  it("does not guess a missing locale or an ambiguous app information record", async () => {
    await expect(harness({ missingLocale: true }).provider.getSearchMetadata("app-1", "version-1", "en-US")).rejects.toMatchObject({ code: "SEARCH_LOCALE_MISSING" });
    await expect(harness({ ambiguous: true }).provider.getSearchMetadata("app-1", "version-1", "en-US")).rejects.toMatchObject({ code: "APP_INFO_UNAVAILABLE" });
  });
  it("rejects a version belonging to a different app", async () => {
    await expect(harness().provider.getSearchMetadata("other-app", "version-1", "en-US")).rejects.toThrow();
  });
});
