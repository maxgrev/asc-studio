import type {
  AppStorePlatform,
  AppStoreVersion,
  CreateVersionInput,
  CreateVersionMutationPlan,
  GenerateReleaseCopyTranslationsInput,
  OpenAiConnection,
  ReleaseCopyField,
  SubmitVersionMutationPlan,
  UpdateScreenshotsMutationPlan,
  UpdateLocalizationsMutationPlan,
  ValidationReport,
  VersionLocalizationDraft,
} from "@asc-studio/contracts";
import { AlertTriangle, ArrowRight, CheckCircle2, Image, KeyRound, Languages, Send, ShieldCheck, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  localeNames,
  localizationFields,
  metadataFieldLabels,
  nextPatchVersion,
  platformLabel,
} from "../releaseMetadata.js";

interface DialogFrameProps {
  title: string;
  subtitle?: string;
  wide?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}

const DialogFrame = ({ title, subtitle, wide, busy, onClose, children }: DialogFrameProps) => {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = closeRef.current && !closeRef.current.disabled ? closeRef.current : dialogRef.current;
    initialFocus?.focus();
    return () => previousFocus?.focus();
  }, []);

  const keepFocusInside = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (!focusable.includes(document.activeElement as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        ref={dialogRef}
        className={wide ? "dialog release-dialog wide" : "dialog release-dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
      >
        <header className="dialog-header">
          <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  );
};

interface CreateVersionDialogProps {
  appId: string;
  platform: AppStorePlatform;
  versions: AppStoreVersion[];
  plan: CreateVersionMutationPlan | null;
  busy: boolean;
  error: string | null;
  onReview: (input: CreateVersionInput) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export const CreateVersionDialog = ({ appId, platform, versions, plan, busy, error, onReview, onConfirm, onClose }: CreateVersionDialogProps) => {
  const latest = versions[0];
  const [versionString, setVersionString] = useState(nextPatchVersion(latest?.versionString));
  const [copyMetadataFrom, setCopyMetadataFrom] = useState<string>(latest?.versionString ?? "");
  const [excludeWhatsNew, setExcludeWhatsNew] = useState(true);
  const validVersion = /^\d+(?:\.\d+){1,2}$/.test(versionString);

  return (
    <DialogFrame title={plan ? "Review new version" : "Create a new version"} subtitle="Start an editable App Store version and carry stable metadata forward." busy={busy} onClose={onClose}>
      {!plan ? (
        <div className="dialog-content version-form">
          <label><span>Version</span><input value={versionString} onChange={(event) => setVersionString(event.target.value)} placeholder="2.5.0" /></label>
          <label><span>Platform</span><select value={platform} disabled><option value={platform}>{platformLabel(platform)}</option></select></label>
          <label className="full-row"><span>Copy metadata from</span><select value={copyMetadataFrom} onChange={(event) => setCopyMetadataFrom(event.target.value)}><option value="">Start empty</option>{versions.map((version) => <option value={version.versionString} key={version.id}>{version.versionString} · {platformLabel(version.platform)}</option>)}</select></label>
          <label className="checkbox-row full-row"><input type="checkbox" checked={excludeWhatsNew} onChange={(event) => setExcludeWhatsNew(event.target.checked)} /><span><strong>Leave What’s New empty</strong><small>Release notes should describe this update, not the last one.</small></span></label>
          <div className="safety-note full-row"><AlertTriangle size={17} /><span>Reviewing creates an expiring plan. ASC Studio checks again before it writes to App Store Connect.</span></div>
        </div>
      ) : (
        <div className="dialog-content">
          <div className="review-label">Review exact change</div>
          <div className="version-plan-summary">
            <div><small>Create</small><strong>{plan.after.versionString}</strong></div>
            <div><small>Platform</small><strong>{platformLabel(plan.after.platform)}</strong></div>
            <div><small>Copy from</small><strong>{plan.after.copyMetadataFrom ?? "Start empty"}</strong></div>
            <div><small>What’s New</small><strong>{plan.after.excludeWhatsNew ? "Leave empty" : "Copy source"}</strong></div>
          </div>
          <p className="mutation-warning">This creates a real App Store version. It does not attach a build or submit it for review.</p>
        </div>
      )}
      {error ? <div className="dialog-error" role="alert">{error}</div> : null}
      <footer className="dialog-footer">
        <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        {!plan ? (
          <button className="button primary" type="button" disabled={!validVersion || busy} onClick={() => onReview({
            appId,
            versionString,
            platform,
            copyMetadataFrom: copyMetadataFrom || null,
            releaseType: "MANUAL",
            excludeWhatsNew,
          })}>{busy ? "Creating plan…" : "Review version"}</button>
        ) : (
          <button className="button primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? "Creating…" : `Create ${plan.after.versionString}`}</button>
        )}
      </footer>
    </DialogFrame>
  );
};

interface LocalizationReviewDialogProps {
  plan: UpdateLocalizationsMutationPlan;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export const LocalizationReviewDialog = ({ plan, busy, error, onConfirm, onClose }: LocalizationReviewDialogProps) => (
  <DialogFrame title="Review metadata changes" subtitle={`${plan.target.versionString} · ${plan.target.locales.length} locale${plan.target.locales.length === 1 ? "" : "s"}`} wide busy={busy} onClose={onClose}>
    <div className="dialog-content localization-diff-list">
      {plan.after.localizations.map((after) => {
        const before = plan.before.localizations.find((item) => item.locale === after.locale);
        if (!before) return null;
        const changed = localizationFields.filter((field) => before[field] !== after[field]);
        return (
          <section className="locale-diff" key={after.locale}>
            <header><strong>{localeNames[after.locale]}</strong><span>{after.locale}</span></header>
            {changed.map((field) => (
              <div className="field-diff" key={field}>
                <div className="field-diff-label">{metadataFieldLabels[field]}</div>
                <div><small>Before</small><p>{before[field] || "Empty"}</p></div>
                <ArrowRight size={17} />
                <div><small>After</small><p>{after[field] || "Empty"}</p></div>
              </div>
            ))}
          </section>
        );
      })}
      <div className="safety-note"><AlertTriangle size={17} /><span>ASC Studio will read these locales again before applying the plan. If anything changed, the plan stops.</span></div>
    </div>
    {error ? <div className="dialog-error" role="alert">{error}</div> : null}
    <footer className="dialog-footer">
      <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Applying…" : "Confirm changes"}</button>
    </footer>
  </DialogFrame>
);

interface ScreenshotReviewDialogProps {
  plan: UpdateScreenshotsMutationPlan;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export const ScreenshotReviewDialog = ({ plan, busy, error, onConfirm, onClose }: ScreenshotReviewDialogProps) => (
  <DialogFrame
    title="Review screenshot changes"
    subtitle={`${plan.target.versionString} · ${localeNames[plan.target.locale]} · ${plan.target.displayType}`}
    wide
    busy={busy}
    onClose={onClose}
  >
    <div className="dialog-content screenshot-review">
      <div className="review-label">Review exact change</div>
      <div className="version-plan-summary">
        <div><small>Current set</small><strong>{plan.before.screenshots.length} screenshot{plan.before.screenshots.length === 1 ? "" : "s"}</strong></div>
        <div><small>Remove</small><strong>{plan.after.deleteIds.length}</strong></div>
        <div><small>Upload</small><strong>{plan.after.uploads.length}</strong></div>
        <div><small>Result</small><strong>{plan.before.screenshots.length - plan.after.deleteIds.length + plan.after.uploads.length}</strong></div>
      </div>
      {plan.after.deleteIds.length ? (
        <section className="screenshot-plan-group">
          <h3>Remove from App Store Connect</h3>
          {plan.before.screenshots.filter((asset) => plan.after.deleteIds.includes(asset.id)).map((asset) => (
            <div className="screenshot-plan-row remove" key={asset.id}><Image size={16} /><span>{asset.fileName}</span><small>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "Size unavailable"}</small></div>
          ))}
        </section>
      ) : null}
      {plan.after.uploads.length ? (
        <section className="screenshot-plan-group">
          <h3>Upload in this order</h3>
          {plan.after.uploads.map((upload, index) => (
            <div className="screenshot-plan-row" key={upload.uploadId}><span className="screenshot-plan-order">{index + 1}</span><span>{upload.fileName}</span><small>{upload.width} × {upload.height}</small></div>
          ))}
        </section>
      ) : null}
      <div className="submission-warning"><AlertTriangle size={18} /><p><strong>This changes the live product page.</strong><span>ASC Studio will re-read the screenshot set before deleting or uploading any file. Local files are checked again before the first change.</span></p></div>
    </div>
    {error ? <div className="dialog-error" role="alert">{error}</div> : null}
    <footer className="dialog-footer">
      <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? "Applying…" : "Confirm screenshot changes"}</button>
    </footer>
  </DialogFrame>
);

interface SubmissionReviewDialogProps {
  plan: SubmitVersionMutationPlan;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export const SubmissionReviewDialog = ({ plan, busy, error, onConfirm, onClose }: SubmissionReviewDialogProps) => (
  <DialogFrame
    title="Review App Review submission"
    subtitle={`${plan.target.versionString} · ${platformLabel(plan.target.platform)}`}
    wide
    busy={busy}
    onClose={onClose}
  >
    <div className="dialog-content submission-review">
      <div className="review-label">Review exact change</div>
      <div className="version-plan-summary">
        <div><small>Version</small><strong>{plan.target.versionString}</strong></div>
        <div><small>Build</small><strong>{plan.target.buildNumber}</strong></div>
        <div><small>Build action</small><strong>{plan.after.attachBuild ? "Attach selected build" : "Already attached"}</strong></div>
        <div><small>Validation</small><strong>{plan.before.validation.blocking} blocker{plan.before.validation.blocking === 1 ? "" : "s"} · {plan.before.validation.warnings} warning{plan.before.validation.warnings === 1 ? "" : "s"}</strong></div>
      </div>
      <div className="submission-warning"><AlertTriangle size={18} /><p><strong>This sends the version to Apple.</strong><span>ASC Studio will check the version, build, profile, and validation result again. If any reviewed value changed, it will stop.</span></p></div>
    </div>
    {error ? <div className="dialog-error" role="alert">{error}</div> : null}
    <footer className="dialog-footer">
      <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="button primary" type="button" onClick={onConfirm} disabled={busy}>
        <Send size={16} />{busy ? "Submitting…" : "Submit to App Review"}
      </button>
    </footer>
  </DialogFrame>
);

interface ReadinessDialogProps {
  report: ValidationReport | null;
  demo: boolean;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onFix?: (step: ValidationReport["remediation"]["steps"][number]) => void;
  onClose: () => void;
}

export const ReadinessDialog = ({ report, demo, busy, error, onRetry, onFix, onClose }: ReadinessDialogProps) => (
  <DialogFrame title="Submission readiness" subtitle={demo ? "Sample results using the same validation contract." : "Live preflight results from Apple's public API."} busy={busy} onClose={onClose}>
    <div className="dialog-content readiness-content">
      {busy ? <div className="readiness-loading"><span className="spinner" />Checking App Store metadata, release notes, build, and availability…</div> : report ? (
        <>
          <div className={report.summary.blocking === 0 ? "readiness-summary ready" : "readiness-summary blocked"}>
            {report.summary.blocking === 0 ? <CheckCircle2 size={23} /> : <AlertTriangle size={23} />}
            <div><strong>{report.summary.blocking === 0 ? "Ready to continue" : `${report.summary.blocking} blocking issue${report.summary.blocking === 1 ? "" : "s"}`}</strong><span>{report.summary.errors} errors · {report.summary.warnings} warnings</span></div>
          </div>
          <ol className="remediation-list">
            {report.remediation.steps.length ? report.remediation.steps.map((step) => (
              <li className={step.blocking ? "blocking" : "warning"} key={`${step.order}-${step.checkId}`}>
                <span>{step.order}</span><div><strong>{step.message}</strong><p>{step.remediation}</p>{step.locale ? <small>{step.locale}{step.field ? ` · ${step.field}` : ""}</small> : null}</div>
                {onFix && ["description", "promotionalText", "keywords", "marketingUrl", "supportUrl", "screenshots"].includes(step.field)
                  ? <button className="button secondary remediation-fix" type="button" onClick={() => onFix(step)}>Open Store Listing</button>
                  : null}
              </li>
            )) : <li className="all-clear"><CheckCircle2 size={18} />No fixes are required by the current report.</li>}
          </ol>
        </>
      ) : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
    </div>
    <footer className="dialog-footer">
      {error ? <button className="button secondary" type="button" onClick={onRetry} disabled={busy}>Try again</button> : null}
      <button className="button primary" type="button" onClick={onClose} disabled={busy}>Done</button>
    </footer>
  </DialogFrame>
);

interface TranslationDialogProps {
  source: VersionLocalizationDraft;
  targets: VersionLocalizationDraft[];
  connection: OpenAiConnection | null;
  connectionLoading: boolean;
  connectionError: string | null;
  onRetryConnection: () => Promise<void>;
  onManageOpenAi: () => void;
  onGenerate: (input: GenerateReleaseCopyTranslationsInput) => Promise<void>;
  onClose: () => void;
}

export const TranslationDialog = ({
  source,
  targets,
  connection,
  connectionLoading,
  connectionError,
  onRetryConnection,
  onManageOpenAi,
  onGenerate,
  onClose,
}: TranslationDialogProps) => {
  const [selectedLocales, setSelectedLocales] = useState(() => new Set(targets.map((target) => target.locale)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields: ReleaseCopyField[] = ["whatsNew"];
  const targetLocales = targets.filter((target) => selectedLocales.has(target.locale)).map((target) => target.locale);
  const selectedSourceIsEmpty = fields.some((field) => !source[field].trim());
  const allSelected = selectedLocales.size === targets.length;
  const providerReady = Boolean(connection?.configured);
  const providerTitle = connection?.source === "demo"
    ? "Sample translator"
    : connection?.source === "environment" && !connection.configured
      ? "Environment-managed OpenAI needs attention"
    : providerReady
      ? `OpenAI · ${connection?.model ?? "Configured model"}`
      : connectionError
        ? "OpenAI status unavailable"
        : connectionLoading
          ? "Checking OpenAI setup"
          : "OpenAI is not set up";
  const providerDetail = connection?.source === "demo"
    ? "Demo mode returns marked sample translations and never calls OpenAI."
    : connection?.source === "environment"
      ? connection.configured
        ? `Ready for writing assistance. Managed by OPENAI_API_KEY${connection.modelSource === "environment" ? " and ASC_STUDIO_OPENAI_MODEL" : ""}.`
        : "OPENAI_API_KEY is empty or invalid. Update the environment value, then restart ASC Studio."
      : connection?.source === "local"
        ? "Ready for writing assistance. The API key is protected by macOS Keychain."
        : connectionError ?? (connectionLoading
          ? "Reading the local writing-assistance connection…"
          : "Add an API key in Connections to translate release metadata.");

  const toggleLocale = (locale: VersionLocalizationDraft["locale"]) => {
    setSelectedLocales((current) => {
      const next = new Set(current);
      if (next.has(locale)) next.delete(locale);
      else next.add(locale);
      return next;
    });
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await onGenerate({
        sourceLocale: source.locale,
        targetLocales,
        fields,
        source: {
          whatsNew: source.whatsNew,
          promotionalText: source.promotionalText,
        },
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "ASC Studio could not generate translations.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame
      title="Translate release copy"
      subtitle={`Use ${localeNames[source.locale]} as the source. Generated text stays in local drafts until you review it.`}
      wide
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-content translation-dialog">
        <div className={providerReady ? "translation-provider ready" : connectionError ? "translation-provider error" : "translation-provider unconfigured"}>
          {providerReady ? <Languages size={19} /> : <KeyRound size={19} />}
          <p>
            <strong>{providerTitle}</strong>
            <span>{providerDetail}</span>
          </p>
          {connectionError ? <button className="button secondary compact" type="button" onClick={() => void onRetryConnection()}>Retry</button> : null}
          {!connectionLoading && !connectionError && connection?.source !== "demo" && connection?.source !== "environment" ? (
            <button className="button secondary compact" type="button" onClick={onManageOpenAi}>{providerReady ? "Manage" : "Set up OpenAI"}</button>
          ) : null}
        </div>

        <section className="translation-field-picker" aria-labelledby="translation-fields-title">
          <header><div><h3 id="translation-fields-title">Translate What’s New</h3><p>Release translation is intentionally limited to the notes for this version.</p></div></header>
          <label className="translation-field selected">
            <input type="checkbox" checked readOnly />
            <span><strong>What’s New</strong><small>{source.whatsNew.length} / 4,000</small><em>{source.whatsNew || "Write the source release notes first."}</em></span>
          </label>
        </section>

        <div className="keyword-boundary">
          <ShieldCheck size={19} />
          <p><strong>Storefront copy stays in Store Listing</strong><span>This action never reads or changes descriptions, promotional text, keywords, URLs, or screenshots.</span></p>
        </div>

        <section className="translation-targets" aria-labelledby="translation-targets-title">
          <header>
            <div><h3 id="translation-targets-title">Target locales</h3><p>{selectedLocales.size} of {targets.length} selected</p></div>
            <button className="text-button" type="button" onClick={() => setSelectedLocales(allSelected ? new Set() : new Set(targets.map((target) => target.locale)))}>{allSelected ? "Clear all" : "Select all"}</button>
          </header>
          <div className="translation-target-grid">
            {targets.map((target) => (
              <label key={target.locale} className={selectedLocales.has(target.locale) ? "selected" : ""}>
                <input type="checkbox" checked={selectedLocales.has(target.locale)} onChange={() => toggleLocale(target.locale)} />
                <span><strong>{localeNames[target.locale]}</strong><small>{target.locale}</small></span>
              </label>
            ))}
          </div>
        </section>
      </div>
      {selectedSourceIsEmpty ? <div className="dialog-error" role="alert">Write the selected source field before translating it.</div> : null}
      {error ? <div className="dialog-error" role="alert">{error}</div> : null}
      <footer className="dialog-footer">
        <button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <button
          className="button primary"
          type="button"
          onClick={() => void generate()}
          disabled={busy || !providerReady || fields.length === 0 || targetLocales.length === 0 || selectedSourceIsEmpty}
        >
          <Languages size={16} />{busy ? "Translating…" : `Translate ${targetLocales.length} locale${targetLocales.length === 1 ? "" : "s"}`}
        </button>
      </footer>
    </DialogFrame>
  );
};
