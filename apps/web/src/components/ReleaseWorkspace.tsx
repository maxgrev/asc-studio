import type {
  AgentStatus,
  AppStoreLocale,
  AppStorePlatform,
  AppStoreVersion,
  AppSummary,
  AuditEvent,
  BuildSummary,
  CreateVersionInput,
  CreateVersionMutationPlan,
  GenerateReleaseCopyTranslationsInput,
  OpenAiConnection,
  SubmitVersionMutationPlan,
  UpdateLocalizationsMutationPlan,
  ValidationReport,
  VersionLocalization,
  VersionLocalizationDraft,
  VersionSubmissionStatus,
} from "@asc-studio/contracts";
import { CheckSquare2, ChevronDown, FilePlus2, Languages, RefreshCw, Send, Store } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import {
  draftFrom,
  draftMatches,
  localeNames,
  metadataIssues,
  platformLabel,
  versionStateLabel,
} from "../releaseMetadata.js";
import { LocalizationEditor } from "./LocalizationEditor.js";
import { LocalizationTable } from "./LocalizationTable.js";
import type {
  StoreListingDraftSummary,
  StoreListingScreenshotSummary,
  StoreListingTarget,
} from "./StoreListingWorkspace.js";
import {
  CreateVersionDialog,
  LocalizationReviewDialog,
  ReadinessDialog,
  SubmissionReviewDialog,
  TranslationDialog,
} from "./ReleaseDialogs.js";

interface ReleaseWorkspaceProps {
  app: AppSummary;
  status: AgentStatus | null;
  openAiConnection: OpenAiConnection | null;
  openAiConnectionLoading: boolean;
  openAiConnectionError: string | null;
  openAiSetupOpen: boolean;
  onReloadOpenAiConnection: () => Promise<void>;
  onManageOpenAi: () => void;
  target?: StoreListingTarget | null;
  storeListingDraftSummary: StoreListingDraftSummary;
  storeListingScreenshotSummary: StoreListingScreenshotSummary;
  onOpenStoreListing: (target: StoreListingTarget) => void;
}

const emptyDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
const initialVersionLimit = 25;
const releasePlatforms: AppStorePlatform[] = ["IOS", "MAC_OS", "TV_OS", "VISION_OS"];

const versionToSelect = (
  versions: AppStoreVersion[],
  currentId: string | null,
  preferredVersion?: string,
  targetId?: string,
) => versions.find((version) => version.id === targetId)
  ?? versions.find((version) => preferredVersion && version.versionString === preferredVersion)
  ?? versions.find((version) => version.id === currentId)
  ?? versions.find((version) => version.editable)
  ?? versions[0]
  ?? null;

export const ReleaseWorkspace = ({
  app,
  status,
  openAiConnection,
  openAiConnectionLoading,
  openAiConnectionError,
  openAiSetupOpen,
  onReloadOpenAiConnection,
  onManageOpenAi,
  target,
  storeListingDraftSummary,
  storeListingScreenshotSummary,
  onOpenStoreListing,
}: ReleaseWorkspaceProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<AppStorePlatform>(
    () => target?.platform ?? releasePlatforms.find((platform) => app.platforms.includes(platform)) ?? "IOS",
  );
  const [versions, setVersions] = useState<AppStoreVersion[]>([]);
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [localizations, setLocalizations] = useState<VersionLocalization[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [selectedLocale, setSelectedLocale] = useState<AppStoreLocale | null>(null);
  const [sourceLocale, setSourceLocale] = useState<AppStoreLocale | null>(null);
  const [draftsByVersion, setDraftsByVersion] = useState<Map<string, Map<AppStoreLocale, VersionLocalizationDraft>>>(new Map());
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingLocalizations, setLoadingLocalizations] = useState(false);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPlan, setCreatePlan] = useState<CreateVersionMutationPlan | null>(null);
  const [localizationPlan, setLocalizationPlan] = useState<UpdateLocalizationsMutationPlan | null>(null);
  const [submissionPlan, setSubmissionPlan] = useState<SubmitVersionMutationPlan | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<VersionSubmissionStatus | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<ValidationReport | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const translateButtonRef = useRef<HTMLButtonElement>(null);
  const openAiSetupWasOpen = useRef(false);
  const selectedVersionIdRef = useRef<string | null>(selectedVersionId);
  const versionLoadGeneration = useRef(0);
  const pendingTargetVersionId = useRef<string | null>(target?.versionId ?? null);

  const chooseVersion = useCallback((versionId: string | null, manual = false) => {
    if (manual) {
      pendingTargetVersionId.current = null;
      versionLoadGeneration.current += 1;
    }
    if (selectedVersionIdRef.current === versionId) return;
    selectedVersionIdRef.current = versionId;
    setLocalizations([]);
    setSelectedLocale(null);
    setSourceLocale(null);
    setBuilds([]);
    setSelectedBuildId(null);
    setSubmissionStatus(null);
    setLoadingLocalizations(Boolean(versionId));
    setLoadingBuilds(Boolean(versionId));
    setSelectedVersionId(versionId);
  }, []);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? null;
  const drafts = selectedVersionId ? draftsByVersion.get(selectedVersionId) ?? emptyDrafts : emptyDrafts;
  const baselineByLocale = useMemo(
    () => new Map(localizations.map((localization) => [localization.locale, draftFrom(localization)] as const)),
    [localizations],
  );
  const selectedBaseline = selectedLocale ? baselineByLocale.get(selectedLocale) ?? null : null;
  const selectedDraft = selectedLocale && selectedBaseline ? drafts.get(selectedLocale) ?? selectedBaseline : null;
  const compatibleBuilds = useMemo(() => selectedVersion
    ? builds.filter((build) => (
      build.version === selectedVersion.versionString
      && build.platform === selectedVersion.platform
      && build.processingStatus === "Ready"
      && !build.expired
    ))
    : [], [builds, selectedVersion?.platform, selectedVersion?.versionString]);
  const selectedBuild = compatibleBuilds.find((build) => build.id === selectedBuildId) ?? null;
  const pendingStoreListingDrafts = selectedVersionId ? storeListingDraftSummary[selectedVersionId] ?? 0 : 0;
  const pendingStoreListingScreenshots = selectedVersionId ? storeListingScreenshotSummary[selectedVersionId] ?? false : false;
  const releaseScopeLocked = syncing
    || mutationBusy
    || Boolean(localizationPlan)
    || Boolean(submissionPlan)
    || createOpen
    || translationOpen
    || readinessOpen;
  const releaseModalOpen = createOpen
    || Boolean(localizationPlan)
    || Boolean(submissionPlan)
    || translationOpen
    || readinessOpen;

  useEffect(() => {
    setSelectedBuildId((current) => (
      current && compatibleBuilds.some((build) => build.id === current)
        ? current
        : compatibleBuilds[0]?.id ?? null
    ));
  }, [compatibleBuilds]);

  useEffect(() => {
    if (openAiSetupWasOpen.current && !openAiSetupOpen) {
      window.requestAnimationFrame(() => translateButtonRef.current?.focus());
    }
    openAiSetupWasOpen.current = openAiSetupOpen;
  }, [openAiSetupOpen]);

  const refreshEvents = useCallback(async () => {
    const response = await api.activity();
    setEvents(response.events);
  }, []);

  const loadVersions = useCallback(async (preferredVersion?: string) => {
    const generation = ++versionLoadGeneration.current;
    let firstPage: Awaited<ReturnType<typeof api.versions>>;
    try {
      firstPage = await api.versions(app.id, selectedPlatform, { limit: initialVersionLimit, paginate: false });
    } catch (error) {
      if (generation !== versionLoadGeneration.current) return null;
      throw error;
    }
    if (generation !== versionLoadGeneration.current) return null;
    let nextVersions = firstPage.versions;
    const targetVersionId = pendingTargetVersionId.current;
    const selectedVersionMissing = selectedVersionIdRef.current && !nextVersions.some((version) => version.id === selectedVersionIdRef.current);
    const preferredVersionMissing = preferredVersion && !nextVersions.some((version) => version.versionString === preferredVersion);
    const targetVersionMissing = targetVersionId && !nextVersions.some((version) => version.id === targetVersionId);
    if (selectedVersionMissing || preferredVersionMissing || targetVersionMissing) {
      const history = await api.versions(app.id, selectedPlatform);
      if (generation !== versionLoadGeneration.current) return null;
      nextVersions = history.versions;
    }
    const nextVersion = versionToSelect(nextVersions, selectedVersionIdRef.current, preferredVersion, targetVersionId ?? undefined);
    if (nextVersion?.id === targetVersionId || targetVersionId) pendingTargetVersionId.current = null;
    setVersions(nextVersions);
    chooseVersion(nextVersion?.id ?? null);
    void api.versions(app.id, selectedPlatform)
      .then((response) => {
        if (generation !== versionLoadGeneration.current) return;
        const pendingVersionId = pendingTargetVersionId.current;
        const selected = versionToSelect(
          response.versions,
          selectedVersionIdRef.current,
          preferredVersion,
          pendingVersionId ?? undefined,
        );
        if (selected?.id === pendingVersionId || pendingVersionId) pendingTargetVersionId.current = null;
        setVersions(response.versions);
        chooseVersion(selected?.id ?? null);
      })
      .catch(() => undefined);
    return nextVersion;
  }, [app.id, chooseVersion, selectedPlatform]);

  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    chooseVersion(null);
    setSelectedBuildId(null);
    setSelectedLocale(null);
    setSubmissionStatus(null);
    setSubmissionPlan(null);
    setBuilds([]);
    setBuildError(null);
    setFatalError(null);
    void loadVersions()
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not load releases.");
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    return () => {
      cancelled = true;
      versionLoadGeneration.current += 1;
    };
  }, [app.id, chooseVersion, loadVersions, selectedPlatform]);

  useEffect(() => {
    let cancelled = false;
    void api.activity()
      .then((response) => {
        if (!cancelled) setEvents(response.events);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [app.id]);

  useEffect(() => {
    if (!selectedVersion) {
      setBuilds([]);
      setBuildError(null);
      setLoadingBuilds(false);
      return;
    }
    let cancelled = false;
    setBuilds([]);
    setSelectedBuildId(null);
    setBuildError(null);
    setLoadingBuilds(true);
    void api.releaseBuilds(app.id, selectedVersion.versionString, selectedVersion.platform)
      .then((response) => {
        if (!cancelled) setBuilds(response.builds);
      })
      .catch((error: unknown) => {
        if (!cancelled) setBuildError(error instanceof Error ? error.message : "ASC Studio could not load compatible builds.");
      })
      .finally(() => {
        if (!cancelled) setLoadingBuilds(false);
      });
    return () => { cancelled = true; };
  }, [app.id, selectedPlatform, selectedVersion?.platform, selectedVersion?.versionString]);

  useEffect(() => {
    if (!selectedVersionId) {
      setLocalizations([]);
      setLoadingLocalizations(false);
      return;
    }
    let cancelled = false;
    setLocalizations([]);
    setSelectedLocale(null);
    setSourceLocale(null);
    setLoadingLocalizations(true);
    void api.localizations(app.id, selectedVersionId)
      .then((response) => {
        if (cancelled) return;
        setLocalizations(response.localizations);
        const preferred = response.localizations.find((item) => item.locale === target?.locale)?.locale
          ?? response.localizations.find((item) => item.locale === "en-US")?.locale
          ?? response.localizations[0]?.locale
          ?? null;
        const compactViewport = window.matchMedia("(max-width: 620px)").matches;
        setSelectedLocale(compactViewport && !target?.locale ? null : preferred);
        setSourceLocale(preferred);
        setFatalError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not load localizations.");
      })
      .finally(() => {
        if (!cancelled) setLoadingLocalizations(false);
      });
    return () => { cancelled = true; };
  }, [app.id, selectedVersionId, target?.locale]);

  useEffect(() => {
    if (!selectedVersionId) {
      setSubmissionStatus(null);
      return;
    }
    let cancelled = false;
    setSubmissionStatus(null);
    void api.submissionStatus(app.id, selectedVersionId)
      .then((response) => {
        if (!cancelled) setSubmissionStatus(response.submission);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not read submission status.");
      });
    return () => { cancelled = true; };
  }, [app.id, selectedVersionId]);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const version = await loadVersions();
      if (version) {
        const [localizationResponse, buildResponse] = await Promise.all([
          api.localizations(app.id, version.id),
          api.releaseBuilds(app.id, version.versionString, version.platform),
        ]);
        setLocalizations(localizationResponse.localizations);
        setBuilds(buildResponse.builds);
      }
      await refreshEvents();
      setFatalError(null);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const selectPlatform = (platform: AppStorePlatform) => {
    if (platform === selectedPlatform) return;
    setSelectedPlatform(platform);
    setVersions([]);
    chooseVersion(null, true);
    setSelectedBuildId(null);
    setSelectedLocale(null);
    setSourceLocale(null);
    setLocalizations([]);
    setBuilds([]);
    setBuildError(null);
    setSubmissionStatus(null);
    setSubmissionPlan(null);
    setReadiness(null);
    setReadinessOpen(false);
    setFatalError(null);
    setLoadingVersions(true);
  };

  const saveDraft = (draft: VersionLocalizationDraft) => {
    if (!selectedVersionId) return;
    const baseline = baselineByLocale.get(draft.locale);
    setDraftsByVersion((current) => {
      const next = new Map(current);
      const versionDrafts = new Map(next.get(selectedVersionId) ?? []);
      if (baseline && draftMatches(baseline, draft)) versionDrafts.delete(draft.locale);
      else versionDrafts.set(draft.locale, draft);
      next.set(selectedVersionId, versionDrafts);
      return next;
    });
  };

  const revertDraft = (locale: AppStoreLocale) => {
    if (!selectedVersionId) return;
    setDraftsByVersion((current) => {
      const next = new Map(current);
      const versionDrafts = new Map(next.get(selectedVersionId) ?? []);
      versionDrafts.delete(locale);
      next.set(selectedVersionId, versionDrafts);
      return next;
    });
  };

  const reviewLocalizations = async () => {
    if (!selectedVersion || drafts.size === 0) return;
    const invalid = [...drafts.values()].flatMap(metadataIssues);
    if (invalid.length) {
      setFatalError("Fix the locale issues before reviewing changes.");
      return;
    }
    setMutationBusy(true);
    setMutationError(null);
    try {
      const response = await api.planLocalizations({
        appId: app.id,
        versionId: selectedVersion.id,
        localizations: [...drafts.values()].map((draft) => ({ ...draft, fields: ["whatsNew" as const] })),
      });
      setLocalizationPlan(response.plan);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "ASC Studio could not create the metadata plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmLocalizations = async () => {
    if (!localizationPlan) return;
    const planVersionId = localizationPlan.target.versionId;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(localizationPlan);
      const response = await api.localizations(app.id, planVersionId);
      if (selectedVersionIdRef.current === planVersionId) setLocalizations(response.localizations);
      setDraftsByVersion((current) => {
        const next = new Map(current);
        next.delete(planVersionId);
        return next;
      });
      setLocalizationPlan(null);
      await refreshEvents();
    } catch (error) {
      if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) {
        setLocalizationPlan(null);
      }
      setMutationError(error instanceof Error ? error.message : "The metadata update failed.");
    } finally {
      setMutationBusy(false);
    }
  };

  const reviewVersion = async (input: CreateVersionInput) => {
    setMutationBusy(true);
    setMutationError(null);
    try {
      const response = await api.planVersion(input);
      setCreatePlan(response.plan);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "ASC Studio could not create the version plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmVersion = async () => {
    if (!createPlan) return;
    const versionString = createPlan.after.versionString;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(createPlan);
      await loadVersions(versionString);
      await refreshEvents();
      setCreatePlan(null);
      setCreateOpen(false);
    } catch (error) {
      if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) {
        setCreatePlan(null);
      }
      setMutationError(error instanceof Error ? error.message : "Version creation failed.");
      await loadVersions();
    } finally {
      setMutationBusy(false);
    }
  };

  const validate = async () => {
    if (!selectedVersion) return;
    setReadinessOpen(true);
    setReadinessBusy(true);
    setReadiness(null);
    setReadinessError(null);
    try {
      const response = await api.validateVersion(app.id, selectedVersion.id);
      setReadiness(response.report);
      await refreshEvents();
    } catch (error) {
      setReadinessError(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setReadinessBusy(false);
    }
  };

  const reviewSubmission = async () => {
    if (!selectedVersion || !selectedBuild || drafts.size > 0 || pendingStoreListingDrafts > 0 || pendingStoreListingScreenshots || submissionStatus?.id) return;
    setMutationBusy(true);
    setMutationError(null);
    setFatalError(null);
    try {
      const response = await api.planSubmission({
        appId: app.id,
        versionId: selectedVersion.id,
        buildId: selectedBuild.id,
      });
      setSubmissionPlan(response.plan);
    } catch (error) {
      setFatalError(error instanceof Error ? error.message : "ASC Studio could not prepare the submission plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmSubmission = async () => {
    if (!submissionPlan) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(submissionPlan);
      const [statusResponse] = await Promise.all([
        api.submissionStatus(submissionPlan.target.appId, submissionPlan.target.versionId),
        loadVersions(),
        refreshEvents(),
      ]);
      setSubmissionStatus(statusResponse.submission);
      setSubmissionPlan(null);
      setReadiness(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "App Review submission failed.";
      if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) {
        setSubmissionPlan(null);
        setFatalError(message);
      } else {
        setMutationError(message);
      }
    } finally {
      setMutationBusy(false);
    }
  };

  const generateTranslations = async (input: GenerateReleaseCopyTranslationsInput) => {
    if (!selectedVersionId) return;
    const response = await api.generateReleaseCopyTranslations(input);
    setDraftsByVersion((current) => {
      const next = new Map(current);
      const versionDrafts = new Map(next.get(selectedVersionId) ?? []);
      for (const translation of response.translations) {
        const baseline = baselineByLocale.get(translation.locale);
        if (!baseline) continue;
        const existing = versionDrafts.get(translation.locale) ?? baseline;
        const draft: VersionLocalizationDraft = {
          ...existing,
          ...(translation.whatsNew !== undefined ? { whatsNew: translation.whatsNew } : {}),
          ...(translation.promotionalText !== undefined ? { promotionalText: translation.promotionalText } : {}),
          keywords: existing.keywords,
        };
        if (draftMatches(baseline, draft)) versionDrafts.delete(translation.locale);
        else versionDrafts.set(translation.locale, draft);
      }
      next.set(selectedVersionId, versionDrafts);
      return next;
    });
    setTranslationOpen(false);
  };

  const source = sourceLocale ? (drafts.get(sourceLocale) ?? baselineByLocale.get(sourceLocale) ?? null) : null;
  const translationTargets = [...baselineByLocale.values()].filter((draft) => draft.locale !== sourceLocale);
  return (
    <>
      <main className="workspace release-workspace" inert={releaseModalOpen ? true : undefined}>
        <header className="topbar release-topbar">
          <div><h1>{selectedVersion ? `Release ${selectedVersion.versionString}` : `${platformLabel(selectedPlatform)} releases`}</h1><p>Prepare metadata, choose a build, and check submission readiness.</p></div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void sync()} disabled={syncing} aria-label={syncing ? "Syncing releases" : "Sync releases"}>
              <RefreshCw size={17} className={syncing ? "spin" : undefined} /><span>{syncing ? "Syncing" : "Sync"}</span>
            </button>
            <button className="button primary" type="button" disabled={!selectedVersion?.editable || drafts.size === 0 || mutationBusy} onClick={() => void reviewLocalizations()} aria-label={drafts.size ? `Review ${drafts.size} release-note draft${drafts.size === 1 ? "" : "s"}` : "Review release notes"}>
              <CheckSquare2 size={17} /><span>Review notes{drafts.size ? ` (${drafts.size})` : ""}</span>
            </button>
          </div>
        </header>

        {status?.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Actions only change isolated sample data.</span></div> : null}
        {fatalError ? <div className="error-banner" role="alert"><span>{fatalError}</span><button type="button" onClick={() => setFatalError(null)}>Dismiss</button></div> : null}

        <div className="release-content">
          <section className="release-setup" aria-label="Release setup">
            <label><small>Platform</small><span className="release-select"><select value={selectedPlatform} disabled={loadingVersions || loadingLocalizations || releaseScopeLocked} onChange={(event) => selectPlatform(event.target.value as AppStorePlatform)}>{releasePlatforms.map((platform) => <option value={platform} key={platform}>{platformLabel(platform)}</option>)}</select><ChevronDown size={15} /></span></label>
            <label><small>Version</small><span className="release-select"><select value={selectedVersionId ?? ""} disabled={loadingVersions || loadingLocalizations || versions.length === 0 || releaseScopeLocked} onChange={(event) => chooseVersion(event.target.value, true)}>{versions.map((version) => <option value={version.id} key={version.id}>{version.versionString}</option>)}</select><ChevronDown size={15} /></span></label>
            <div className="release-status"><small>Status</small><strong>{submissionStatus?.id ? versionStateLabel(submissionStatus.state) : selectedVersion ? versionStateLabel(selectedVersion.state) : "No version"}</strong></div>
            <div><small>Copied from</small><strong>{selectedVersion?.copiedFrom ?? "—"}</strong></div>
            <label title={buildError ?? undefined}><small>Submission build</small><span className="release-select"><select value={selectedBuildId ?? ""} disabled={!selectedVersion?.editable || loadingBuilds || compatibleBuilds.length === 0 || Boolean(submissionStatus?.id)} onChange={(event) => setSelectedBuildId(event.target.value)}>{loadingBuilds ? <option value="">Loading builds…</option> : buildError ? <option value="">Builds unavailable</option> : compatibleBuilds.length === 0 ? <option value="">No ready build</option> : compatibleBuilds.map((build) => <option value={build.id} key={build.id}>Build {build.buildNumber}</option>)}</select><ChevronDown size={15} /></span></label>
            <button className="button secondary" type="button" aria-label="Create new version" onClick={() => {
              setCreatePlan(null);
              setMutationError(null);
              setCreateOpen(true);
            }}><FilePlus2 size={16} />New version</button>
          </section>

          {selectedVersion ? <section className="release-store-listing-link">
            <Store size={19} />
            <div><strong>Store Listing is the canonical storefront editor</strong><span>{pendingStoreListingDrafts
              ? `${pendingStoreListingDrafts} local storefront draft${pendingStoreListingDrafts === 1 ? "" : "s"} must be reviewed there before submission.`
              : "Description, promotional text, keywords, URLs, and screenshots are managed there once."}</span></div>
            <button className="button secondary" type="button" onClick={() => onOpenStoreListing({
              versionId: selectedVersion.id,
              platform: selectedVersion.platform,
              locale: selectedLocale ?? undefined,
            })}>Open Store Listing</button>
          </section> : null}

          {loadingVersions ? (
            <div className="release-empty"><RefreshCw className="spin" size={30} /><h2>Loading releases</h2><p>Fetching the latest {platformLabel(selectedPlatform)} App Store version.</p></div>
          ) : selectedVersion ? (
            <div className={selectedLocale && selectedBaseline && selectedDraft ? "release-editor-grid with-editor" : "release-editor-grid"}>
              <section className="localizations-region">
                <header className="localizations-header">
                  <div><h2>Localizations</h2><p>{localizations.length} {localizations.length === 1 ? "locale" : "locales"} · {drafts.size} edited</p></div>
                  <div className="localization-actions">
                    <label><span>Source:</span><select value={sourceLocale ?? ""} onChange={(event) => setSourceLocale(event.target.value as AppStoreLocale)}>{localizations.map((localization) => <option value={localization.locale} key={localization.id}>{localeNames[localization.locale]}</option>)}</select><ChevronDown size={15} /></label>
                    <button ref={translateButtonRef} className="button secondary" type="button" disabled={!source || translationTargets.length === 0} onClick={() => setTranslationOpen(true)} aria-label="Translate release copy"><Languages size={16} />Translate</button>
                  </div>
                </header>
                <LocalizationTable localizations={localizations} drafts={drafts} selectedLocale={selectedLocale} loading={loadingLocalizations} onSelect={setSelectedLocale} />
              </section>
              {selectedLocale && selectedBaseline && selectedDraft ? (
                <LocalizationEditor
                  baseline={selectedBaseline}
                  draft={selectedDraft}
                  hasSavedDraft={drafts.has(selectedLocale)}
                  onSave={saveDraft}
                  onRevert={() => revertDraft(selectedLocale)}
                  onClose={() => setSelectedLocale(null)}
                />
              ) : null}
            </div>
          ) : (
            <div className="release-empty"><FilePlus2 size={30} /><h2>Create the next {platformLabel(selectedPlatform)} version</h2><p>Carry the storefront forward, then coordinate release notes, build selection, readiness, and submission here.</p><button className="button primary" type="button" onClick={() => setCreateOpen(true)}>New version</button></div>
          )}

          <div className="release-dock">
            <span className={drafts.size || pendingStoreListingDrafts || pendingStoreListingScreenshots ? "activity-dot warning" : "activity-dot success"} />
            <strong>{submissionStatus?.id
              ? `Submitted · ${versionStateLabel(submissionStatus.state)}`
              : drafts.size
                ? `${drafts.size} release-note draft${drafts.size === 1 ? "" : "s"}`
                : pendingStoreListingScreenshots
                  ? "Screenshot changes pending in Store Listing"
                  : pendingStoreListingDrafts
                    ? `${pendingStoreListingDrafts} storefront draft${pendingStoreListingDrafts === 1 ? "" : "s"} pending`
                    : "No local release drafts"}</strong>
            <span className="saved-state">{submissionStatus?.submittedAt ? `Sent ${new Date(submissionStatus.submittedAt).toLocaleString()}` : "Saved locally"}</span>
            <span className="activity-spacer" />
            <button className="button secondary" type="button" onClick={() => setActivityOpen((open) => !open)}>View activity</button>
            <button className="button secondary" type="button" disabled={!selectedVersion || readinessBusy} onClick={() => void validate()} aria-label="Validate release"><CheckSquare2 size={16} />Validate</button>
            <button className="button primary" type="button" disabled={!selectedVersion?.editable || !selectedBuild || drafts.size > 0 || pendingStoreListingDrafts > 0 || pendingStoreListingScreenshots || Boolean(submissionStatus?.id) || mutationBusy} onClick={() => void reviewSubmission()} aria-label="Review App Review submission"><Send size={16} />{submissionStatus?.id ? "Submitted" : "Submit for review"}</button>
            {activityOpen ? (
              <div className="release-activity-popover">
                <header><strong>Recent activity</strong><button className="icon-button" type="button" onClick={() => setActivityOpen(false)} aria-label="Close activity">×</button></header>
                {events.length ? events.slice(0, 6).map((event) => <div className="release-activity-row" key={event.id}><span className={`activity-dot ${event.status}`} /><div><strong>{event.summary}</strong><small>{event.actor} · {new Date(event.timestamp).toLocaleTimeString()}</small></div></div>) : <p>No activity yet.</p>}
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {createOpen ? <CreateVersionDialog appId={app.id} platform={selectedPlatform} versions={versions} plan={createPlan} busy={mutationBusy} error={mutationError} onReview={(input) => void reviewVersion(input)} onConfirm={() => void confirmVersion()} onClose={() => {
        if (mutationBusy) return;
        setCreateOpen(false);
        setCreatePlan(null);
        setMutationError(null);
      }} /> : null}
      {localizationPlan ? <LocalizationReviewDialog plan={localizationPlan} busy={mutationBusy} error={mutationError} onConfirm={() => void confirmLocalizations()} onClose={() => {
        if (mutationBusy) return;
        setLocalizationPlan(null);
        setMutationError(null);
      }} /> : null}
      {submissionPlan ? <SubmissionReviewDialog plan={submissionPlan} busy={mutationBusy} error={mutationError} onConfirm={() => void confirmSubmission()} onClose={() => {
        if (mutationBusy) return;
        setSubmissionPlan(null);
        setMutationError(null);
      }} /> : null}
      {translationOpen && source ? <TranslationDialog
        source={source}
        targets={translationTargets}
        connection={openAiConnection}
        connectionLoading={openAiConnectionLoading}
        connectionError={openAiConnectionError}
        onRetryConnection={onReloadOpenAiConnection}
        onManageOpenAi={() => {
          setTranslationOpen(false);
          onManageOpenAi();
        }}
        onGenerate={generateTranslations}
        onClose={() => setTranslationOpen(false)}
      /> : null}
      {readinessOpen ? <ReadinessDialog
        report={readiness}
        demo={status?.mode === "demo"}
        busy={readinessBusy}
        error={readinessError}
        onRetry={() => void validate()}
        onFix={(step) => {
          setReadinessOpen(false);
          onOpenStoreListing({
            versionId: selectedVersion?.id,
            platform: selectedVersion?.platform,
            locale: step.locale as AppStoreLocale || selectedLocale || undefined,
            field: step.field === "screenshots" ? "screenshots" : step.field as StoreListingTarget["field"],
          });
        }}
        onClose={() => setReadinessOpen(false)}
      /> : null}
    </>
  );
};
