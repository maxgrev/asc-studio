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
  ReleaseCopyField,
  SubmitVersionMutationPlan,
  UpdateLocalizationsMutationPlan,
  ValidationReport,
  VersionLocalization,
  VersionLocalizationDraft,
  VersionSubmissionStatus,
} from "@asc-studio/contracts";
import { Check, CheckSquare2, ChevronDown, FilePlus2, FileText, Images, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../api.js";
import {
  draftFrom,
  localeNames,
  localizationFields,
  metadataIssues,
  platformLabel,
  storeListingIssues,
  type LocalizationField,
  versionStateLabel,
} from "../releaseMetadata.js";
import {
  clearReleaseDraftVersion,
  persistReleaseDraftState,
  readReleaseDraftState,
  reconcileReleaseDraftVersion,
  revertReleaseDraftLocale,
  updateReleaseDraftFields,
  type ReleaseDraftState,
} from "../releaseDraftState.js";
import { ReleaseMetadataWorkbench } from "./ReleaseMetadataWorkbench.js";
import {
  CreateVersionDialog,
  LocalizationReviewDialog,
  ReadinessDialog,
  SubmissionReviewDialog,
  TranslationDialog,
  type TranslationSelection,
} from "./ReleaseDialogs.js";
import { ScreenshotManager } from "./ScreenshotManager.js";
import { SearchOptimizationDialog } from "./SearchOptimizationDialog.js";

export interface ReleaseTarget {
  versionId?: string | undefined;
  platform?: AppStorePlatform | undefined;
  locale?: AppStoreLocale | undefined;
  field?: LocalizationField | "screenshots" | undefined;
}

interface ReleaseWorkspaceProps {
  app: AppSummary;
  status: AgentStatus | null;
  openAiConnection: OpenAiConnection | null;
  openAiConnectionLoading: boolean;
  openAiConnectionError: string | null;
  openAiSetupOpen: boolean;
  onReloadOpenAiConnection: () => Promise<void>;
  onManageOpenAi: () => void;
  target?: ReleaseTarget | null;
  suggestedKeyword?: string | null;
  onSuggestedKeywordUsed?: () => void;
  onScreenshotPendingChange: (versionId: string, pending: boolean, applying: boolean) => void;
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
  onReloadOpenAiConnection,
  onManageOpenAi,
  target,
  suggestedKeyword,
  onSuggestedKeywordUsed,
  onScreenshotPendingChange,
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
  const [draftState, setDraftState] = useState<ReleaseDraftState>(() => readReleaseDraftState(app.id));
  const [panel, setPanel] = useState<"metadata" | "screenshots">(target?.field === "screenshots" ? "screenshots" : "metadata");
  const [focusField, setFocusField] = useState<LocalizationField | null>(() => (
    target?.field && target.field !== "screenshots" ? target.field : null
  ));
  const [screenshotPending, setScreenshotPending] = useState(false);
  const [screenshotApplying, setScreenshotApplying] = useState(false);
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
  const [searchOptimizationOpen, setSearchOptimizationOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readiness, setReadiness] = useState<ValidationReport | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const selectedVersionIdRef = useRef<string | null>(selectedVersionId);
  const versionLoadGeneration = useRef(0);
  const pendingTargetVersionId = useRef<string | null>(target?.versionId ?? null);
  const pendingTargetLocale = useRef<AppStoreLocale | null>(target?.locale ?? null);
  const targetKey = target
    ? [target.platform ?? "", target.versionId ?? "", target.locale ?? "", target.field ?? ""].join("|")
    : null;
  const handledTargetKey = useRef<string | null>(targetKey);

  const chooseVersion = useCallback((versionId: string | null, manual = false) => {
    if (manual) {
      pendingTargetVersionId.current = null;
      versionLoadGeneration.current += 1;
    }
    if (selectedVersionIdRef.current === versionId) return;
    selectedVersionIdRef.current = versionId;
    setMutationError(null);
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
  const { draftsByVersion, dirtyFieldsByVersion } = draftState;
  const drafts = selectedVersionId ? draftsByVersion.get(selectedVersionId) ?? emptyDrafts : emptyDrafts;
  const dirtyFields = selectedVersionId
    ? dirtyFieldsByVersion.get(selectedVersionId) ?? new Map<AppStoreLocale, Set<LocalizationField>>()
    : new Map<AppStoreLocale, Set<LocalizationField>>();
  const baselineByLocale = useMemo(
    () => new Map(localizations.map((localization) => [localization.locale, draftFrom(localization)] as const)),
    [localizations],
  );
  const compatibleBuilds = useMemo(() => selectedVersion
    ? builds.filter((build) => (
      build.version === selectedVersion.versionString
      && build.platform === selectedVersion.platform
      && build.processingStatus === "Ready"
      && !build.expired
    ))
    : [], [builds, selectedVersion?.platform, selectedVersion?.versionString]);
  const selectedBuild = compatibleBuilds.find((build) => build.id === selectedBuildId) ?? null;
  const releaseScopeLocked = syncing
    || mutationBusy
    || Boolean(localizationPlan)
    || Boolean(submissionPlan)
    || createOpen
    || translationOpen
    || searchOptimizationOpen
    || readinessOpen
    || screenshotPending
    || screenshotApplying;
  const releaseModalOpen = createOpen
    || Boolean(localizationPlan)
    || Boolean(submissionPlan)
    || translationOpen
    || searchOptimizationOpen
    || readinessOpen;

  useEffect(() => {
    setSelectedBuildId((current) => (
      current && compatibleBuilds.some((build) => build.id === current)
        ? current
        : compatibleBuilds[0]?.id ?? null
    ));
  }, [compatibleBuilds]);

  useEffect(() => {
    persistReleaseDraftState(app.id, draftState);
  }, [app.id, draftState]);

  useEffect(() => {
    if (!screenshotPending) return;
    const protectPendingUploads = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingUploads);
    return () => window.removeEventListener("beforeunload", protectPendingUploads);
  }, [screenshotPending]);

  useEffect(() => {
    if (handledTargetKey.current === targetKey) return;
    handledTargetKey.current = targetKey;
    if (!target) return;
    if (target.versionId) pendingTargetVersionId.current = target.versionId;
    if (target.locale) pendingTargetLocale.current = target.locale;
    if (target.platform && target.platform !== selectedPlatform) {
      setSelectedPlatform(target.platform);
      chooseVersion(target.versionId ?? null);
    } else if (target.versionId) {
      chooseVersion(target.versionId);
    }
    if (target.locale) setSelectedLocale(target.locale);
    if (target.field === "screenshots") setPanel("screenshots");
    else if (target.field) {
      setPanel("metadata");
      setFocusField(target.field);
    }
  }, [chooseVersion, selectedPlatform, target, targetKey]);

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
        const baselines = new Map(response.localizations.map((localization) => [localization.locale, draftFrom(localization)] as const));
        setDraftState((current) => reconcileReleaseDraftVersion(current, selectedVersionId, baselines));
        const targetLocale = pendingTargetLocale.current ?? target?.locale ?? null;
        const preferred = response.localizations.find((item) => item.locale === targetLocale)?.locale
          ?? response.localizations.find((item) => item.locale === "en-US")?.locale
          ?? response.localizations[0]?.locale
          ?? null;
        if (preferred === targetLocale) pendingTargetLocale.current = null;
        setSelectedLocale(preferred);
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
        const baselines = new Map(localizationResponse.localizations.map((localization) => [localization.locale, draftFrom(localization)] as const));
        setDraftState((current) => reconcileReleaseDraftVersion(current, version.id, baselines));
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

  const updateField = (locale: AppStoreLocale, field: LocalizationField, value: string) => {
    if (!selectedVersionId || !selectedVersion?.editable || localizationPlan || mutationBusy) return;
    const baseline = baselineByLocale.get(locale);
    if (!baseline) return;
    setDraftState((current) => updateReleaseDraftFields(current, {
      versionId: selectedVersionId,
      baseline,
      fields: [field],
      values: { [field]: value },
    }));
  };

  const revertDraft = (locale: AppStoreLocale) => {
    if (!selectedVersionId || localizationPlan || mutationBusy) return;
    setDraftState((current) => revertReleaseDraftLocale(current, selectedVersionId, locale));
  };

  useEffect(() => {
    if (!suggestedKeyword || !selectedLocale || !selectedVersion?.editable || localizationPlan) return;
    const baseline = baselineByLocale.get(selectedLocale);
    if (!baseline) return;
    const current = drafts.get(selectedLocale) ?? baseline;
    const terms = current.keywords.split(",").map((value) => value.trim()).filter(Boolean);
    if (terms.some((value) => value.toLocaleLowerCase("en-US") === suggestedKeyword.toLocaleLowerCase("en-US"))) {
      onSuggestedKeywordUsed?.();
      return;
    }
    const keywords = [...terms, suggestedKeyword].join(",");
    if (keywords.length > 100) {
      setFatalError(`“${suggestedKeyword}” would push ${selectedLocale} keywords past Apple’s 100-character limit.`);
      onSuggestedKeywordUsed?.();
      return;
    }
    setDraftState((state) => updateReleaseDraftFields(state, {
      versionId: selectedVersion.id,
      baseline,
      fields: ["keywords"],
      values: { keywords },
    }));
    setPanel("metadata");
    setFocusField("keywords");
    onSuggestedKeywordUsed?.();
  }, [baselineByLocale, drafts, localizationPlan, onSuggestedKeywordUsed, selectedLocale, selectedVersion?.editable, selectedVersion?.id, suggestedKeyword]);

  const reviewLocalizations = async () => {
    if (!selectedVersion || drafts.size === 0 || mutationBusy || syncing || loadingLocalizations) return;
    const invalid = [...drafts].flatMap(([locale, draft]) => {
      const changed = dirtyFields.get(locale);
      return [...metadataIssues(draft), ...storeListingIssues(draft)]
        .filter((issue) => changed?.has(issue.field))
        .map((issue) => ({ ...issue, locale }));
    });
    const firstIssue = invalid[0];
    if (firstIssue) {
      setMutationError(`${localeNames[firstIssue.locale]}: ${firstIssue.message}${invalid.length > 1 ? ` ${invalid.length - 1} more issue${invalid.length === 2 ? "" : "s"} to fix before review.` : ""}`);
      setSelectedLocale(firstIssue.locale);
      setPanel("metadata");
      setFocusField(firstIssue.field);
      return;
    }
    setMutationBusy(true);
    setMutationError(null);
    try {
      const response = await api.planLocalizations({
        appId: app.id,
        versionId: selectedVersion.id,
        localizations: [...drafts].flatMap(([locale, draft]) => {
          const fields = dirtyFields.get(locale);
          return fields?.size
            ? [{ ...draft, fields: localizationFields.filter((field) => fields.has(field)) }]
            : [];
        }),
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
      setDraftState((current) => clearReleaseDraftVersion(current, planVersionId));
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
      const versionCreated = error instanceof ApiError && error.code === "app_store_connect_version_metadata_copy_failed";
      if (versionCreated) {
        setCreatePlan({ ...createPlan, state: "failed", error: error.message });
      } else if (error instanceof ApiError && ["plan_expired", "stale_plan", "plan_not_confirmable"].includes(error.code)) {
        setCreatePlan(null);
      }
      setMutationError(error instanceof Error ? error.message : "Version creation failed.");
      await loadVersions(versionCreated ? versionString : undefined);
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
    if (!selectedVersion || !selectedBuild || drafts.size > 0 || screenshotPending || screenshotApplying || submissionStatus?.id) return;
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

  const source = sourceLocale ? (drafts.get(sourceLocale) ?? baselineByLocale.get(sourceLocale) ?? null) : null;
  const translationTargets = [...baselineByLocale.values()].filter((draft) => draft.locale !== sourceLocale);
  const applyTranslations = async (selection: TranslationSelection) => {
    if (!selectedVersionId || !source) return;
    const versionId = selectedVersionId;
    const translatedValues = new Map<AppStoreLocale, Partial<Record<ReleaseCopyField, string>>>();
    if (selection.translateFields.length) {
      const sourceValues = Object.fromEntries(selection.translateFields.map((field) => [
        field,
        field === "keywords"
          ? source.keywords.split(",").map((term) => term.trim()).filter(Boolean).join(",")
          : source[field],
      ])) as GenerateReleaseCopyTranslationsInput["source"];
      const input: GenerateReleaseCopyTranslationsInput = {
        sourceLocale: source.locale,
        targetLocales: selection.targetLocales,
        fields: selection.translateFields,
        source: sourceValues,
      };
      const response = await api.generateReleaseCopyTranslations(input);
      for (const translation of response.translations) {
        const values: Partial<Record<ReleaseCopyField, string>> = {};
        for (const field of selection.translateFields) {
          const value = translation[field];
          if (value !== undefined) values[field] = value;
        }
        translatedValues.set(translation.locale, values);
      }
    }
    setDraftState((current) => {
      let next = current;
      for (const locale of selection.targetLocales) {
        const baseline = baselineByLocale.get(locale);
        if (!baseline) continue;
        const values: Partial<Record<LocalizationField, string>> = {};
        const translation = translatedValues.get(locale);
        for (const field of selection.translateFields) {
          const value = translation?.[field];
          if (value !== undefined) values[field] = value;
        }
        for (const field of selection.copyFields) values[field] = source[field];
        const fields = [...selection.translateFields, ...selection.copyFields] as LocalizationField[];
        next = updateReleaseDraftFields(next, { versionId, baseline, fields, values });
      }
      return next;
    });
    setTranslationOpen(false);
  };

  const handleScreenshotPendingChange = useCallback((pending: boolean, applying: boolean) => {
    setScreenshotPending(pending);
    setScreenshotApplying(applying);
    if (selectedVersionId) onScreenshotPendingChange(selectedVersionId, pending, applying);
  }, [onScreenshotPendingChange, selectedVersionId]);

  const dirtyFieldCount = [...dirtyFields.values()].reduce((total, fields) => total + fields.size, 0);

  return (
    <>
      <main className="workspace release-workspace" inert={releaseModalOpen ? true : undefined}>
        <header className="topbar release-topbar">
          <div><h1>{selectedVersion ? `Release ${selectedVersion.versionString}` : `${platformLabel(selectedPlatform)} releases`}</h1><p>Localized content, screenshots, build, and submission—together for this version.</p></div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void sync()} disabled={syncing || mutationBusy || screenshotPending || screenshotApplying} title={screenshotPending ? "Review or undo screenshot changes before syncing." : undefined} aria-label={syncing ? "Syncing releases" : "Sync releases"}>
              <RefreshCw size={17} className={syncing ? "spin" : undefined} /><span>{syncing ? "Syncing" : "Sync"}</span>
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
            <button className="button secondary" type="button" aria-label="Create new version" disabled={screenshotPending || screenshotApplying || syncing || mutationBusy || Boolean(localizationPlan)} title={screenshotPending ? "Review or undo screenshot changes before creating another version." : undefined} onClick={() => {
              setCreatePlan(null);
              setMutationError(null);
              setCreateOpen(true);
            }}><FilePlus2 size={16} />New version</button>
          </section>

          {loadingVersions ? (
            <div className="release-empty"><RefreshCw className="spin" size={30} /><h2>Loading releases</h2><p>Fetching the latest {platformLabel(selectedPlatform)} App Store version.</p></div>
          ) : selectedVersion ? (
            <>
              <nav className="release-tabs release-work-tabs" aria-label="Release content" role="tablist">
                <button type="button" role="tab" aria-selected={panel === "metadata"} className={panel === "metadata" ? "active" : ""} disabled={Boolean(localizationPlan)} onClick={() => setPanel("metadata")}><FileText size={16} />Localized content</button>
                <button type="button" role="tab" aria-selected={panel === "screenshots"} className={panel === "screenshots" ? "active" : ""} disabled={Boolean(localizationPlan)} onClick={() => setPanel("screenshots")}><Images size={16} />Screenshots{screenshotPending ? <span className="tab-pending-dot" aria-label="Changes pending" /> : null}</button>
                <span className="release-work-status">
                  <span><strong>{drafts.size ? `${drafts.size} locale draft${drafts.size === 1 ? "" : "s"}` : "Content is current"}</strong><small>{drafts.size ? `${dirtyFieldCount} edited field${dirtyFieldCount === 1 ? "" : "s"} saved locally` : "No unreviewed content changes"}</small></span>
                  <button className="button primary" type="button" disabled={!selectedVersion.editable || drafts.size === 0 || mutationBusy || syncing || loadingLocalizations || Boolean(localizationPlan)} aria-busy={mutationBusy && !releaseModalOpen} onClick={() => void reviewLocalizations()}>{mutationBusy ? <RefreshCw size={15} className="spin" /> : <CheckSquare2 size={15} />}{mutationBusy ? "Preparing review…" : `Review changes${drafts.size ? ` (${drafts.size})` : ""}`}</button>
                </span>
              </nav>

              <div className="release-mobile-context" aria-label="Release status and local work">
                <span><small>Version status</small><strong>{submissionStatus?.id ? versionStateLabel(submissionStatus.state) : versionStateLabel(selectedVersion.state)}</strong></span>
                {panel === "metadata" ? <button className="button primary" type="button" disabled={!selectedVersion.editable || drafts.size === 0 || mutationBusy || syncing || loadingLocalizations || Boolean(localizationPlan)} aria-busy={mutationBusy && !releaseModalOpen} onClick={() => void reviewLocalizations()}>{mutationBusy ? <RefreshCw size={15} className="spin" /> : <CheckSquare2 size={15} />}{mutationBusy ? "Preparing review…" : `Review changes (${drafts.size})`}</button>
                  : <span className={screenshotPending ? "pending" : ""}><small>Screenshots</small><strong>{screenshotApplying ? "Applying changes…" : screenshotPending ? "Changes pending" : "No local changes"}</strong></span>}
              </div>

              {mutationError && !releaseModalOpen ? <div className="error-banner" role="alert"><span>{mutationError}</span><button type="button" onClick={() => setMutationError(null)}>Dismiss</button></div> : null}

              <div hidden={panel !== "metadata"} className="release-metadata-panel" role="tabpanel">
                <ReleaseMetadataWorkbench
                  localizations={localizations}
                  drafts={drafts}
                  dirtyFields={dirtyFields}
                  selectedLocale={selectedLocale}
                  sourceLocale={sourceLocale}
                  loading={loadingLocalizations}
                  locked={releaseScopeLocked}
                  editable={selectedVersion.editable}
                  focusField={focusField}
                  onSelectLocale={setSelectedLocale}
                  onSelectSourceLocale={setSourceLocale}
                  onFieldChange={updateField}
                  onRevertLocale={revertDraft}
                  onTranslateAdapt={() => setTranslationOpen(true)}
                  onOptimizeSearch={() => setSearchOptimizationOpen(true)}
                  onFocusFieldHandled={() => setFocusField(null)}
                />
              </div>
              <ScreenshotManager
                appId={app.id}
                version={selectedVersion}
                localizations={localizations}
                preferredLocale={selectedLocale}
                visible={panel === "screenshots"}
                locked={loadingVersions || loadingLocalizations || syncing || mutationBusy || Boolean(localizationPlan)}
                onChanged={async () => {
                  const response = await api.localizations(app.id, selectedVersion.id);
                  setLocalizations(response.localizations);
                  const baselines = new Map(response.localizations.map((localization) => [localization.locale, draftFrom(localization)] as const));
                  setDraftState((current) => reconcileReleaseDraftVersion(current, selectedVersion.id, baselines));
                }}
                onPendingChange={handleScreenshotPendingChange}
                key={selectedVersion.id}
              />
            </>
          ) : (
            <div className="release-empty"><FilePlus2 size={30} /><h2>Create the next {platformLabel(selectedPlatform)} version</h2><p>Copy each locale’s stable content forward, write fresh release notes, then finish screenshots and submission here.</p><button className="button primary" type="button" onClick={() => setCreateOpen(true)}>New version</button></div>
          )}

          <div className="release-dock">
            <span className={drafts.size || screenshotPending ? "activity-dot warning" : "activity-dot success"} />
            <strong>{screenshotApplying
              ? "Applying screenshot changes"
              : submissionStatus?.id
              ? `Submitted · ${versionStateLabel(submissionStatus.state)}`
              : screenshotPending
                ? "Local screenshot changes"
                : drafts.size
                  ? `${drafts.size} locale draft${drafts.size === 1 ? "" : "s"} · ${dirtyFieldCount} field${dirtyFieldCount === 1 ? "" : "s"}`
                  : selectedBuild
                    ? "Release is ready for a final check"
                    : "Choose a ready build before submission"}</strong>
            <span className="saved-state">{screenshotApplying
              ? "Stay here until App Store Connect confirms the update."
              : screenshotPending
                ? "Review or undo them in Screenshots."
                : submissionStatus?.submittedAt
                  ? `Sent ${new Date(submissionStatus.submittedAt).toLocaleString()}`
                  : drafts.size ? "Content changes are saved locally." : "No unreviewed local changes."}</span>
            <span className="activity-spacer" />
            <button className="button secondary release-activity-button" type="button" onClick={() => setActivityOpen((open) => !open)}>View activity</button>
            <button
              className="button secondary release-readiness-button"
              type="button"
              disabled={!selectedVersion || readinessBusy || drafts.size > 0 || screenshotPending || screenshotApplying}
              title={drafts.size || screenshotPending ? "Review local content and screenshot changes before checking readiness." : undefined}
              onClick={() => void validate()}
              aria-label="Check release readiness"
            ><CheckSquare2 size={16} />Check readiness</button>
            <button className="button primary release-submit-button" type="button" disabled={!selectedVersion?.editable || !selectedBuild || drafts.size > 0 || screenshotPending || screenshotApplying || Boolean(submissionStatus?.id) || mutationBusy} onClick={() => void reviewSubmission()} aria-label="Review App Review submission"><Send size={16} />{submissionStatus?.id ? "Submitted" : "Submit for review"}</button>
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
      {searchOptimizationOpen && selectedVersion && selectedLocale ? <SearchOptimizationDialog
        key={`${app.id}:${selectedVersion.id}:${selectedLocale}`}
        app={app}
        version={selectedVersion}
        locale={selectedLocale}
        initialKeywords={drafts.get(selectedLocale)?.keywords}
        onClose={() => setSearchOptimizationOpen(false)}
        onBusyChange={setMutationBusy}
        onSaved={async (values) => {
          const response = await api.localizations(app.id, selectedVersion.id);
          setLocalizations(response.localizations);
          const baselines = new Map(response.localizations.map((item) => [item.locale, draftFrom(item)] as const));
          const baseline = baselines.get(selectedLocale);
          setDraftState((current) => {
            const next = reconcileReleaseDraftVersion(current, selectedVersion.id, baselines);
            return baseline ? updateReleaseDraftFields(next, { versionId: selectedVersion.id, baseline, fields: ["keywords"], values: { keywords: values.keywords } }) : next;
          });
          await refreshEvents();
        }}
      /> : null}
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
        onApply={applyTranslations}
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
          const locale = step.locale as AppStoreLocale || selectedLocale || null;
          if (locale) setSelectedLocale(locale);
          if (step.field === "screenshots") setPanel("screenshots");
          else {
            setPanel("metadata");
            if (localizationFields.includes(step.field as LocalizationField)) setFocusField(step.field as LocalizationField);
          }
        }}
        onClose={() => setReadinessOpen(false)}
      /> : null}
    </>
  );
};
