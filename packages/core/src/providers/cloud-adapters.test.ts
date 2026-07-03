import { describe, expect, it } from "vitest";
import type { SecretStore } from "../secrets/secret-store.js";
import { computeCostUsd } from "./pricing.js";
import { GoogleAdapter } from "./google.js";
import { OpenAIAdapter } from "./openai.js";

/** In-memory kasa: testler gerçek keychain'e/ortam değişkenine dokunmaz. */
function makeSecrets(entries: Record<string, string> = {}): SecretStore {
  const map = new Map(Object.entries(entries));
  return {
    backend: "env",
    get: async (provider) => map.get(provider) ?? null,
    set: async (provider, value) => void map.set(provider, value),
    delete: async (provider) => void map.delete(provider),
  };
}

describe("OpenAI ve Google adapter'ları (anahtarsız sözleşme)", () => {
  it("anahtar yokken isConfigured=false; varken true", async () => {
    const empty = makeSecrets();
    expect(await new OpenAIAdapter(empty).isConfigured()).toBe(false);
    expect(await new GoogleAdapter(empty).isConfigured()).toBe(false);

    const full = makeSecrets({ openai: "sk-test", google: "AIza-test" });
    expect(await new OpenAIAdapter(full).isConfigured()).toBe(true);
    expect(await new GoogleAdapter(full).isConfigured()).toBe(true);
  });

  it("model listeleri doğru sağlayıcı etiketiyle ve bağlam pencereleriyle gelir", async () => {
    const openaiModels = await new OpenAIAdapter(makeSecrets()).listModels();
    expect(openaiModels.map((m) => m.id)).toContain("gpt-5.1");
    expect(openaiModels.every((m) => m.provider === "openai" && !m.local)).toBe(true);

    const googleModels = await new GoogleAdapter(makeSecrets()).listModels();
    expect(googleModels.map((m) => m.id)).toContain("gemini-2.5-pro");
    expect(googleModels.find((m) => m.id === "gemini-2.5-pro")?.contextWindow).toBe(1_000_000);
  });

  it("anahtar yokken streamChat PROVIDER_NOT_CONFIGURED ile düşer (API'ye çıkmadan)", async () => {
    const request = {
      model: "gpt-5.1",
      messages: [{ role: "user" as const, content: "selam" }],
      temperature: 0,
    };
    await expect(new OpenAIAdapter(makeSecrets()).streamChat(request).next()).rejects.toThrow(
      /PROVIDER_NOT_CONFIGURED/,
    );
    await expect(
      new GoogleAdapter(makeSecrets()).streamChat({ ...request, model: "gemini-2.5-pro" }).next(),
    ).rejects.toThrow(/PROVIDER_NOT_CONFIGURED/);
  });

  it("GPT/Gemini fiyatları maliyet hesabına işlendi", () => {
    expect(computeCostUsd("gpt-5.1", 1_000_000, 1_000_000)).toBeCloseTo(11.25);
    expect(computeCostUsd("gpt-5-nano", 1_000_000, 1_000_000)).toBeCloseTo(0.45);
    expect(computeCostUsd("gemini-2.5-flash", 1_000_000, 1_000_000)).toBeCloseTo(2.8);
  });
});
