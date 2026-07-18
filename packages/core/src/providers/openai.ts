import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type LanguageModel } from "ai";
import type { ModelInfo } from "@lrgendie/shared";
import type { SecretStore } from "../secrets/secret-store.js";
import { computeCostUsd } from "./pricing.js";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "./types.js";

const MODELS: ModelInfo[] = [
  {
    provider: "openai",
    id: "gpt-5.1",
    displayName: "GPT-5.1",
    local: false,
    contextWindow: 400_000,
  },
  {
    provider: "openai",
    id: "gpt-5-mini",
    displayName: "GPT-5 mini",
    local: false,
    contextWindow: 400_000,
  },
  {
    provider: "openai",
    id: "gpt-5-nano",
    displayName: "GPT-5 nano",
    local: false,
    contextWindow: 400_000,
  },
];

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  // GPT-5 ailesi (akıl yürüten modeller) sampling parametrelerini KABUL ETMEZ —
  // temperature göndermek 400 döndürür. ADR-008 determinizmi istem düzeyinde sağlanır.
  readonly forwardsTemperature = false;

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
        "PROVIDER_NOT_CONFIGURED: OpenAI anahtarı kayıtlı değil. " +
          "Kaydetmek için: pnpm --filter @lrgendie/core key:set openai",
      );
    }
    return createOpenAI({ apiKey })(modelId);
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    const result = streamText({
      model: await this.languageModel(request.model),
      messages: request.messages,
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
