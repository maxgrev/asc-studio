import type { AppStoreLocale, VersionLocalization, VersionLocalizationDraft } from "@asc-studio/contracts";
import { draftFrom, localeNames, metadataIssues } from "../releaseMetadata.js";

interface LocalizationTableProps {
  localizations: VersionLocalization[];
  drafts: ReadonlyMap<AppStoreLocale, VersionLocalizationDraft>;
  selectedLocale: AppStoreLocale | null;
  loading: boolean;
  onSelect: (locale: AppStoreLocale) => void;
}

const fieldState = (
  field: "whatsNew" | "promotionalText",
  baseline: VersionLocalizationDraft,
  draft: VersionLocalizationDraft,
) => {
  if (!draft[field].trim()) return "Missing";
  return baseline[field] === draft[field] ? "Current" : "Edited";
};

export const LocalizationTable = ({ localizations, drafts, selectedLocale, loading, onSelect }: LocalizationTableProps) => (
  <div className="localization-table-wrap">
    <table className="localization-table">
      <thead>
        <tr>
          <th>Locale</th>
          <th>What’s New</th>
          <th>Promo text</th>
          <th>Keywords</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>
        {loading ? Array.from({ length: 5 }, (_, index) => (
          <tr className="localization-skeleton" key={index}>
            {Array.from({ length: 5 }, (__, cell) => <td key={cell}><span /></td>)}
          </tr>
        )) : localizations.length === 0 ? (
          <tr className="empty-row"><td colSpan={5}>No localizations exist for this version.</td></tr>
        ) : localizations.map((localization) => {
          const baseline = draftFrom(localization);
          const draft = drafts.get(localization.locale) ?? baseline;
          const issues = metadataIssues(draft);
          const keywordsEdited = baseline.keywords !== draft.keywords;
          return (
            <tr
              className={selectedLocale === localization.locale ? "selected" : undefined}
              tabIndex={0}
              onClick={() => onSelect(localization.locale)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(localization.locale);
              }}
              key={localization.id}
            >
              <td><strong>{localeNames[localization.locale]}</strong><small>{localization.locale}</small></td>
              <td className={fieldState("whatsNew", baseline, draft) === "Missing" ? "missing-value" : undefined}>{fieldState("whatsNew", baseline, draft)}</td>
              <td>{fieldState("promotionalText", baseline, draft)}</td>
              <td className={draft.keywords.length > 100 ? "limit-error" : keywordsEdited ? "edited-value" : undefined}>{draft.keywords.length}/100</td>
              <td>
                <span className={issues.length ? "issue-state has-issues" : "issue-state ready"}>
                  <span />{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : "Ready"}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
