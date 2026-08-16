import type {
  AppStoreLocale,
  LocalizationSnapshot,
  VersionLocalization,
  VersionLocalizationDraft,
} from "@asc-studio/contracts";

export const localeNames: Record<AppStoreLocale, string> = {
  "ar-SA": "Arabic",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  "de-DE": "German",
  el: "Greek",
  "en-AU": "English (Australia)",
  "en-CA": "English (Canada)",
  "en-GB": "English (U.K.)",
  "en-US": "English (U.S.)",
  "es-ES": "Spanish (Spain)",
  "es-MX": "Spanish (Mexico)",
  fi: "Finnish",
  "fr-CA": "French (Canada)",
  "fr-FR": "French",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ms: "Malay",
  "nl-NL": "Dutch",
  no: "Norwegian",
  pl: "Polish",
  "pt-BR": "Portuguese (Brazil)",
  "pt-PT": "Portuguese (Portugal)",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  "zh-Hans": "Chinese (Simplified)",
  "zh-Hant": "Chinese (Traditional)",
};

export const metadataFields = ["whatsNew", "promotionalText", "keywords"] as const;
export type MetadataField = (typeof metadataFields)[number];

export const metadataFieldLabels: Record<MetadataField, string> = {
  whatsNew: "What’s New",
  promotionalText: "Promotional text",
  keywords: "Keywords",
};

export const draftFrom = (localization: VersionLocalization): VersionLocalizationDraft => ({
  locale: localization.locale,
  whatsNew: localization.whatsNew,
  promotionalText: localization.promotionalText,
  keywords: localization.keywords,
});

export const snapshotFrom = (localization: VersionLocalization): LocalizationSnapshot => ({
  id: localization.id,
  ...draftFrom(localization),
});

export const draftMatches = (left: VersionLocalizationDraft, right: VersionLocalizationDraft) =>
  metadataFields.every((field) => left[field] === right[field]);

export interface MetadataIssue {
  field: MetadataField;
  message: string;
}

export const metadataIssues = (draft: VersionLocalizationDraft): MetadataIssue[] => {
  const issues: MetadataIssue[] = [];
  if (!draft.whatsNew.trim()) issues.push({ field: "whatsNew", message: "Add release notes for this update." });
  if (draft.whatsNew.length > 4_000) issues.push({ field: "whatsNew", message: `Shorten release notes by ${draft.whatsNew.length - 4_000} characters.` });
  if (draft.promotionalText.length > 170) issues.push({ field: "promotionalText", message: `Shorten promotional text by ${draft.promotionalText.length - 170} characters.` });
  if (draft.keywords.length > 100) issues.push({ field: "keywords", message: `Shorten keywords by ${draft.keywords.length - 100} characters.` });
  return issues;
};

export const versionStateLabel = (state: string) => {
  const label = state.toLowerCase().replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

export const platformLabel = (platform: string) => ({
  IOS: "iOS",
  MAC_OS: "macOS",
  TV_OS: "tvOS",
  VISION_OS: "visionOS",
})[platform] ?? platform;

export const nextPatchVersion = (versionString: string | undefined) => {
  if (!versionString) return "1.0.0";
  const parts = versionString.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.slice(0, 3).join(".");
};
