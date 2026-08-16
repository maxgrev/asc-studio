import {
  GenerateReleaseCopyTranslationsInputSchema,
  type GenerateReleaseCopyTranslationsInput,
} from "@asc-studio/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DemoReleaseCopyTranslator,
  OpenAiReleaseCopyTranslator,
} from "./translation.js";

const input: GenerateReleaseCopyTranslationsInput = GenerateReleaseCopyTranslationsInputSchema.parse({
  sourceLocale: "en-US",
  targetLocales: ["de-DE", "fr-FR"],
  fields: ["whatsNew"],
  source: {
    whatsNew: "A faster editor and more reliable sync.",
    promotionalText: "Capture ideas fast.",
  },
});

describe("release-copy translators", () => {
  it("keeps demo output to the selected release-copy fields", async () => {
    const translator = new DemoReleaseCopyTranslator();

    const translations = await translator.generate(input);

    expect(translations).toHaveLength(2);
    expect(translations[0]).toMatchObject({ locale: "de-DE", whatsNew: expect.stringContaining("Demo-Übersetzung") });
    expect(translations[0]).not.toHaveProperty("promotionalText");
    expect(translations[0]).not.toHaveProperty("keywords");
  });

  it("sends a strict keyword-free schema to OpenAI and validates its output", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      output_text: JSON.stringify({
        translations: [
          { locale: "de-DE", whatsNew: "Ein schnellerer Editor und eine zuverlässigere Synchronisierung." },
          { locale: "fr-FR", whatsNew: "Un éditeur plus rapide et une synchronisation plus fiable." },
        ],
      }),
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const translator = new OpenAiReleaseCopyTranslator("test-key", "test-model", fetchMock as unknown as typeof fetch);

    const translations = await translator.generate(input);

    expect(translations.map((translation) => translation.locale)).toEqual(["de-DE", "fr-FR"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      store: boolean;
      input: string;
      text: { format: { schema: unknown } };
    };
    expect(body.store).toBe(false);
    expect(body.input).not.toContain("keywords");
    expect(JSON.stringify(body.text.format.schema)).not.toContain("keywords");
  });

  it("rejects unrequested fields in provider output", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      output_text: JSON.stringify({
        translations: [
          { locale: "de-DE", whatsNew: "Neu", promotionalText: "Nicht angefordert" },
          { locale: "fr-FR", whatsNew: "Nouveau" },
        ],
      }),
    }), { status: 200 }));
    const translator = new OpenAiReleaseCopyTranslator("test-key", "test-model", fetchMock as unknown as typeof fetch);

    await expect(translator.generate(input)).rejects.toMatchObject({
      code: "translation_invalid_response",
    });
  });

  it("reports a missing live API key before making a request", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const translator = new OpenAiReleaseCopyTranslator(undefined, "test-model", fetchImplementation);

    expect(translator.getStatus()).toMatchObject({ configured: false, provider: "openai" });
    await expect(translator.generate(input)).rejects.toMatchObject({
      code: "translation_not_configured",
      status: 409,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
