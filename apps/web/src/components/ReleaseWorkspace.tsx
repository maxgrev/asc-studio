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
  SubmitVersionMutationPlan,
  TranslationProviderStatus,
  UpdateLocalizationsMutationPlan,
  ValidationReport,
  VersionLocalization,
  VersionLocalizationDraft,
  VersionSubmissionStatus,
} from "@asc-studio/contracts";
import { CheckSquare2, ChevronDown, FilePlus2, Images, Languages, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ScreenshotManager } from "./ScreenshotManager.js";
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
  suggestedKeyword?: string | null;
  onSuggestedKeywordUsed?: () => void;
}

const emptyDrafts = new Map<AppStoreLocale, VersionLocalizationDraft>();
const initialVersionLimit = 25;
const releasePlatforms: AppStorePlatform[] = ["IOS", "MAC_OS", "TV_OS", "VISION_OS"];

const versionToSelect = (
  versions: AppStoreVersion[],
  currentId: string | null,
  preferredVersion?: string,
) => versions.find((version) => preferredVersion && version.versionString === preferredVersion)
  ?? versions.find((version) => version.id === currentId)
  ?? versions.find((version) => version.editable)
  ?? versions[0]
  ?? null;

export const ReleaseWorkspace = ({ app, status, suggestedKeyword, onSuggestedKeywordUsed }: ReleaseWorkspaceProps) => {
  const [selectedPlatform, setSelectedPlatform] = useState<AppStorePlatform>(
    () => releasePlatforms.find((platform) => app.platforms.includes(platform)) ?? "IOS",
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
  const [translationStatus, setTranslationStatus] = useState<TranslationProviderStatus | null>(null);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<ValidationReport | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [releasePanel, setReleasePanel] = useState<"metadata" | "screenshots">("metadata");
  const [screenshotPending, setScreenshotPending] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    void api.translationStatus()
      .then((nextStatus) => {
        if (!cancelled) setTranslationStatus(nextStatus);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTranslationStatus({
          provider: "openai",
          configured: false,
          model: null,
          detail: error instanceof Error ? error.message : "ASC Studio could not read the translation provider.",
        });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSelectedBuildId((current) => (
      current && compatibleBuilds.some((build) => build.id === current)
        ? current
        : compatibleBuilds[0]?.id ?? null
    ));
  }, [compatibleBuilds]);

  const refreshEvents = useCallback(async () => {
    const response = await api.activity();
    setEvents(response.events);
  }, []);

  const screenshotsChanged = useCallback(async () => {
    setReadiness(null);
    await refreshEvents();
  }, [refreshEvents]);

  const loadVersions = useCallback(async (preferredVersion?: string) => {
    const firstPage = await api.versions(app.id, selectedPlatform, { limit: initialVersionLimit, paginate: false });
    let nextVersions = firstPage.versions;
    const selectedVersionMissing = selectedVersionId && !nextVersions.some((version) => version.id === selectedVersionId);
    const preferredVersionMissing = preferredVersion && !nextVersions.some((version) => version.versionString === preferredVersion);
    if (selectedVersionMissing || preferredVersionMissing) {
      nextVersions = (await api.versions(app.id, selectedPlatform)).versions;
    }
    const nextVersion = versionToSelect(nextVersions, selectedVersionId, preferredVersion);
    setVersions(nextVersions);
    setSelectedVersionId(nextVersion?.id ?? null);
    void api.versions(app.id, selectedPlatform)
      .then((response) => {
        setVersions(response.versions);
        setSelectedVersionId((current) => versionToSelect(response.versions, current, preferredVersion)?.id ?? null);
      })
      .catch(() => undefined);
    return nextVersion;
  }, [app.id, selectedPlatform, selectedVersionId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingVersions(true);
    setSelectedVersionId(null);
    setSelectedBuildId(null);
    setSelectedLocale(null);
    setSubmissionStatus(null);
    setSubmissionPlan(null);
    setBuilds([]);
    setBuildError(null);
    setFatalError(null);
    void api.versions(app.id, selectedPlatform, { limit: initialVersionLimit, paginate: false })
      .then((versionResponse) => {
        if (cancelled) return;
        setVersions(versionResponse.versions);
        setSelectedVersionId(versionToSelect(versionResponse.versions, null)?.id ?? null);
        setLoadingVersions(false);
        void api.versions(app.id, selectedPlatform)
          .then((historyResponse) => {
            if (cancelled) return;
            setVersions(historyResponse.versions);
            setSelectedVersionId((current) => versionToSelect(historyResponse.versions, current)?.id ?? null);
          })
          .catch(() => undefined);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFatalError(error instanceof Error ? error.message : "ASC Studio could not load releases.");
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    return () => { cancelled = true; };
  }, [app.id, selectedPlatform]);

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
        const preferred = response.localizations.find((item) => item.locale === "en-US")?.locale ?? response.localizations[0]?.locale ?? null;
        const compactViewport = window.matchMedia("(max-width: 620px)").matches;
        setSelectedLocale(compactViewport ? null : preferred);
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
  }, [app.id, selectedVersionId]);

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
    setSelectedVersionId(null);
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

  useEffect(() => {
    if (!suggestedKeyword || !selectedDraft || !selectedVersion?.editable) return;
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
    saveDraft({ ...selectedDraft, keywords });
    setReleasePanel("metadata");
    onSuggestedKeywordUsed?.();
  }, [onSuggestedKeywordUsed, selectedDraft, selectedVersion?.editable, suggestedKeyword]);

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
        localizations: [...drafts.values()],
      });
      setLocalizationPlan(response.plan);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "ASC Studio could not create the metadata plan.");
    } finally {
      setMutationBusy(false);
    }
  };

  const confirmLocalizations = async () => {
    if (!localizationPlan || !selectedVersionId) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await api.confirmPlan(localizationPlan);
      const response = await api.localizations(app.id, selectedVersionId);
      setLocalizations(response.localizations);
      setDraftsByVersion((current) => {
        const next = new Map(current);
        next.delete(selectedVersionId);
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
    if (!selectedVersion || !selectedBuild || drafts.size > 0 || screenshotPending || submissionStatus?.id) return;
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
      <main className="workspace release-workspace">
        <header className="topbar release-topbar">
          <div><h1>{selectedVersion ? `Release ${selectedVersion.versionString}` : `${platformLabel(selectedPlatform)} releases`}</h1><p>Prepare metadata, choose a build, and check submission readiness.</p></div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void sync()} disabled={syncing} aria-label={syncing ? "Syncing releases" : "Sync releases"}>
              <RefreshCw size={17} className={syncing ? "spin" : undefined} /><span>{syncing ? "Syncing" : "Sync"}</span>
            </button>
            {releasePanel === "metadata" ? <button className="button primary" type="button" disabled={!selectedVersion?.editable || drafts.size === 0 || mutationBusy} onClick={() => void reviewLocalizations()} aria-label={drafts.size ? `Review ${drafts.size} draft change${drafts.size === 1 ? "" : "s"}` : "Review metadata changes"}>
              <CheckSquare2 size={17} /><span>Review metadata{drafts.size ? ` (${drafts.size})` : ""}</span>
            </button> : null}
          </div>
        </header>

        {status?.mode === "demo" ? <div className="demo-banner"><strong>Demo mode</strong><span>Actions only change isolated sample data.</span></div> : null}
        {fatalError ? <div className="error-banner" role="alert"><span>{fatalError}</span><button type="button" onClick={() => setFatalError(null)}>Dismiss</button></div> : null}

        <div className="release-content">
          <section className="release-setup" aria-label="Release setup">
            <label><small>Platform</small><span className="release-select"><select value={selectedPlatform} disabled={syncing || mutationBusy || screenshotPending} onChange={(event) => selectPlatform(event.target.value as AppStorePlatform)}>{releasePlatforms.map((platform) => <option value={platform} key={platform}>{platformLabel(platform)}</option>)}</select><ChevronDown size={15} /></span></label>
            <label><small>Version</small><span className="release-select"><select value={selectedVersionId ?? ""} disabled={loadingVersions || versions.length === 0 || screenshotPending} onChange={(event) => setSelectedVersionId(event.target.value)}>{versions.map((version) => <option value={version.id} key={version.id}>{version.versionString}</option>)}</select><ChevronDown size={15} /></span></label>
            <div className="release-status"><small>Status</small><strong>{submissionStatus?.id ? versionStateLabel(submissionStatus.state) : selectedVersion ? versionStateLabel(selectedVersion.state) : "No version"}</strong></div>
            <div><small>Copied from</small><strong>{selectedVersion?.copiedFrom ?? "—"}</strong></div>
            <label title={buildError ?? undefined}><small>Submission build</small><span className="release-select"><select value={selectedBuildId ?? ""} disabled={!selectedVersion?.editable || loadingBuilds || compatibleBuilds.length === 0 || Boolean(submissionStatus?.id)} onChange={(event) => setSelectedBuildId(event.target.value)}>{loadingBuilds ? <option value="">Loading builds…</option> : buildError ? <option value="">Builds unavailable</option> : compatibleBuilds.length === 0 ? <option value="">No ready build</option> : compatibleBuilds.map((build) => <option value={build.id} key={build.id}>Build {build.buildNumber}</option>)}</select><ChevronDown size={15} /></span></label>
            <button className="button secondary" type="button" aria-label="Create new version" onClick={() => {
              setCreatePlan(null);
              setMutationError(null);
              setCreateOpen(true);
            }} disabled={screenshotPending}><FilePlus2 size={16} />New version</button>
          </section>

          {selectedVersion ? <nav className="release-tabs" aria-label="Release content">
            <button type="button" className={releasePanel === "metadata" ? "active" : ""} aria-current={releasePanel === "metadata" ? "page" : undefined} onClick={() => setReleasePanel("metadata")}><CheckSquare2 size={15} />Metadata</button>
            <button type="button" className={releasePanel === "screenshots" ? "active" : ""} aria-current={releasePanel === "screenshots" ? "page" : undefined} onClick={() => setReleasePanel("screenshots")}><Images size={15} />Screenshots</button>
          </nav> : null}

          {loadingVersions ? (
            <div className="release-empty"><RefreshCw className="spin" size={30} /><h2>Loading releases</h2><p>Fetching the latest {platformLabel(selectedPlatform)} App Store version.</p></div>
          ) : selectedVersion ? (
            <>
            <div hidden={releasePanel !== "metadata"} className={selectedLocale && selectedBaseline && selectedDraft ? "release-editor-grid with-editor" : "release-editor-grid"}>
              <section className="localizations-region">
                <header className="localizations-header">
                  <div><h2>Localizations</h2><p>{localizations.length} {localizations.length === 1 ? "locale" : "locales"} · {drafts.size} edited</p></div>
                  <div className="localization-actions">
                    <label><span>Source:</span><select value={sourceLocale ?? ""} onChange={(event) => setSourceLocale(event.target.value as AppStoreLocale)}>{localizations.map((localization) => <option value={localization.locale} key={localization.id}>{localeNames[localization.locale]}</option>)}</select><ChevronDown size={15} /></label>
                    <button className="button secondary" type="button" disabled={!source || translationTargets.length === 0} onClick={() => setTranslationOpen(true)} aria-label="Translate release copy"><Languages size={16} />Translate</button>
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
            <ScreenshotManager
              appId={app.id}
              version={selectedVersion}
              localizations={localizations}
              visible={releasePanel === "screenshots"}
              onChanged={screenshotsChanged}
              onPendingChange={setScreenshotPending}
              key={selectedVersion.id}
            />
            </>
          ) : (
            <div className="release-empty"><FilePlus2 size={30} /><h2>Create the next {platformLabel(selectedPlatform)} version</h2><p>Carry existing locales forward, then edit release notes, promotional text, and keywords in one place.</p><button className="button primary" type="button" onClick={() => setCreateOpen(true)}>New version</button></div>
          )}

          <div className="release-dock">
            <span className={drafts.size || screenshotPending ? "activity-dot warning" : "activity-dot success"} />
            <strong>{submissionStatus?.id ? `Submitted · ${versionStateLabel(submissionStatus.state)}` : screenshotPending ? "Local screenshot changes" : drafts.size ? `${drafts.size} metadata draft${drafts.size === 1 ? "" : "s"}` : "No local drafts"}</strong>
            <span className="saved-state">{submissionStatus?.submittedAt ? `Sent ${new Date(submissionStatus.submittedAt).toLocaleString()}` : "Saved locally"}</span>
            <span className="activity-spacer" />
            <button className="button secondary" type="button" onClick={() => setActivityOpen((open) => !open)}>View activity</button>
            <button className="button secondary" type="button" disabled={!selectedVersion || readinessBusy} onClick={() => void validate()} aria-label="Validate release"><CheckSquare2 size={16} />Validate</button>
            <button className="button primary" type="button" disabled={!selectedVersion?.editable || !selectedBuild || drafts.size > 0 || screenshotPending || Boolean(submissionStatus?.id) || mutationBusy} onClick={() => void reviewSubmission()} aria-label="Review App Review submission"><Send size={16} />{submissionStatus?.id ? "Submitted" : "Submit for review"}</button>
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
      {translationOpen && source ? <TranslationDialog source={source} targets={translationTargets} status={translationStatus} onGenerate={generateTranslations} onClose={() => setTranslationOpen(false)} /> : null}
      {readinessOpen ? <ReadinessDialog report={readiness} demo={status?.mode === "demo"} busy={readinessBusy} error={readinessError} onRetry={() => void validate()} onClose={() => setReadinessOpen(false)} /> : null}
    </>
  );
};
