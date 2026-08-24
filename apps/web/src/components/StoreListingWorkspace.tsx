import type {
  AgentStatus,
  AppStoreLocale,
  AppStorePlatform,
  AppStoreVersion,
  AppSummary,
  UpdateLocalizationsMutationPlan,
  VersionLocalization,
  VersionLocalizationDraft,
} from "@asc-studio/contracts";
import { VersionLocalizationDraftSchema } from "@asc-studio/contracts";
import {
  ArrowLeft,
  Check,
  CheckSquare2,
  ChevronDown,
  FileText,
  Images,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import {
  draftFrom,
  localeNames,
  platformLabel,
  storeListingFields,
  storeListingIssues,
  type StoreListingField,
  versionStateLabel,
} from "../releaseMetadata.js";
import { LocalizationReviewDialog } from "./ReleaseDialogs.js";
import { ScreenshotManager } from "./ScreenshotManager.js";

export interface StoreListingTarget {
  versionId?: string | undefined;
  platform?: AppStorePlatform | undefined;
  locale?: AppStoreLocale | undefined;
  field?: StoreListingField | "screenshots" | undefined;
}

interface StoreListingWorkspaceProps {
  app: AppSummary;
  status: AgentStatus | null;
  target?: StoreListingTarget | null;
  suggestedKeyword?: string | null;
  onSuggestedKeywordUsed?: () => void;
  onOpenRelease: (target: StoreListingTarget) => void;
  onDraftSummaryChange: (summary: StoreListingDraftSummary) => void;
  onScreenshotPendingChange: (versionId: string, pending: boolean, applying: boolean) => void;
}

export type StoreListingDraftSummary = Record<string, number>;
export type StoreListingScreenshotSummary = Record<string, boolean>;

interface StoreListingDraftState {
  draftsByVersion: Map<string, Map<AppStoreLocale, VersionLocalizationDraft>>;
  dirtyFieldsByVersion: Map<string, Map<AppStoreLocale, Set<StoreListingField>>>;
}

const draftStorageKey = (appId: string) => `asc-studio.store-listing-drafts.${appId}`;

const emptyStoredDraftState = (): StoreListingDraftState => ({
  draftsByVersion: new Map(),
  dirtyFieldsByVersion: new Map(),
});

const readStoredDraftState = (appId: string): StoreListingDraftState => {
  const result = emptyStoredDraftState();
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(appId));
    if (!raw) return result;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [versionId, entries] of Object.entries(value)) {
      if (!Array.isArray(entries)) continue;
      const versionDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
      const versionDirtyFields = new Map<AppStoreLocale, Set<StoreListingField>>();
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || !("draft" in entry) || !("fields" in entry)) continue;
        const parsed = VersionLocalizationDraftSchema.safeParse(entry.draft);
        const candidateFields: unknown[] = Array.isArray(entry.fields) ? entry.fields : [];
        const fields = candidateFields
          .filter((field): field is StoreListingField => (
            typeof field === "string" && storeListingFields.includes(field as StoreListingField)
          ));
        if (!parsed.success || fields.length === 0) continue;
        versionDrafts.set(parsed.data.locale, parsed.data);
        versionDirtyFields.set(parsed.data.locale, new Set(fields));
      }
      if (versionDrafts.size) {
        result.draftsByVersion.set(versionId, versionDrafts);
        result.dirtyFieldsByVersion.set(versionId, versionDirtyFields);
      }
    }
  } catch {
    window.sessionStorage.removeItem(draftStorageKey(appId));
  }
  return result;
};

const draftSummary = (draftsByVersion: ReadonlyMap<string, ReadonlyMap<AppStoreLocale, VersionLocalizationDraft>>) => Object.fromEntries(
  [...draftsByVersion.entries()].flatMap(([versionId, drafts]) => drafts.size ? [[versionId, drafts.size] as const] : []),
);

export const readStoreListingDraftSummary = (appId: string): StoreListingDraftSummary => (
  draftSummary(readStoredDraftState(appId).draftsByVersion)
);

const storeDraftState = (
  appId: string,
  state: StoreListingDraftState,
) => {
  const value = Object.fromEntries([...state.draftsByVersion.entries()].flatMap(([versionId, drafts]) => (
    drafts.size ? [[versionId, [...drafts].flatMap(([locale, draft]) => {
      const fields = state.dirtyFieldsByVersion.get(versionId)?.get(locale);
      return fields?.size ? [{ draft, fields: storeListingFields.filter((field) => fields.has(field)) }] : [];
    })] as const] : []
  )));
  if (Object.keys(value).length) window.sessionStorage.setItem(draftStorageKey(appId), JSON.stringify(value));
  else window.sessionStorage.removeItem(draftStorageKey(appId));
};

const releasePlatforms: AppStorePlatform[] = ["IOS", "MAC_OS", "TV_OS", "VISION_OS"];
const initialVersionLimit = 25;
const emptyDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();

const selectVersion = (
  versions: AppStoreVersion[],
  currentId: string | null,
  targetId?: string,
) => versions.find((version) => version.id === targetId)
  ?? versions.find((version) => version.id === currentId)
  ?? versions.find((version) => version.editable)
  ?? versions[0]
  ?? null;

const hardIssues = (draft: VersionLocalizationDraft) => storeListingIssues(draft).filter((issue) => (
  issue.message.startsWith("Shorten") || issue.message.startsWith("Use")
));

const fieldLimits: Record<StoreListingField, number> = {
  description: 4_000,
  promotionalText: 170,
  keywords: 100,
  marketingUrl: 4_000,
  supportUrl: 4_000,
};

const fieldLabels: Record<StoreListingField, string> = {
  description: "Description",
  promotionalText: "Promotional text",
  keywords: "Keywords",
  marketingUrl: "Marketing URL",
  supportUrl: "Support URL",
};

export const StoreListingWorkspace = ({
  app,
  status,
  target,
  suggestedKeyword,
  onSuggestedKeywordUsed,
  onOpenRelease,
  onDraftSummaryChange,
  onScreenshotPendingChange,
}: StoreListingWorkspaceProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<AppStorePlatform>(() => (
    target?.platform ?? releasePlatforms.find((platform) => app.platforms.includes(platform)) ?? "IOS"
  ));
  const [versions, setVersions] = useState<AppStoreVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(target?.versionId ?? null);
  const [localizations, setLocalizations] = useState<VersionLocalization[]>([]);
  const [selectedLocale, setSelectedLocale] = useState<AppStoreLocale | null>(target?.locale ?? null);
  const [draftState, setDraftState] = useState<StoreListingDraftState>(() => readStoredDraftState(app.id));
  const [panel, setPanel] = useState<"copy" | "screenshots">(target?.field === "screenshots" ? "screenshots" : "copy");
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [versionRequest, setVersionRequest] = useState(0);
  const [loadingLocalizations, setLoadingLocalizations] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [plan, setPlan] = useState<UpdateLocalizationsMutationPlan | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [screenshotPending, setScreenshotPending] = useState(false);
  const [screenshotApplying, setScreenshotApplying] = useState(false);
  const [focusField, setFocusField] = useState<StoreListingField | null>(() => (
    target?.field && target.field !== "screenshots" ? target.field : null
  ));
  const fieldRefs = useRef<Partial<Record<StoreListingField, HTMLTextAreaElement | HTMLInputElement | null>>>({});
  const selectedVersionIdRef = useRef<string | null>(selectedVersionId);
  const localizationLoadGeneration = useRef(0);
  const pendingTargetVersionId = useRef<string | null>(target?.versionId ?? null);
  const pendingTargetLocale = useRef<AppStoreLocale | null>(target?.locale ?? null);
  const targetKey = target
    ? [target.platform ?? "", target.versionId ?? "", target.locale ?? "", target.field ?? ""].join("|")
    : null;
  const handledTargetKey = useRef<string | null>(targetKey);

  const chooseVersion = useCallback((versionId: string | null, manual = false) => {
    if (manual) pendingTargetVersionId.current = null;
    if (selectedVersionIdRef.current === versionId) return;
    selectedVersionIdRef.current = versionId;
    localizationLoadGeneration.current += 1;
    setLocalizations([]);
    setSelectedLocale(null);
    setLoadingLocalizations(Boolean(versionId));
    setSelectedVersionId(versionId);
  }, []);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const { draftsByVersion, dirtyFieldsByVersion } = draftState;
  const drafts = selectedVersionId ? draftsByVersion.get(selectedVersionId) ?? emptyDrafts : emptyDrafts;
  const baselineByLocale = useMemo(
    () => new Map(localizations.map((localization) => [localization.locale, draftFrom(localization)] as const)),
    [localizations],
  );
  const selectedBaseline = selectedLocale ? baselineByLocale.get(selectedLocale) ?? null : null;
  const selectedDraft = selectedLocale && selectedBaseline ? drafts.get(selectedLocale) ?? selectedBaseline : null;
  const selectedIssues = selectedDraft ? storeListingIssues(selectedDraft) : [];

  useEffect(() => {
    storeDraftState(app.id, draftState);
    onDraftSummaryChange(draftSummary(draftsByVersion));
  }, [app.id, draftState, draftsByVersion, onDraftSummaryChange]);

  useEffect(() => {
    if (!screenshotPending) return;
    const protectPendingUploads = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingUploads);
    return () => window.removeEventListener("beforeunload", protectPendingUploads);
  }, [screenshotPending]);

  const loadLocalizations = useCallback(async (versionId: string) => {
    const generation = ++localizationLoadGeneration.current;
    let response: Awaited<ReturnType<typeof api.localizations>>;
    try {
      response = await api.localizations(app.id, versionId);
    } catch (error) {
      if (generation !== localizationLoadGeneration.current || selectedVersionIdRef.current !== versionId) return false;
      throw error;
    }
    if (generation !== localizationLoadGeneration.current || selectedVersionIdRef.current !== versionId) return false;
    setLocalizations(response.localizations);
    const availableLocales = new Set(response.localizations.map((localization) => localization.locale));
    const baselines = new Map(response.localizations.map((localization) => [localization.locale, draftFrom(localization)] as const));
    setDraftState((current) => {
      const existingDrafts = current.draftsByVersion.get(versionId);
      const existingDirtyFields = current.dirtyFieldsByVersion.get(versionId);
      if (!existingDrafts || !existingDirtyFields) return current;
      const nextDraftsByVersion = new Map(current.draftsByVersion);
      const nextDirtyFieldsByVersion = new Map(current.dirtyFieldsByVersion);
      const validDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
      const validDirtyFields = new Map<AppStoreLocale, Set<StoreListingField>>();
      for (const [locale, storedDraft] of existingDrafts) {
        if (!availableLocales.has(locale)) continue;
        const baseline = baselines.get(locale);
        const storedFields = existingDirtyFields.get(locale);
        if (!baseline || !storedFields) continue;
        const fields = new Set([...storedFields].filter((field) => storedDraft[field] !== baseline[field]));
        if (!fields.size) continue;
        const reconciled = { ...baseline };
        for (const field of fields) reconciled[field] = storedDraft[field];
        validDrafts.set(locale, reconciled);
        validDirtyFields.set(locale, fields);
      }
      if (validDrafts.size) {
        nextDraftsByVersion.set(versionId, validDrafts);
        nextDirtyFieldsByVersion.set(versionId, validDirtyFields);
      } else {
        nextDraftsByVersion.delete(versionId);
        nextDirtyFieldsByVersion.delete(versionId);
      }
      return { draftsByVersion: nextDraftsByVersion, dirtyFieldsByVersion: nextDirtyFieldsByVersion };
    });
    const targetLocale = pendingTargetLocale.current;
    const preferred = response.localizations.find((item) => item.locale === targetLocale)?.locale
      ?? response.localizations.find((item) => item.locale === "en-US")?.locale
      ?? response.localizations[0]?.locale
      ?? null;
    if (preferred === targetLocale) pendingTargetLocale.current = null;
    setSelectedLocale((current) => current && response.localizations.some((item) => item.locale === current) ? current : preferred);
    return true;
  }, [app.id]);

  useEffect(() => {
    if (handledTargetKey.current === targetKey) return;
    handledTargetKey.current = targetKey;
    if (!target) return;
    if (target.versionId) pendingTargetVersionId.current = target.versionId;
    if (target.locale) pendingTargetLocale.current = target.locale;
    if (target.platform && target.platform !== selectedPlatform) {
      setSelectedPlatform(target.platform);
      chooseVersion(target.versionId ?? null);
      setSelectedLocale(target.locale ?? null);
    } else {
      if (target.versionId) {
        chooseVersion(target.versionId);
        setVersionRequest((current) => current + 1);
      }
      if (target.locale) setSelectedLocale(target.locale);
    }
    if (target.field === "screenshots") setPanel("screenshots");
    else if (target.field) {
      setPanel("copy");
      setFocusField(target.field);
    }
  }, [chooseVersion, selectedPlatform, target, targetKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    setFatalError(null);
    void api.versions(app.id, selectedPlatform, { limit: initialVersionLimit, paginate: false })
      .then((response) => {
        if (cancelled) return;
        setVersions(response.versions);
        const targetVersionId = pendingTargetVersionId.current;
        const targetVersion = response.versions.find((version) => version.id === targetVersionId);
        if (targetVersion) pendingTargetVersionId.current = null;
        chooseVersion(targetVersion?.id
          ?? (targetVersionId ? selectedVersionIdRef.current : selectVersion(response.versions, selectedVersionIdRef.current)?.id ?? null));
        void api.versions(app.id, selectedPlatform)
          .then((history) => {
            if (cancelled) return;
            setVersions(history.versions);
            const pendingVersionId = pendingTargetVersionId.current;
            chooseVersion(selectVersion(history.versions, selectedVersionIdRef.current, pendingVersionId ?? undefined)?.id ?? null);
            pendingTargetVersionId.current = null;
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not load Store Listing.");
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    return () => { cancelled = true; };
  }, [app.id, chooseVersion, selectedPlatform, versionRequest]);

  useEffect(() => {
    if (!selectedVersionId) {
      localizationLoadGeneration.current += 1;
      setLocalizations([]);
      setSelectedLocale(null);
      setLoadingLocalizations(false);
      return;
    }
    let cancelled = false;
    setLoadingLocalizations(true);
    void loadLocalizations(selectedVersionId)
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not load storefront localizations.");
      })
      .finally(() => {
        if (!cancelled) setLoadingLocalizations(false);
      });
    return () => {
      cancelled = true;
      localizationLoadGeneration.current += 1;
    };
  }, [loadLocalizations, selectedVersionId]);

  useEffect(() => {
    if (panel !== "copy" || !focusField) return;
    const control = fieldRefs.current[focusField];
    if (!control) return;
    const frame = window.requestAnimationFrame(() => {
      control.focus();
      control.scrollIntoView({ block: "center", behavior: "smooth" });
      setFocusField(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusField, panel, selectedDraft?.locale, selectedLocale]);

  const setDraft = useCallback((draft: VersionLocalizationDraft, field: StoreListingField) => {
    if (!selectedVersionId) return;
    const baseline = baselineByLocale.get(draft.locale);
    if (!baseline) return;
    setDraftState((current) => {
      const nextDraftsByVersion = new Map(current.draftsByVersion);
      const nextDirtyFieldsByVersion = new Map(current.dirtyFieldsByVersion);
      const versionDrafts = new Map(nextDraftsByVersion.get(selectedVersionId) ?? []);
      const versionDirtyFields = new Map(nextDirtyFieldsByVersion.get(selectedVersionId) ?? []);
      const localeDirtyFields = new Set(versionDirtyFields.get(draft.locale) ?? []);
      if (draft[field] === baseline[field]) localeDirtyFields.delete(field);
      else localeDirtyFields.add(field);
      if (localeDirtyFields.size) {
        versionDrafts.set(draft.locale, draft);
        versionDirtyFields.set(draft.locale, localeDirtyFields);
        nextDraftsByVersion.set(selectedVersionId, versionDrafts);
        nextDirtyFieldsByVersion.set(selectedVersionId, versionDirtyFields);
      } else {
        versionDrafts.delete(draft.locale);
        versionDirtyFields.delete(draft.locale);
        if (versionDrafts.size) nextDraftsByVersion.set(selectedVersionId, versionDrafts);
        else nextDraftsByVersion.delete(selectedVersionId);
        if (versionDirtyFields.size) nextDirtyFieldsByVersion.set(selectedVersionId, versionDirtyFields);
        else nextDirtyFieldsByVersion.delete(selectedVersionId);
      }
      return { draftsByVersion: nextDraftsByVersion, dirtyFieldsByVersion: nextDirtyFieldsByVersion };
    });
  }, [baselineByLocale, selectedVersionId]);

  useEffect(() => {
    if (!suggestedKeyword || !selectedDraft || !selectedVersion?.editable || plan) return;
    const terms = selectedDraft.keywords.split(",").map((value) => value.trim()).filter(Boolean);
    if (terms.some((value) => value.toLocaleLowerCase("en-US") === suggestedKeyword.toLocaleLowerCase("en-US"))) {
      onSuggestedKeywordUsed?.();
      return;
    }
    const keywords = [...terms, suggestedKeyword].join(",");
    if (keywords.length > 100) {
      setFatalError(`“${suggestedKeyword}” would push ${selectedDraft.locale} keywords past Apple’s 100-character limit.`);
      onSuggestedKeywordUsed?.();
      return;
    }
    setDraft({ ...selectedDraft, keywords }, "keywords");
    setPanel("copy");
    onSuggestedKeywordUsed?.();
  }, [onSuggestedKeywordUsed, plan, selectedDraft, selectedVersion?.editable, setDraft, suggestedKeyword]);

  const sync = async () => {
    if (!selectedVersionId || plan || screenshotPending) return;
    setSyncing(true);
    setFatalError(null);
    try {
      await loadLocalizations(selectedVersionId);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Store Listing sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const reviewChanges = async () => {
    if (plan || !selectedVersion || drafts.size === 0 || !selectedVersionId) return;
    if ([...drafts.values()].some((draft) => hardIssues(draft).length > 0)) {
      setFatalError("Fix the highlighted storefront fields before reviewing changes.");
      return;
    }
    setMutationBusy(true);
    setMutationError(null);
    try {
      const dirtyFields = dirtyFieldsByVersion.get(selectedVersionId);
      const response = await api.planLocalizations({
        appId: app.id,
        versionId: selectedVersion.id,
        localizations: [...drafts].flatMap(([locale, draft]) => {
          const fields = dirtyFields?.get(locale);
          return fields?.size
            ? [{ ...draft, fields: storeListingFields.filter((field) => fields.has(field)) }]
            : [];
        }),
      });
      setPlan(response.plan);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "ASC Studio could not create the Store Listing plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmChanges = async () => {
    if (!plan) return;
    const planVersionId = plan.target.versionId;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(plan);
      await loadLocalizations(planVersionId);
      setDraftState((current) => {
        const draftsByVersion = new Map(current.draftsByVersion);
        const dirtyFieldsByVersion = new Map(current.dirtyFieldsByVersion);
        draftsByVersion.delete(planVersionId);
        dirtyFieldsByVersion.delete(planVersionId);
        return { draftsByVersion, dirtyFieldsByVersion };
      });
      setPlan(null);
    } catch (error) {
      if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) setPlan(null);
      setMutationError(error instanceof Error ? error.message : "The Store Listing update failed.");
    } finally {
      setMutationBusy(false);
    }
  };

  const updateField = (field: StoreListingField, value: string) => {
    if (!selectedDraft || !selectedVersion?.editable || plan || mutationBusy) return;
    setDraft({ ...selectedDraft, [field]: value }, field);
  };

  const revertLocale = () => {
    if (!selectedVersionId || !selectedLocale || plan || mutationBusy) return;
    setDraftState((current) => {
      const draftsByVersion = new Map(current.draftsByVersion);
      const dirtyFieldsByVersion = new Map(current.dirtyFieldsByVersion);
      const versionDrafts = new Map(draftsByVersion.get(selectedVersionId) ?? []);
      const versionDirtyFields = new Map(dirtyFieldsByVersion.get(selectedVersionId) ?? []);
      versionDrafts.delete(selectedLocale);
      versionDirtyFields.delete(selectedLocale);
      if (versionDrafts.size) draftsByVersion.set(selectedVersionId, versionDrafts);
      else draftsByVersion.delete(selectedVersionId);
      if (versionDirtyFields.size) dirtyFieldsByVersion.set(selectedVersionId, versionDirtyFields);
      else dirtyFieldsByVersion.delete(selectedVersionId);
      return { draftsByVersion, dirtyFieldsByVersion };
    });
  };

  const handleScreenshotPendingChange = useCallback((pending: boolean, applying: boolean) => {
    setScreenshotPending(pending);
    setScreenshotApplying(applying);
    if (selectedVersionId) onScreenshotPendingChange(selectedVersionId, pending, applying);
  }, [onScreenshotPendingChange, selectedVersionId]);

  const fieldIssue = (field: StoreListingField) => selectedIssues.find((issue) => issue.field === field)?.message;
  const textareaField = (field: "description" | "promotionalText" | "keywords", rows: number, placeholder: string) => {
    if (!selectedDraft) return null;
    const issue = fieldIssue(field);
    return (
      <label className={issue ? "store-field invalid" : "store-field"} data-field={field}>
        <span><strong>{fieldLabels[field]}</strong><small>{selectedDraft[field].length} / {fieldLimits[field]}</small></span>
        <textarea
          ref={(node) => { fieldRefs.current[field] = node; }}
          rows={rows}
          value={selectedDraft[field]}
          placeholder={placeholder}
          disabled={!selectedVersion?.editable || Boolean(plan) || mutationBusy}
          onChange={(event) => updateField(field, event.target.value)}
        />
        {issue ? <em>{issue}</em> : null}
      </label>
    );
  };
  const urlField = (field: "supportUrl" | "marketingUrl", hint: string) => {
    if (!selectedDraft) return null;
    const issue = fieldIssue(field);
    return (
      <label className={issue ? "store-field invalid" : "store-field"} data-field={field}>
        <span><strong>{fieldLabels[field]}</strong><small>{hint}</small></span>
        <input
          ref={(node) => { fieldRefs.current[field] = node; }}
          type="url"
          value={selectedDraft[field]}
          placeholder="https://"
          disabled={!selectedVersion?.editable || Boolean(plan) || mutationBusy}
          onChange={(event) => updateField(field, event.target.value)}
        />
        {issue ? <em>{issue}</em> : null}
      </label>
    );
  };

  return (
    <>
      <main className="workspace store-listing-workspace" inert={plan ? true : undefined}>
        <header className="topbar store-listing-topbar">
          <div>
            <h1>Store Listing</h1>
            <p>{selectedVersion
              ? `Editing storefront for ${selectedVersion.versionString} · ${versionStateLabel(selectedVersion.state)}`
              : `Customer-facing copy and media for ${platformLabel(selectedPlatform)}`}</p>
          </div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void sync()} disabled={!selectedVersion || syncing || screenshotPending || Boolean(plan)} title={screenshotPending ? "Finish or discard local screenshot changes before syncing." : undefined}>
              <RefreshCw size={17} className={syncing ? "spin" : undefined} /><span>{syncing ? "Syncing" : "Sync"}</span>
            </button>
            {panel === "copy" ? <button className="button primary" type="button" disabled={!selectedVersion?.editable || drafts.size === 0 || mutationBusy || Boolean(plan)} onClick={() => void reviewChanges()}>
              <CheckSquare2 size={17} /><span>Review changes ({drafts.size})</span>
            </button> : null}
          </div>
        </header>

        {status?.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Actions only change isolated sample data.</span></div> : null}
        {fatalError ? <div className="error-banner" role="alert"><span>{fatalError}</span><button type="button" onClick={() => setFatalError(null)}>Dismiss</button></div> : null}

        <div className="store-listing-content">
          <section className="store-listing-scope" aria-label="Storefront scope">
            <label><small>Platform</small><span><select value={selectedPlatform} disabled={loadingVersions || loadingLocalizations || syncing || mutationBusy || Boolean(plan) || screenshotPending} onChange={(event) => {
              pendingTargetVersionId.current = null;
              pendingTargetLocale.current = null;
              setSelectedPlatform(event.target.value as AppStorePlatform);
              chooseVersion(null, true);
              setSelectedLocale(null);
            }}>{releasePlatforms.map((platform) => <option value={platform} key={platform}>{platformLabel(platform)}</option>)}</select><ChevronDown size={15} /></span></label>
            <label><small>Version</small><span><select value={selectedVersionId ?? ""} disabled={loadingVersions || loadingLocalizations || versions.length === 0 || syncing || mutationBusy || Boolean(plan) || screenshotPending} onChange={(event) => chooseVersion(event.target.value, true)}>{versions.map((version) => <option value={version.id} key={version.id}>{version.versionString}</option>)}</select><ChevronDown size={15} /></span></label>
            <div><small>Status</small><strong>{selectedVersion ? versionStateLabel(selectedVersion.state) : "No version"}</strong></div>
            <div><small>Storefronts</small><strong>{localizations.length || "—"}</strong></div>
            <button className="button secondary" type="button" disabled={!selectedVersion || screenshotPending} title={screenshotPending ? "Review or undo local screenshot changes before leaving." : undefined} onClick={() => onOpenRelease({
              versionId: selectedVersion?.id,
              platform: selectedVersion?.platform,
              locale: selectedLocale ?? undefined,
            })}><ArrowLeft size={16} />Back to release</button>
          </section>

          <nav className="store-listing-tabs" aria-label="Store Listing content">
            <button type="button" className={panel === "copy" ? "active" : ""} aria-current={panel === "copy" ? "page" : undefined} disabled={Boolean(plan)} onClick={() => setPanel("copy")}><FileText size={16} />Copy &amp; search</button>
            <button type="button" className={panel === "screenshots" ? "active" : ""} aria-current={panel === "screenshots" ? "page" : undefined} disabled={Boolean(plan)} onClick={() => setPanel("screenshots")}><Images size={16} />Screenshots</button>
          </nav>

          <div className="store-mobile-context" aria-label="Store Listing status and review">
            <span><small>Version status</small><strong>{selectedVersion ? versionStateLabel(selectedVersion.state) : "No version"}</strong></span>
            {panel === "copy" ? <button className="button primary" type="button" disabled={!selectedVersion?.editable || drafts.size === 0 || mutationBusy || Boolean(plan)} onClick={() => void reviewChanges()}><CheckSquare2 size={15} />Review changes ({drafts.size})</button>
              : <span className={screenshotPending ? "pending" : ""}><small>Screenshots</small><strong>{screenshotApplying ? "Applying changes…" : screenshotPending ? "Changes pending" : "No local changes"}</strong></span>}
          </div>

          {loadingVersions ? (
            <div className="store-listing-empty"><RefreshCw className="spin" size={28} /><h2>Loading Store Listing</h2><p>Fetching the editable storefront for {platformLabel(selectedPlatform)}.</p></div>
          ) : !selectedVersion ? (
            <div className="store-listing-empty"><FileText size={28} /><h2>No version to edit</h2><p>Create a release version first, then its storefront will appear here.</p><button className="button primary" type="button" onClick={() => onOpenRelease({ platform: selectedPlatform })}>Open Releases</button></div>
          ) : (
            <>
              {panel === "copy" ? <section className="store-listing-workbench">
              <aside className="storefront-rail" aria-label="Storefront locales">
                <header><div><h2>Storefronts</h2><p>{localizations.length} localized listing{localizations.length === 1 ? "" : "s"}</p></div></header>
                <div className="storefront-list">
                  {loadingLocalizations ? Array.from({ length: 4 }, (_, index) => <span className="storefront-skeleton" key={index} />) : localizations.map((localization) => {
                    const baseline = draftFrom(localization);
                    const draft = drafts.get(localization.locale) ?? baseline;
                    const issues = storeListingIssues(draft);
                    const complete = storeListingFields.length - new Set(issues.map((issue) => issue.field)).size;
                    return <button type="button" className={selectedLocale === localization.locale ? "selected" : ""} disabled={Boolean(plan)} onClick={() => {
                      pendingTargetLocale.current = null;
                      setSelectedLocale(localization.locale);
                    }} key={localization.id}>
                      <span><strong>{localeNames[localization.locale]}</strong><small>{localization.locale} · {complete}/{storeListingFields.length} ready</small></span>
                      {drafts.has(localization.locale) ? <i>Edited</i> : issues.length ? <b>{issues.length}</b> : <Check size={15} />}
                    </button>;
                  })}
                </div>
              </aside>

              {selectedDraft && selectedBaseline ? <div className="storefront-editor">
                <header>
                  <div><h2>{localeNames[selectedDraft.locale]}</h2><p>{selectedDraft.locale} · Version-localized storefront</p></div>
                  <button className="button tertiary" type="button" disabled={!drafts.has(selectedDraft.locale) || Boolean(plan) || mutationBusy} onClick={revertLocale}><RotateCcw size={15} />Revert locale</button>
                </header>
                <div className="storefront-fields">
                  {textareaField("description", 9, "Explain what the app does and why customers should care.")}
                  {textareaField("promotionalText", 3, "A timely message shown above the description.")}
                  <div className="store-search-field">
                    {textareaField("keywords", 3, "Comma-separated search terms.")}
                    <p>Keywords are private search metadata. Separate terms with commas and avoid repeating the app name.</p>
                  </div>
                  <div className="store-url-grid">
                    {urlField("supportUrl", "Required")}
                    {urlField("marketingUrl", "Optional")}
                  </div>
                </div>
              </div> : <div className="storefront-no-selection"><FileText size={24} /><h2>Select a storefront</h2><p>Choose a locale to edit its public copy and search metadata.</p></div>}

              {selectedDraft ? <aside className="storefront-preview" aria-label="Storefront preview">
                <header><strong>Product page preview</strong><span>Copy only</span></header>
                <div className="preview-app-row">
                  <span className="preview-app-icon">{app.name.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{app.name}</strong><small>{platformLabel(selectedPlatform)} · {selectedDraft.locale}</small></div>
                  <button type="button" tabIndex={-1}>GET</button>
                </div>
                {selectedDraft.promotionalText ? <p className="preview-promo">{selectedDraft.promotionalText}</p> : null}
                <section><h3>About this app</h3><p>{selectedDraft.description || "Your localized description will appear here."}</p></section>
                <dl>
                  <div><dt>Version</dt><dd>{selectedVersion.versionString}</dd></div>
                  <div><dt>Support</dt><dd>{selectedDraft.supportUrl ? "Linked" : "Missing"}</dd></div>
                </dl>
                <p className="preview-note">Layout is representative. App Store presentation varies by device and territory.</p>
              </aside> : null}
              </section> : null}
              <ScreenshotManager
                appId={app.id}
                version={selectedVersion}
                localizations={localizations}
                visible={panel === "screenshots"}
                locked={loadingVersions || loadingLocalizations || syncing || mutationBusy}
                onChanged={async () => { await loadLocalizations(selectedVersion.id); }}
                onPendingChange={handleScreenshotPendingChange}
                key={selectedVersion.id}
              />
            </>
          )}

          <div className="store-listing-dock">
            <span className={drafts.size || screenshotPending ? "activity-dot warning" : "activity-dot success"} />
            <strong>{screenshotApplying ? "Applying screenshot changes" : screenshotPending ? "Local screenshot changes" : drafts.size ? `${drafts.size} storefront draft${drafts.size === 1 ? "" : "s"}` : "Store Listing matches App Store Connect"}</strong>
            <span>{screenshotApplying ? "Stay in Store Listing until App Store Connect confirms the update." : screenshotPending ? "Review or undo them in Screenshots before leaving this workspace." : selectedVersion?.editable ? "Changes stay local until you review and confirm them." : selectedVersion ? "This version is read-only." : "Choose a version to continue."}</span>
            <i />
            {panel === "copy" ? <button className="button primary store-dock-review" type="button" disabled={!selectedVersion?.editable || drafts.size === 0 || mutationBusy || Boolean(plan)} onClick={() => void reviewChanges()}><CheckSquare2 size={15} />Review changes</button> : null}
            <button className="button secondary" type="button" disabled={!selectedVersion || screenshotPending} title={screenshotPending ? "Review or undo local screenshot changes before leaving." : undefined} onClick={() => onOpenRelease({ versionId: selectedVersion?.id, platform: selectedVersion?.platform, locale: selectedLocale ?? undefined })}>Release readiness</button>
          </div>
        </div>
      </main>

      {plan ? <LocalizationReviewDialog plan={plan} busy={mutationBusy} error={mutationError} onConfirm={() => void confirmChanges()} onClose={() => {
        if (mutationBusy) return;
        setPlan(null);
        setMutationError(null);
      }} /> : null}
    </>
  );
};
