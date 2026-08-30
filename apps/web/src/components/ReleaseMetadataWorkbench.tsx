import type {
  AppStoreLocale,
  VersionLocalization,
  VersionLocalizationDraft,
} from "@asc-studio/contracts";
import {
  BadgeCheck,
  Check,
  FileText,
  Languages,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import {
  draftFrom,
  localeNames,
  metadataFieldLabels,
  metadataIssues,
  storeListingIssues,
  type LocalizationField,
} from "../releaseMetadata.js";

export interface ReleaseMetadataWorkbenchProps {
  localizations: VersionLocalization[];
  drafts: ReadonlyMap<AppStoreLocale, VersionLocalizationDraft>;
  dirtyFields: ReadonlyMap<AppStoreLocale, ReadonlySet<LocalizationField>>;
  selectedLocale: AppStoreLocale | null;
  sourceLocale: AppStoreLocale | null;
  loading: boolean;
  locked: boolean;
  editable: boolean;
  focusField: LocalizationField | null;
  onSelectLocale: (locale: AppStoreLocale) => void;
  onSelectSourceLocale: (locale: AppStoreLocale) => void;
  onFieldChange: (locale: AppStoreLocale, field: LocalizationField, value: string) => void;
  onRevertLocale: (locale: AppStoreLocale) => void;
  onTranslateAdapt: () => void;
  onFocusFieldHandled: () => void;
}

interface LocalizationIssue {
  field: LocalizationField;
  message: string;
}

const fieldLimits: Record<LocalizationField, number> = {
  whatsNew: 4_000,
  promotionalText: 170,
  description: 4_000,
  keywords: 100,
  supportUrl: 4_000,
  marketingUrl: 4_000,
};

const fieldOrder: LocalizationField[] = [
  "whatsNew",
  "promotionalText",
  "description",
  "keywords",
  "supportUrl",
  "marketingUrl",
];

const issuesFor = (draft: VersionLocalizationDraft): LocalizationIssue[] => [
  ...metadataIssues(draft),
  ...storeListingIssues(draft),
];

export const ReleaseMetadataWorkbench = ({
  localizations,
  drafts,
  dirtyFields,
  selectedLocale,
  sourceLocale,
  loading,
  locked,
  editable,
  focusField,
  onSelectLocale,
  onSelectSourceLocale,
  onFieldChange,
  onRevertLocale,
  onTranslateAdapt,
  onFocusFieldHandled,
}: ReleaseMetadataWorkbenchProps) => {
  const idPrefix = useId().replaceAll(":", "");
  const fieldRefs = useRef<Partial<Record<LocalizationField, HTMLTextAreaElement | HTMLInputElement | null>>>({});
  const handledFocus = useRef<string | null>(null);
  const baselines = useMemo(
    () => new Map(localizations.map((localization) => [localization.locale, draftFrom(localization)] as const)),
    [localizations],
  );
  const selectedBaseline = selectedLocale ? baselines.get(selectedLocale) ?? null : null;
  const selectedDraft = selectedLocale && selectedBaseline
    ? drafts.get(selectedLocale) ?? selectedBaseline
    : null;
  const selectedDirtyFields = selectedLocale
    ? dirtyFields.get(selectedLocale) ?? new Set<LocalizationField>()
    : new Set<LocalizationField>();
  const selectedIssues = selectedDraft ? issuesFor(selectedDraft) : [];
  const editorDisabled = loading || locked || !editable;

  useEffect(() => {
    if (!focusField || !selectedLocale) {
      handledFocus.current = null;
      return;
    }
    const focusKey = `${selectedLocale}:${focusField}`;
    if (handledFocus.current === focusKey) return;
    const frame = window.requestAnimationFrame(() => {
      const field = fieldRefs.current[focusField];
      if (!field) return;
      field.scrollIntoView({ block: "center" });
      field.focus({ preventScroll: true });
      handledFocus.current = focusKey;
      onFocusFieldHandled();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusField, onFocusFieldHandled, selectedLocale, selectedDraft]);

  const issueFor = (field: LocalizationField) => (
    selectedIssues.find((issue) => issue.field === field)?.message
  );

  const fieldMeta = (field: LocalizationField) => {
    if (!selectedDraft) return "";
    const editedPrefix = selectedDirtyFields.has(field) ? "Edited · " : "";
    if (field === "supportUrl") return `${editedPrefix}Required · ${selectedDraft[field].length} / ${fieldLimits[field]}`;
    if (field === "marketingUrl") return `${editedPrefix}Optional · ${selectedDraft[field].length} / ${fieldLimits[field]}`;
    return `${editedPrefix}${selectedDraft[field].length} / ${fieldLimits[field]}`;
  };

  const textareaField = (
    field: "whatsNew" | "promotionalText" | "description" | "keywords",
    rows: number,
    placeholder: string,
  ) => {
    if (!selectedDraft || !selectedLocale) return null;
    const issue = issueFor(field);
    const fieldId = `${idPrefix}-${selectedLocale}-${field}`;
    const hintId = field === "keywords" ? `${fieldId}-hint` : null;
    const issueId = issue ? `${fieldId}-issue` : null;
    const describedBy = [hintId, issueId].filter(Boolean).join(" ") || undefined;
    return (
      <div className={field === "keywords" ? "store-search-field" : undefined} key={field}>
        <label className={issue ? "store-field invalid" : "store-field"} data-field={field} htmlFor={fieldId}>
          <span><strong>{metadataFieldLabels[field]}</strong><small>{fieldMeta(field)}</small></span>
          <textarea
            ref={(node) => { fieldRefs.current[field] = node; }}
            id={fieldId}
            rows={rows}
            value={selectedDraft[field]}
            placeholder={placeholder}
            disabled={editorDisabled}
            aria-invalid={Boolean(issue)}
            aria-describedby={describedBy}
            spellCheck={field !== "keywords"}
            onChange={(event) => onFieldChange(selectedLocale, field, event.target.value)}
          />
          {issue ? <em id={issueId ?? undefined} role="alert">{issue}</em> : null}
        </label>
        {field === "keywords" ? <p id={hintId ?? undefined}>Keywords are adapted for how customers search in this locale, not translated word for word.</p> : null}
      </div>
    );
  };

  const urlField = (field: "supportUrl" | "marketingUrl") => {
    if (!selectedDraft || !selectedLocale) return null;
    const issue = issueFor(field);
    const fieldId = `${idPrefix}-${selectedLocale}-${field}`;
    const issueId = issue ? `${fieldId}-issue` : undefined;
    return (
      <label className={issue ? "store-field invalid" : "store-field"} data-field={field} htmlFor={fieldId} key={field}>
        <span><strong>{metadataFieldLabels[field]}</strong><small>{fieldMeta(field)}</small></span>
        <input
          ref={(node) => { fieldRefs.current[field] = node; }}
          id={fieldId}
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          value={selectedDraft[field]}
          placeholder="https://"
          disabled={editorDisabled}
          aria-invalid={Boolean(issue)}
          aria-describedby={issueId}
          onChange={(event) => onFieldChange(selectedLocale, field, event.target.value)}
        />
        {issue ? <em id={issueId} role="alert">{issue}</em> : null}
      </label>
    );
  };

  return (
    <section
      className="store-listing-workbench release-metadata-workbench"
      aria-label="Release metadata"
      aria-busy={loading}
    >
      <aside className="storefront-rail" aria-label="Release locales">
        <header>
          <div>
            <h2>Locales</h2>
            <p>{localizations.length} localization{localizations.length === 1 ? "" : "s"}{sourceLocale ? ` · Source ${sourceLocale}` : ""}</p>
          </div>
          <Languages size={17} aria-hidden="true" />
        </header>
        <div className="storefront-list">
          {loading && localizations.length === 0
            ? Array.from({ length: 4 }, (_, index) => <span className="storefront-skeleton" key={index} />)
            : localizations.map((localization) => {
              const draft = drafts.get(localization.locale) ?? baselines.get(localization.locale) ?? draftFrom(localization);
              const issues = issuesFor(draft);
              const issueFields = new Set(issues.map((issue) => issue.field));
              const localeDirtyFields = dirtyFields.get(localization.locale);
              const isEdited = Boolean(localeDirtyFields?.size);
              const isSource = localization.locale === sourceLocale;
              const selected = localization.locale === selectedLocale;
              const stateLabel = [
                isSource ? "Source locale" : null,
                isEdited ? `${localeDirtyFields?.size ?? 0} edited field${localeDirtyFields?.size === 1 ? "" : "s"}` : null,
                issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "Ready",
              ].filter(Boolean).join(", ");
              return (
                <button
                  type="button"
                  className={selected ? "selected" : ""}
                  disabled={loading || locked}
                  aria-pressed={selected}
                  onClick={() => onSelectLocale(localization.locale)}
                  key={localization.id}
                >
                  <span>
                    <strong>{localeNames[localization.locale]}</strong>
                    <small>{localization.locale} · {fieldOrder.length - issueFields.size}/{fieldOrder.length} fields ready</small>
                  </span>
                  <span
                    className="release-locale-states"
                    aria-label={stateLabel}
                  >
                    {isSource ? <i aria-hidden="true">Source</i> : null}
                    {isEdited ? <i aria-hidden="true">Edited</i> : null}
                    {issues.length ? <b aria-hidden="true">{issues.length}</b> : <Check size={15} aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
        </div>
      </aside>

      {selectedDraft && selectedBaseline && selectedLocale ? (
        <div className="storefront-editor">
          <header>
            <div>
              <h2>{localeNames[selectedLocale]}</h2>
              <p>{selectedLocale}{selectedLocale === sourceLocale ? " · Source locale" : ""}{!editable ? " · Read-only version" : selectedDirtyFields.size ? ` · ${selectedDirtyFields.size} edited field${selectedDirtyFields.size === 1 ? "" : "s"}` : " · No local changes"}</p>
            </div>
            <div className="release-editor-actions">
              <button
                className="button tertiary"
                type="button"
                disabled={editorDisabled || selectedLocale === sourceLocale}
                title={selectedLocale === sourceLocale ? "This is the source locale" : "Use this locale as the translation source"}
                onClick={() => onSelectSourceLocale(selectedLocale)}
              >
                <BadgeCheck size={15} />{selectedLocale === sourceLocale ? "Source" : "Use as source"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={editorDisabled || !sourceLocale || localizations.length < 2}
                title="Translate copy and adapt keywords for other locales"
                onClick={onTranslateAdapt}
              >
                <Languages size={15} />Translate &amp; adapt
              </button>
              <button
                className="button tertiary"
                type="button"
                disabled={editorDisabled || selectedDirtyFields.size === 0}
                title="Revert every local change in this locale"
                onClick={() => onRevertLocale(selectedLocale)}
              >
                <RotateCcw size={15} />Revert locale
              </button>
            </div>
          </header>
          <div className="storefront-fields">
            {textareaField("whatsNew", 7, "Describe the changes in this update.")}
            {textareaField("promotionalText", 3, "Share a timely message above the App Store description.")}
            {textareaField("description", 9, "Explain what the app does and why customers should care.")}
            {textareaField("keywords", 3, "Comma-separated search terms for this locale.")}
            <div className="store-url-grid">
              {urlField("supportUrl")}
              {urlField("marketingUrl")}
            </div>
          </div>
        </div>
      ) : (
        <div className="storefront-no-selection">
          {loading ? <LoaderCircle className="spin" size={24} /> : <FileText size={24} />}
          <h2>{loading ? "Loading metadata" : localizations.length ? "Select a locale" : "No localizations yet"}</h2>
          <p>{loading
            ? "Fetching version-localized metadata from App Store Connect."
            : localizations.length
              ? "Choose a locale to edit its release notes, storefront copy, search metadata, and links."
              : "Add a localization in App Store Connect, then sync this release to begin."}</p>
        </div>
      )}
    </section>
  );
};
