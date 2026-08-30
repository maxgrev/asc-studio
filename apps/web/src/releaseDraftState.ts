import type { AppStoreLocale, VersionLocalizationDraft } from "@asc-studio/contracts";
import { VersionLocalizationDraftSchema } from "@asc-studio/contracts";
import { localizationFields, type LocalizationField } from "./releaseMetadata.js";

export interface ReleaseDraftState {
  draftsByVersion: Map<string, Map<AppStoreLocale, VersionLocalizationDraft>>;
  dirtyFieldsByVersion: Map<string, Map<AppStoreLocale, Set<LocalizationField>>>;
}

export interface ReleaseDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UpdateReleaseDraftFieldsInput {
  versionId: string;
  baseline: VersionLocalizationDraft;
  fields: Iterable<LocalizationField>;
  values: Partial<Record<LocalizationField, string>>;
}

export type ReleaseDraftSummary = Record<string, number>;

export const releaseDraftStorageKey = (appId: string) => `asc-studio.release-drafts.${appId}`;
export const legacyStoreListingDraftStorageKey = (appId: string) => `asc-studio.store-listing-drafts.${appId}`;

export const emptyReleaseDraftState = (): ReleaseDraftState => ({
  draftsByVersion: new Map(),
  dirtyFieldsByVersion: new Map(),
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === "object" && !Array.isArray(value)
);

const isLocalizationField = (value: unknown): value is LocalizationField => (
  typeof value === "string" && localizationFields.includes(value as LocalizationField)
);

const canonicalDraft = (draft: VersionLocalizationDraft): VersionLocalizationDraft => ({
  locale: draft.locale,
  description: draft.description,
  whatsNew: draft.whatsNew,
  promotionalText: draft.promotionalText,
  keywords: draft.keywords,
  marketingUrl: draft.marketingUrl,
  supportUrl: draft.supportUrl,
});

interface DecodedDraftState {
  structurallyValid: boolean;
  state: ReleaseDraftState;
}

const decodeReleaseDraftState = (raw: string): DecodedDraftState => {
  const state = emptyReleaseDraftState();
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { structurallyValid: false, state };
  }
  if (!isRecord(value)) return { structurallyValid: false, state };

  for (const [versionId, entries] of Object.entries(value)) {
    if (!versionId.trim() || !Array.isArray(entries)) continue;
    const versionDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
    const versionDirtyFields = new Map<AppStoreLocale, Set<LocalizationField>>();
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const parsedDraft = VersionLocalizationDraftSchema.safeParse(entry.draft);
      if (!parsedDraft.success || !Array.isArray(entry.fields)) continue;
      const fields = new Set(entry.fields.filter(isLocalizationField));
      if (!fields.size) continue;
      versionDrafts.set(parsedDraft.data.locale, parsedDraft.data);
      versionDirtyFields.set(parsedDraft.data.locale, fields);
    }
    if (versionDrafts.size) {
      state.draftsByVersion.set(versionId, versionDrafts);
      state.dirtyFieldsByVersion.set(versionId, versionDirtyFields);
    }
  }
  return { structurallyValid: true, state };
};

export const deserializeReleaseDraftState = (raw: string): ReleaseDraftState => (
  decodeReleaseDraftState(raw).state
);

const storedDraftValue = (state: ReleaseDraftState) => Object.fromEntries(
  [...state.draftsByVersion.entries()].flatMap(([versionId, drafts]) => {
    const dirtyFields = state.dirtyFieldsByVersion.get(versionId);
    const entries = [...drafts.entries()].flatMap(([, draft]) => {
      const fields = dirtyFields?.get(draft.locale);
      const orderedFields = fields ? localizationFields.filter((field) => fields.has(field)) : [];
      return orderedFields.length ? [{ draft: canonicalDraft(draft), fields: orderedFields }] : [];
    });
    return entries.length ? [[versionId, entries] as const] : [];
  }),
);

export const serializeReleaseDraftState = (state: ReleaseDraftState) => JSON.stringify(storedDraftValue(state));

export const releaseDraftSummary = (state: ReleaseDraftState): ReleaseDraftSummary => Object.fromEntries(
  [...state.draftsByVersion.entries()].flatMap(([versionId, drafts]) => (
    drafts.size ? [[versionId, drafts.size] as const] : []
  )),
);

const browserSessionStorage = (): ReleaseDraftStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const safeGet = (storage: ReleaseDraftStorage, key: string) => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const safeRemove = (storage: ReleaseDraftStorage, key: string) => {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
};

export const persistReleaseDraftState = (
  appId: string,
  state: ReleaseDraftState,
  storage: ReleaseDraftStorage | null = browserSessionStorage(),
) => {
  if (!storage) return;
  const value = storedDraftValue(state);
  try {
    if (Object.keys(value).length) storage.setItem(releaseDraftStorageKey(appId), JSON.stringify(value));
    else storage.removeItem(releaseDraftStorageKey(appId));
    storage.removeItem(legacyStoreListingDraftStorageKey(appId));
  } catch {
    // Draft persistence is best-effort; the in-memory state remains authoritative.
  }
};

export const readReleaseDraftState = (
  appId: string,
  storage: ReleaseDraftStorage | null = browserSessionStorage(),
): ReleaseDraftState => {
  if (!storage) return emptyReleaseDraftState();

  const currentKey = releaseDraftStorageKey(appId);
  const legacyKey = legacyStoreListingDraftStorageKey(appId);
  const currentRaw = safeGet(storage, currentKey);
  if (currentRaw !== null) {
    const current = decodeReleaseDraftState(currentRaw);
    if (current.structurallyValid) {
      if (!current.state.draftsByVersion.size) safeRemove(storage, currentKey);
      safeRemove(storage, legacyKey);
      return current.state;
    }
    safeRemove(storage, currentKey);
  }

  const legacyRaw = safeGet(storage, legacyKey);
  if (legacyRaw === null) return emptyReleaseDraftState();
  const legacy = decodeReleaseDraftState(legacyRaw);
  if (!legacy.structurallyValid) {
    safeRemove(storage, legacyKey);
    return emptyReleaseDraftState();
  }
  persistReleaseDraftState(appId, legacy.state, storage);
  return legacy.state;
};

export const readReleaseDraftSummary = (
  appId: string,
  storage: ReleaseDraftStorage | null = browserSessionStorage(),
): ReleaseDraftSummary => releaseDraftSummary(readReleaseDraftState(appId, storage));

export const reconcileReleaseDraftVersion = (
  state: ReleaseDraftState,
  versionId: string,
  baselines: ReadonlyMap<AppStoreLocale, VersionLocalizationDraft>,
): ReleaseDraftState => {
  const existingDrafts = state.draftsByVersion.get(versionId);
  const existingDirtyFields = state.dirtyFieldsByVersion.get(versionId);
  if (!existingDrafts && !existingDirtyFields) return state;

  const draftsByVersion = new Map(state.draftsByVersion);
  const dirtyFieldsByVersion = new Map(state.dirtyFieldsByVersion);
  const reconciledDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
  const reconciledDirtyFields = new Map<AppStoreLocale, Set<LocalizationField>>();

  if (existingDrafts && existingDirtyFields) {
    for (const [locale, storedDraft] of existingDrafts) {
      const baseline = baselines.get(locale);
      const storedFields = existingDirtyFields.get(locale);
      if (!baseline || !storedFields) continue;
      const draft = { ...baseline };
      const fields = new Set<LocalizationField>();
      for (const field of localizationFields) {
        if (!storedFields.has(field) || storedDraft[field] === baseline[field]) continue;
        draft[field] = storedDraft[field];
        fields.add(field);
      }
      if (!fields.size) continue;
      reconciledDrafts.set(locale, draft);
      reconciledDirtyFields.set(locale, fields);
    }
  }

  if (reconciledDrafts.size) {
    draftsByVersion.set(versionId, reconciledDrafts);
    dirtyFieldsByVersion.set(versionId, reconciledDirtyFields);
  } else {
    draftsByVersion.delete(versionId);
    dirtyFieldsByVersion.delete(versionId);
  }
  return { draftsByVersion, dirtyFieldsByVersion };
};

export const updateReleaseDraftFields = (
  state: ReleaseDraftState,
  input: UpdateReleaseDraftFieldsInput,
): ReleaseDraftState => {
  const fields = new Set<LocalizationField>();
  for (const field of input.fields) {
    if (isLocalizationField(field)) fields.add(field);
  }
  if (!fields.size) return state;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(input.values, field) || typeof input.values[field] !== "string") {
      throw new TypeError(`Missing string value for release draft field “${field}”.`);
    }
  }

  const locale = input.baseline.locale;
  const previousDraft = state.draftsByVersion.get(input.versionId)?.get(locale);
  const previousDirtyFields = state.dirtyFieldsByVersion.get(input.versionId)?.get(locale);
  const draft = { ...input.baseline };
  const dirtyFields = new Set<LocalizationField>();

  if (previousDraft && previousDirtyFields) {
    for (const field of localizationFields) {
      if (!previousDirtyFields.has(field) || previousDraft[field] === input.baseline[field]) continue;
      draft[field] = previousDraft[field];
      dirtyFields.add(field);
    }
  }

  for (const field of fields) {
    const value = input.values[field] as string;
    draft[field] = value;
    if (value === input.baseline[field]) dirtyFields.delete(field);
    else dirtyFields.add(field);
  }

  const draftsByVersion = new Map(state.draftsByVersion);
  const dirtyFieldsByVersion = new Map(state.dirtyFieldsByVersion);
  const versionDrafts = new Map(draftsByVersion.get(input.versionId) ?? []);
  const versionDirtyFields = new Map(dirtyFieldsByVersion.get(input.versionId) ?? []);

  if (dirtyFields.size) {
    versionDrafts.set(locale, draft);
    versionDirtyFields.set(locale, new Set(localizationFields.filter((field) => dirtyFields.has(field))));
    draftsByVersion.set(input.versionId, versionDrafts);
    dirtyFieldsByVersion.set(input.versionId, versionDirtyFields);
  } else {
    versionDrafts.delete(locale);
    versionDirtyFields.delete(locale);
    if (versionDrafts.size) draftsByVersion.set(input.versionId, versionDrafts);
    else draftsByVersion.delete(input.versionId);
    if (versionDirtyFields.size) dirtyFieldsByVersion.set(input.versionId, versionDirtyFields);
    else dirtyFieldsByVersion.delete(input.versionId);
  }

  return { draftsByVersion, dirtyFieldsByVersion };
};

export const revertReleaseDraftLocale = (
  state: ReleaseDraftState,
  versionId: string,
  locale: AppStoreLocale,
): ReleaseDraftState => {
  const currentDrafts = state.draftsByVersion.get(versionId);
  const currentDirtyFields = state.dirtyFieldsByVersion.get(versionId);
  if (!currentDrafts?.has(locale) && !currentDirtyFields?.has(locale)) return state;

  const draftsByVersion = new Map(state.draftsByVersion);
  const dirtyFieldsByVersion = new Map(state.dirtyFieldsByVersion);
  const versionDrafts = new Map(currentDrafts ?? []);
  const versionDirtyFields = new Map(currentDirtyFields ?? []);
  versionDrafts.delete(locale);
  versionDirtyFields.delete(locale);
  if (versionDrafts.size) draftsByVersion.set(versionId, versionDrafts);
  else draftsByVersion.delete(versionId);
  if (versionDirtyFields.size) dirtyFieldsByVersion.set(versionId, versionDirtyFields);
  else dirtyFieldsByVersion.delete(versionId);
  return { draftsByVersion, dirtyFieldsByVersion };
};

export const clearReleaseDraftLocale = revertReleaseDraftLocale;

export const clearReleaseDraftVersion = (
  state: ReleaseDraftState,
  versionId: string,
): ReleaseDraftState => {
  if (!state.draftsByVersion.has(versionId) && !state.dirtyFieldsByVersion.has(versionId)) return state;
  const draftsByVersion = new Map(state.draftsByVersion);
  const dirtyFieldsByVersion = new Map(state.dirtyFieldsByVersion);
  draftsByVersion.delete(versionId);
  dirtyFieldsByVersion.delete(versionId);
  return { draftsByVersion, dirtyFieldsByVersion };
};

export const revertReleaseDraftVersion = clearReleaseDraftVersion;
