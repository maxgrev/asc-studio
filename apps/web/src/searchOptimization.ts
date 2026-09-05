import type { SearchMetadataValues } from "@asc-studio/contracts";

export const searchFields = ["name", "subtitle", "keywords"] as const;
export type SearchField = typeof searchFields[number];
export const searchFieldLabels: Record<SearchField, string> = { name: "Name", subtitle: "Subtitle", keywords: "Keywords" };
export const searchFieldLimits: Record<SearchField, number> = { name: 30, subtitle: 30, keywords: 100 };

const normalize = (value: string, locale: string) => value.normalize("NFKC").toLocaleLowerCase(locale).trim();

export const searchWords = (value: string, locale: string): string[] => {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return [...segmenter.segment(normalize(value, locale))].filter((part) => part.isWordLike).map((part) => part.segment);
};

export const analyzeSearchMetadata = (values: SearchMetadataValues, locale: string) => {
  const words = new Map<string, Set<SearchField>>();
  for (const field of searchFields) {
    for (const word of searchWords(values[field], locale)) {
      const locations = words.get(word) ?? new Set<SearchField>();
      locations.add(field);
      words.set(word, locations);
    }
  }
  const entries = [...words].map(([word, fields]) => ({ word, fields: [...fields] }));
  const duplicates = entries.filter((item) => item.fields.length > 1);
  const issues = searchFields.flatMap((field) => values[field].length > searchFieldLimits[field]
    ? [`${searchFieldLabels[field]} is ${values[field].length - searchFieldLimits[field]} characters over its limit.`] : []);
  if (values.name.trim().length < 2) issues.push("Use at least two characters for the name.");
  return { entries, duplicates, issues };
};

// Keep phrases intact: matching their individual words is not evidence that
// removing a phrase preserves Apple's search behavior in every language.
export const cleanSearchKeywords = (values: SearchMetadataValues, locale: string) => {
  const visible = new Set(searchWords(`${values.name} ${values.subtitle}`, locale));
  const seen = new Set<string>();
  return values.keywords.split(",").map((entry) => entry.trim()).filter((entry) => {
    const key = normalize(entry, locale);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    const words = searchWords(entry, locale);
    return !(words.length === 1 && visible.has(words[0]!));
  }).join(",");
};

export const keywordCoverage = (keyword: string, values: SearchMetadataValues, locale: string) => {
  const words = searchWords(keyword, locale);
  const metadata = analyzeSearchMetadata(values, locale);
  const all = new Set(metadata.entries.map((entry) => entry.word));
  const missing = [...new Set(words.filter((word) => !all.has(word)))];
  const fields = searchFields.filter((field) => words.length > 0 && words.every((word) => searchWords(values[field], locale).includes(word)));
  return { covered: words.length > 0 && missing.length === 0, missing, fields };
};

export const appendSearchKeyword = (keyword: string, values: SearchMetadataValues, locale: string) => {
  const existing = new Set(values.keywords.split(",").map((entry) => normalize(entry, locale)));
  if (existing.has(normalize(keyword, locale))) return values.keywords;
  return [values.keywords.trim().replace(/,+$/, ""), keyword.trim()].filter(Boolean).join(",");
};

export const researchDateRange = (now = new Date()) => {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - end.getUTCDay() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};
