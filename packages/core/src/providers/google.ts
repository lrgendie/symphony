import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, type LanguageModel } from "ai";
import type { ModelInfo } from "@lrgendie/shared";
import type { SecretStore } from "../secrets/secret-store.js";
import { computeCostUsd } from "./pricing.js";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "./types.js";

const MODELS: ModelInfo[] = [
  {
    provider: "google",
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    local: false,
    contextWindow: 1_000_000,
  },
  {
    provider: "google",
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    local: false,
    contextWindow: 1_000_000,
  },
];

export class GoogleAdapter implements ProviderAdapter {
  readonly name = "google";
  // Gemini sampling destekler → ADR-008 gereği temperature (varsayılan 0) İLETİLİR.
  readonly forwardsTemperature = true;

  constructor(private readonly secrets: SecretStore) {}

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(MODELS);
  }

  async isConfigured(): Promise<boolean> {
    return (await this.secrets.get(this.name)) !== null;
  }

  async languageModel(modelId: string): Promise<LanguageModel> {
    const apiKey = await this.secrets.get(this.name);
    if (!apiKey) {
      throw new Error(
        "PROVIDER_NOT_CONFIGURED: Google anahtarı kayıtlı değil. " +
          "Kaydetmek için: pnpm --filter @lrgendie/core key:set google",
      );
    }
    return createGoogleGenerativeAI({ apiKey })(modelId);
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    const result = streamText({
      model: await this.languageModel(request.model),
      messages: request.messages,
      temperature: request.temperature,
      // ADR-013: profil `instructions` üzerinden — v7 `messages` içinde system KABUL ETMEZ.
      ...(request.instructions !== undefined ? { instructions: request.instructions } : {}),
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.abortSignal !== undefined ? { abortSignal: request.abortSignal } : {}),
    });

    for await (const delta of result.textStream) {
      yield delta;
    }

    const usage = await result.usage;
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      costUsd: computeCostUsd(request.model, inputTokens, outputTokens),
    };
  }
}
