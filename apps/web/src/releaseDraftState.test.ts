import type { AppStoreLocale, VersionLocalizationDraft } from "@asc-studio/contracts";
import { describe, expect, it } from "vitest";
import {
  clearReleaseDraftVersion,
  deserializeReleaseDraftState,
  emptyReleaseDraftState,
  legacyStoreListingDraftStorageKey,
  persistReleaseDraftState,
  readReleaseDraftState,
  reconcileReleaseDraftVersion,
  releaseDraftStorageKey,
  releaseDraftSummary,
  revertReleaseDraftLocale,
  serializeReleaseDraftState,
  updateReleaseDraftFields,
  type ReleaseDraftStorage,
} from "./releaseDraftState.js";

class MemoryStorage implements ReleaseDraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const localization = (
  locale: AppStoreLocale,
  overrides: Partial<VersionLocalizationDraft> = {},
): VersionLocalizationDraft => ({
  locale,
  description: `${locale} description`,
  whatsNew: `${locale} release notes`,
  promotionalText: `${locale} promotion`,
  keywords: `${locale},keywords`,
  marketingUrl: `https://example.com/${locale}/marketing`,
  supportUrl: `https://example.com/${locale}/support`,
  ...overrides,
});

describe("release draft state", () => {
  it("deserializes schema-valid drafts and keeps only known exact fields", () => {
    const draft = localization("en-US");
    const state = deserializeReleaseDraftState(JSON.stringify({
      version1: [
        { draft, fields: ["keywords", "unknown", "keywords", 42] },
        { draft: { ...draft, locale: "not-a-locale" }, fields: ["description"] },
      ],
    }));

    expect(state.draftsByVersion.get("version1")?.get("en-US")).toEqual(draft);
    expect([...state.dirtyFieldsByVersion.get("version1")?.get("en-US") ?? []]).toEqual(["keywords"]);
    expect(releaseDraftSummary(state)).toEqual({ version1: 1 });
  });

  it("migrates legacy Store Listing drafts to the app-scoped release key", () => {
    const storage = new MemoryStorage();
    const legacyKey = legacyStoreListingDraftStorageKey("app1");
    storage.setItem(legacyKey, JSON.stringify({
      version1: [{ draft: localization("fr-FR"), fields: ["description", "keywords"] }],
    }));

    const state = readReleaseDraftState("app1", storage);

    expect([...state.dirtyFieldsByVersion.get("version1")?.get("fr-FR") ?? []]).toEqual(["description", "keywords"]);
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.getItem(releaseDraftStorageKey("app1"))).not.toBeNull();
  });

  it("treats the new key as authoritative and removes stale legacy data", () => {
    const storage = new MemoryStorage();
    storage.setItem(releaseDraftStorageKey("app1"), JSON.stringify({
      current: [{ draft: localization("en-US"), fields: ["whatsNew"] }],
    }));
    storage.setItem(legacyStoreListingDraftStorageKey("app1"), JSON.stringify({
      stale: [{ draft: localization("fr-FR"), fields: ["description"] }],
    }));

    const state = readReleaseDraftState("app1", storage);

    expect([...state.draftsByVersion.keys()]).toEqual(["current"]);
    expect(storage.getItem(legacyStoreListingDraftStorageKey("app1"))).toBeNull();
  });

  it("falls back to a valid legacy draft after removing malformed current data", () => {
    const storage = new MemoryStorage();
    storage.setItem(releaseDraftStorageKey("app1"), "{broken");
    storage.setItem(legacyStoreListingDraftStorageKey("app1"), JSON.stringify({
      version1: [{ draft: localization("en-US"), fields: ["description"] }],
    }));

    expect(readReleaseDraftState("app1", storage).draftsByVersion.has("version1")).toBe(true);
    expect(storage.getItem(releaseDraftStorageKey("app1"))).not.toBe("{broken");
  });

  it("reconciles dirty fields against fresh baselines and refreshes every non-dirty value", () => {
    const enBaseline = localization("en-US");
    const frBaseline = localization("fr-FR");
    let state = updateReleaseDraftFields(emptyReleaseDraftState(), {
      versionId: "version1",
      baseline: enBaseline,
      fields: ["description", "whatsNew"],
      values: { description: "Custom description", whatsNew: "Custom notes" },
    });
    state = updateReleaseDraftFields(state, {
      versionId: "version1",
      baseline: frBaseline,
      fields: ["keywords"],
      values: { keywords: "custom,french" },
    });

    const freshEn = localization("en-US", {
      description: "Custom description",
      promotionalText: "Fresh server promotion",
    });
    const reconciled = reconcileReleaseDraftVersion(
      state,
      "version1",
      new Map([["en-US", freshEn]]),
    );

    const draft = reconciled.draftsByVersion.get("version1")?.get("en-US");
    expect(draft?.description).toBe("Custom description");
    expect(draft?.whatsNew).toBe("Custom notes");
    expect(draft?.promotionalText).toBe("Fresh server promotion");
    expect([...reconciled.dirtyFieldsByVersion.get("version1")?.get("en-US") ?? []]).toEqual(["whatsNew"]);
    expect(reconciled.draftsByVersion.get("version1")?.has("fr-FR")).toBe(false);
  });

  it("updates multiple selected fields atomically while preserving other dirty fields", () => {
    const baseline = localization("en-US");
    const first = updateReleaseDraftFields(emptyReleaseDraftState(), {
      versionId: "version1",
      baseline,
      fields: ["description"],
      values: { description: "Edited description" },
    });
    const second = updateReleaseDraftFields(first, {
      versionId: "version1",
      baseline,
      fields: ["keywords", "promotionalText"],
      values: { keywords: "adapted,terms", promotionalText: "Adapted promotion" },
    });

    expect(second.draftsByVersion.get("version1")?.get("en-US")).toMatchObject({
      description: "Edited description",
      keywords: "adapted,terms",
      promotionalText: "Adapted promotion",
    });
    expect([...second.dirtyFieldsByVersion.get("version1")?.get("en-US") ?? []]).toEqual([
      "description",
      "promotionalText",
      "keywords",
    ]);
    expect(first.draftsByVersion.get("version1")?.get("en-US")?.keywords).toBe(baseline.keywords);
  });

  it("rejects an incomplete multi-field update without changing the original state", () => {
    const state = emptyReleaseDraftState();
    expect(() => updateReleaseDraftFields(state, {
      versionId: "version1",
      baseline: localization("en-US"),
      fields: ["description", "keywords"],
      values: { description: "Only one value" },
    })).toThrow(/keywords/);
    expect(state.draftsByVersion.size).toBe(0);
  });

  it("removes reverted fields, locales, and versions without disturbing other work", () => {
    const en = localization("en-US");
    const fr = localization("fr-FR");
    let state = updateReleaseDraftFields(emptyReleaseDraftState(), {
      versionId: "version1",
      baseline: en,
      fields: ["description", "keywords"],
      values: { description: "Edited", keywords: "edited,terms" },
    });
    state = updateReleaseDraftFields(state, {
      versionId: "version1",
      baseline: fr,
      fields: ["whatsNew"],
      values: { whatsNew: "Notes en français" },
    });
    state = updateReleaseDraftFields(state, {
      versionId: "version2",
      baseline: en,
      fields: ["whatsNew"],
      values: { whatsNew: "Other version" },
    });
    state = updateReleaseDraftFields(state, {
      versionId: "version1",
      baseline: en,
      fields: ["description", "keywords"],
      values: { description: en.description, keywords: en.keywords },
    });

    expect(state.draftsByVersion.get("version1")?.has("en-US")).toBe(false);
    expect(state.draftsByVersion.get("version1")?.has("fr-FR")).toBe(true);
    state = revertReleaseDraftLocale(state, "version1", "fr-FR");
    expect(state.draftsByVersion.has("version1")).toBe(false);
    state = clearReleaseDraftVersion(state, "version2");
    expect(state.draftsByVersion.size).toBe(0);
    expect(state.dirtyFieldsByVersion.size).toBe(0);
  });

  it("persists a stable field order, round-trips, and removes empty app state", () => {
    const storage = new MemoryStorage();
    const baseline = localization("en-US");
    const state = updateReleaseDraftFields(emptyReleaseDraftState(), {
      versionId: "version1",
      baseline,
      fields: new Set(["supportUrl", "description", "whatsNew"] as const),
      values: {
        supportUrl: "https://support.example.com",
        description: "Edited",
        whatsNew: "New notes",
      },
    });

    persistReleaseDraftState("app1", state, storage);
    const raw = storage.getItem(releaseDraftStorageKey("app1"));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}").version1[0].fields).toEqual(["description", "whatsNew", "supportUrl"]);
    expect(serializeReleaseDraftState(readReleaseDraftState("app1", storage))).toBe(serializeReleaseDraftState(state));

    persistReleaseDraftState("app1", emptyReleaseDraftState(), storage);
    expect(storage.getItem(releaseDraftStorageKey("app1"))).toBeNull();
  });
});
