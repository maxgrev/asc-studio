import type {
  AppStorePlatform,
  AppStoreVersion,
  CreateVersionInput,
  CreateVersionMutationPlan,
  GenerateReleaseCopyTranslationsInput,
  ReleaseCopyField,
  SubmitVersionMutationPlan,
  UpdateScreenshotsMutationPlan,
  TranslationProviderStatus,
  UpdateLocalizationsMutationPlan,
  ValidationReport,
  VersionLocalizationDraft,
} from "@asc-studio/contracts";
import { AlertTriangle, ArrowRight, CheckCircle2, Image, KeyRound, Languages, Send, ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  localeNames,
  metadataFieldLabels,
  metadataFields,
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

const DialogFrame = ({ title, subtitle, wide, busy, onClose, children }: DialogFrameProps) => (
  <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className={wide ? "dialog release-dialog wide" : "dialog release-dialog"} role="dialog" aria-modal="true" aria-label={title}>
      <header className="dialog-header">
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={19} /></button>
      </header>
      {children}
    </section>
  </div>
);

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
        const changed = metadataFields.filter((field) => before[field] !== after[field]);
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
  onClose: () => void;
}

export const ReadinessDialog = ({ report, demo, busy, error, onRetry, onClose }: ReadinessDialogProps) => (
  <DialogFrame title="Submission readiness" subtitle={demo ? "Sample results using the same validation contract." : "Live preflight results from Apple's public API."} busy={busy} onClose={onClose}>
    <div className="dialog-content readiness-content">
      {busy ? <div className="readiness-loading"><span className="spinner" />Checking App Store metadata, build, review details, and availability…</div> : report ? (
        <>
          <div className={report.summary.blocking === 0 ? "readiness-summary ready" : "readiness-summary blocked"}>
            {report.summary.blocking === 0 ? <CheckCircle2 size={23} /> : <AlertTriangle size={23} />}
            <div><strong>{report.summary.blocking === 0 ? "Ready to continue" : `${report.summary.blocking} blocking issue${report.summary.blocking === 1 ? "" : "s"}`}</strong><span>{report.summary.errors} errors · {report.summary.warnings} warnings</span></div>
          </div>
          <ol className="remediation-list">
            {report.remediation.steps.length ? report.remediation.steps.map((step) => (
              <li className={step.blocking ? "blocking" : "warning"} key={`${step.order}-${step.checkId}`}>
                <span>{step.order}</span><div><strong>{step.message}</strong><p>{step.remediation}</p>{step.locale ? <small>{step.locale}{step.field ? ` · ${step.field}` : ""}</small> : null}</div>
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
  status: TranslationProviderStatus | null;
  onGenerate: (input: GenerateReleaseCopyTranslationsInput) => Promise<void>;
  onClose: () => void;
}

export const TranslationDialog = ({ source, targets, status, onGenerate, onClose }: TranslationDialogProps) => {
  const [includeWhatsNew, setIncludeWhatsNew] = useState(true);
  const [includePromotionalText, setIncludePromotionalText] = useState(false);
  const [selectedLocales, setSelectedLocales] = useState(() => new Set(targets.map((target) => target.locale)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields: ReleaseCopyField[] = [
    ...(includeWhatsNew ? ["whatsNew" as const] : []),
    ...(includePromotionalText ? ["promotionalText" as const] : []),
  ];
  const targetLocales = targets.filter((target) => selectedLocales.has(target.locale)).map((target) => target.locale);
  const selectedSourceIsEmpty = fields.some((field) => !source[field].trim());
  const allSelected = selectedLocales.size === targets.length;

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
        <div className={status?.configured ? "translation-provider ready" : "translation-provider unconfigured"}>
          {status?.configured ? <Languages size={19} /> : <KeyRound size={19} />}
          <p>
            <strong>{status?.provider === "demo" ? "Sample translator" : status?.configured ? `OpenAI · ${status.model}` : "OpenAI API key needed"}</strong>
            <span>{status?.detail ?? "Checking the local translation provider…"}</span>
            {status && !status.configured ? <code>OPENAI_API_KEY="your-key" npm run local</code> : null}
          </p>
        </div>

        <section className="translation-field-picker" aria-labelledby="translation-fields-title">
          <header><div><h3 id="translation-fields-title">Choose what to translate</h3><p>What’s New is selected by default. Promotional text stays unchanged unless you include it.</p></div></header>
          <label className={includeWhatsNew ? "translation-field selected" : "translation-field"}>
            <input type="checkbox" checked={includeWhatsNew} onChange={(event) => setIncludeWhatsNew(event.target.checked)} />
            <span><strong>What’s New</strong><small>{source.whatsNew.length} / 4,000</small><em>{source.whatsNew || "Write the source release notes first."}</em></span>
          </label>
          <label className={includePromotionalText ? "translation-field selected" : "translation-field"}>
            <input type="checkbox" checked={includePromotionalText} onChange={(event) => setIncludePromotionalText(event.target.checked)} />
            <span><strong>Promotional text</strong><small>{source.promotionalText.length} / 170 · optional</small><em>{source.promotionalText || "Write the source promotional text first."}</em></span>
          </label>
        </section>

        <div className="keyword-boundary">
          <ShieldCheck size={19} />
          <p><strong>Keywords are kept separate</strong><span>This action never reads or changes keywords. Keep researching and editing them for each locale.</span></p>
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
          disabled={busy || !status?.configured || fields.length === 0 || targetLocales.length === 0 || selectedSourceIsEmpty}
        >
          <Languages size={16} />{busy ? "Translating…" : `Translate ${targetLocales.length} locale${targetLocales.length === 1 ? "" : "s"}`}
        </button>
      </footer>
    </DialogFrame>
  );
};
