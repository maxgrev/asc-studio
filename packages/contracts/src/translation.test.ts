import { describe, expect, it } from "vitest";
import {
  GenerateReleaseCopyTranslationsInputSchema,
  GeneratedReleaseCopyTranslationSchema,
} from "./index.js";

const base = {
  sourceLocale: "en-US" as const,
  targetLocales: ["de-DE" as const],
};

describe("release-copy translation contracts", () => {
  it("accepts all four translation and adaptation fields", () => {
    expect(GenerateReleaseCopyTranslationsInputSchema.parse({
      ...base,
      fields: ["description", "whatsNew", "promotionalText", "keywords"],
      source: {
        description: "Capture and organize every idea.",
        whatsNew: "A faster editor.",
        promotionalText: "Capture ideas fast.",
        keywords: "notes,tasks,writing,ideas",
      },
    })).toMatchObject({
      fields: ["description", "whatsNew", "promotionalText", "keywords"],
    });
  });

  it("requires source properties to match the selected fields exactly", () => {
    expect(GenerateReleaseCopyTranslationsInputSchema.safeParse({
      ...base,
      fields: ["whatsNew"],
      source: { whatsNew: "A faster editor." },
    }).success).toBe(true);

    expect(GenerateReleaseCopyTranslationsInputSchema.safeParse({
      ...base,
      fields: ["whatsNew", "description"],
      source: { whatsNew: "A faster editor." },
    }).success).toBe(false);

    expect(GenerateReleaseCopyTranslationsInputSchema.safeParse({
      ...base,
      fields: ["whatsNew"],
      source: {
        whatsNew: "A faster editor.",
        description: "This field was not selected.",
      },
    }).success).toBe(false);

    expect(GenerateReleaseCopyTranslationsInputSchema.safeParse({
      ...base,
      fields: ["whatsNew"],
      source: { whatsNew: "A faster editor.", unexpected: "value" },
    }).success).toBe(false);
  });

  it.each([
    "notes,,writing",
    "notes, writing",
    "notes,writing ",
    "notes\nwriting",
  ])("rejects malformed comma-separated keywords: %s", (keywords) => {
    expect(GenerateReleaseCopyTranslationsInputSchema.safeParse({
      ...base,
      fields: ["keywords"],
      source: { keywords },
    }).success).toBe(false);

    expect(GeneratedReleaseCopyTranslationSchema.safeParse({
      locale: "de-DE",
      keywords,
    }).success).toBe(false);
  });

  it("accepts a nonempty comma-separated keyword adaptation within 100 characters", () => {
    expect(GeneratedReleaseCopyTranslationSchema.parse({
      locale: "de-DE",
      keywords: "notizen,aufgaben,schreiben,ideen",
    })).toEqual({
      locale: "de-DE",
      keywords: "notizen,aufgaben,schreiben,ideen",
    });
  });
});
