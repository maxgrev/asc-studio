import type { VersionLocalizationDraft } from "@asc-studio/contracts";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { draftMatches, localeNames, metadataIssues, type MetadataField } from "../releaseMetadata.js";

interface LocalizationEditorProps {
  baseline: VersionLocalizationDraft;
  draft: VersionLocalizationDraft;
  hasSavedDraft: boolean;
  onSave: (draft: VersionLocalizationDraft) => void;
  onRevert: () => void;
  onClose: () => void;
}

const limits: Record<MetadataField, number> = {
  whatsNew: 4_000,
};

export const LocalizationEditor = ({ baseline, draft, hasSavedDraft, onSave, onRevert, onClose }: LocalizationEditorProps) => {
  const [form, setForm] = useState(draft);

  useEffect(() => {
    setForm(draft);
  }, [draft]);

  const issues = useMemo(() => {
    return metadataIssues(form);
  }, [form]);
  const issueFor = (field: MetadataField) => issues.find((issue) => issue.field === field)?.message;
  const dirty = !draftMatches(form, draft);

  const update = (field: MetadataField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const field = (
    key: MetadataField,
    label: string,
    rows: number,
    placeholder: string,
  ) => {
    const issue = issueFor(key);
    return (
      <label className={issue ? "metadata-field invalid" : "metadata-field"}>
        <span className="metadata-label"><span>{label}</span><small>{form[key].length} / {limits[key]}</small></span>
        <textarea rows={rows} value={form[key]} placeholder={placeholder} onChange={(event) => update(key, event.target.value)} />
        {issue ? <span className="field-error" role="alert">{issue}</span> : null}
      </label>
    );
  };

  return (
    <aside className="localization-editor" aria-label={`${localeNames[form.locale]} metadata editor`}>
      <header className="localization-editor-header">
        <div><h2>{localeNames[form.locale]}</h2><p>{form.locale}</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close localization editor"><X size={20} /></button>
      </header>
      <div className="metadata-fields">
        {field("whatsNew", "What’s New", 7, "Describe the changes in this update.")}
        <div className="release-storefront-boundary">
          <strong>Storefront copy lives in Store Listing</strong>
          <p>Description, promotional text, keywords, URLs, and screenshots have one canonical editor.</p>
        </div>
      </div>
      <footer className="editor-footer">
        <button className="button secondary" type="button" disabled={!hasSavedDraft && !dirty} onClick={() => {
          setForm(baseline);
          onRevert();
        }}>Revert</button>
        <button className="button primary" type="button" disabled={!dirty || issues.length > 0} onClick={() => onSave(form)}>Save draft</button>
      </footer>
    </aside>
  );
};
