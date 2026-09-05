import { describe, expect, it } from "vitest";
import { analyzeSearchMetadata, appendSearchKeyword, cleanSearchKeywords, keywordCoverage, researchDateRange } from "./searchOptimization.js";

describe("search metadata optimization", () => {
  const values = { name: "Auri AI Keyboard & Assistant", subtitle: "Voice Dictation, Notes & Chat", keywords: "keyboard,assistant,voice,dictation,notes,chat,transcribe,audio" };

  it("finds overlap across name, subtitle, and hidden keywords", () => {
    const result = analyzeSearchMetadata(values, "en-US");
    expect(result.duplicates.map((item) => item.word).sort()).toEqual(["assistant", "chat", "dictation", "keyboard", "notes", "voice"]);
    expect(result.duplicates.find((item) => item.word === "keyboard")?.fields).toEqual(["name", "keywords"]);
    expect(result.issues).toEqual([]);
  });
  it("cleans redundant single words and duplicate entries while preserving phrases", () => {
    expect(cleanSearchKeywords(values, "en-US")).toBe("transcribe,audio");
    expect(cleanSearchKeywords({ ...values, keywords: " Keyboard ,voice notes,AUDIO,audio,,recording " }, "en-US")).toBe("voice notes,AUDIO,recording");
  });
  it("matches whole words without confusing related spellings or inflections", () => {
    const result = keywordCoverage("notebook", values, "en-US");
    expect(result.covered).toBe(false);
    expect(result.missing).toEqual(["notebook"]);
    expect(keywordCoverage("note", values, "en-US").covered).toBe(false);
  });
  it("shows phrase words across fields without claiming exact phrase coverage", () => {
    expect(keywordCoverage("voice keyboard", { ...values, keywords: "audio,transcribe" }, "en-US")).toMatchObject({ covered: true, fields: [], missing: [] });
    expect(keywordCoverage("voice recorder", values, "en-US").missing).toEqual(["recorder"]);
  });
  it("normalizes unicode and case without stripping meaningful accents", () => {
    const localized = { name: "Café ＡＩ", subtitle: "Écrire", keywords: "cafe,café,ai" };
    expect(analyzeSearchMetadata(localized, "fr-FR").duplicates.map((item) => item.word)).toEqual(["café", "ai"]);
    expect(cleanSearchKeywords(localized, "fr-FR")).toBe("cafe");
  });
  it("flags field limits and empty names without silently truncating copy", () => {
    expect(analyzeSearchMetadata({ name: " ", subtitle: "x".repeat(31), keywords: "x".repeat(101) }, "en-US").issues).toHaveLength(3);
  });
  it("adds keyword phrases only once and fixes a trailing comma", () => {
    expect(appendSearchKeyword("Audio", { ...values, keywords: "audio" }, "en-US")).toBe("audio");
    expect(appendSearchKeyword("voice recorder", { ...values, keywords: "audio," }, "en-US")).toBe("audio,voice recorder");
  });
  it("uses four complete Sunday-to-Saturday weeks", () => {
    expect(researchDateRange(new Date("2026-09-05T12:00:00Z"))).toEqual({ start: "2026-08-02", end: "2026-08-29" });
    expect(researchDateRange(new Date("2026-09-06T00:00:00Z"))).toEqual({ start: "2026-08-09", end: "2026-09-05" });
  });
});
