import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, type LanguageModel } from "ai";
import type { ModelInfo } from "@lrgendie/shared";
import type { SecretStore } from "../secrets/secret-store.js";
import { applyPromptCacheBreakpoints } from "../agent/prompt-cache.js";
import { computeCostUsd } from "./pricing.js";
import { extractCacheTokens, parseRateLimits } from "./telemetry.js";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "./types.js";

const MODELS: ModelInfo[] = [
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    local: false,
    contextWindow: 1_000_000,
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    local: false,
    contextWindow: 1_000_000,
  },
  {
    provider: "anthropic",
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    local: false,
    contextWindow: 200_000,
  },
];

export class AnthropicAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  // Claude 4.7+ ailesi sampling parametrelerini (temperature/top_p/top_k)
  // KABUL ETMEZ — göndermek 400 döndürür. ADR-008'in determinizm hedefi bu
  // ailede istem düzeyinde sağlanır.
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
        "PROVIDER_NOT_CONFIGURED: Anthropic anahtarı kayıtlı değil. " +
          "Kaydetmek için: pnpm --filter @lrgendie/core key:set anthropic",
      );
    }
    return createAnthropic({ apiKey })(modelId);
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    // D2.5: prompt cache — sohbet de her turda TAM geçmişi yeniden gönderir (PROTOKOL §3),
    // yani agent döngüsüyle AYNI karesel maliyet sorununu yaşar. Aynı SAF yardımcı kullanılır.
    // Not: istemcinin gönderdiği diziyi yerinde işaretler; `messages` tur başına yeniden kurulur.
    const messages = [...request.messages];
    applyPromptCacheBreakpoints(messages);
    const result = streamText({
      model: await this.languageModel(request.model),
      messages,
      // ADR-013: profil `instructions` üzerinden — v7 `messages` içinde system KABUL ETMEZ.
      ...(request.instructions !== undefined ? { instructions: request.instructions } : {}),
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.abortSignal !== undefined ? { abortSignal: request.abortSignal } : {}),
    });

    for await (const delta of result.textStream) {
      yield delta;
    }

    const [usage, response, providerMetadata] = await Promise.all([
      result.usage,
      result.response,
      result.providerMetadata,
    ]);
    const inputTokens = usage.inputTokens ?? 0;
    const outputTokens = usage.outputTokens ?? 0;
    const cache = extractCacheTokens(providerMetadata);
    const limits = parseRateLimits(response.headers);
    return {
      inputTokens,
      outputTokens,
      // D2.5: cache'lenen token'lar indirimli fiyatlanır (okuma %10, yazma %125) — `inputTokens`
      // onları TAM sayıyla içerir, ham çarpım defteri şişirirdi.
      costUsd: computeCostUsd(request.model, inputTokens, outputTokens, cache),
      cacheReadTokens: cache.read,
      cacheCreationTokens: cache.creation,
      ...(limits !== null ? { limits } : {}),
    };
  }
}
