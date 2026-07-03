import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import type { ModelInfo } from "@symphony/shared";
import type { SecretStore } from "../secrets/secret-store.js";
import { computeCostUsd } from "./pricing.js";
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

  constructor(private readonly secrets: SecretStore) {}

  listModels(): ModelInfo[] {
    return MODELS;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.secrets.get(this.name)) !== null;
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    const apiKey = await this.secrets.get(this.name);
    if (!apiKey) {
      throw new Error(
        "PROVIDER_NOT_CONFIGURED: Anthropic anahtarı kayıtlı değil. " +
          "Kaydetmek için: pnpm --filter @symphony/core key:set anthropic",
      );
    }
    const anthropic = createAnthropic({ apiKey });

    // Claude 4.7+ ailesi sampling parametrelerini (temperature/top_p/top_k)
    // KABUL ETMEZ — göndermek 400 döndürür. ADR-008'in determinizm hedefi bu
    // ailede istem düzeyinde sağlanır; request.temperature burada bilinçli olarak
    // API'ye iletilmez.
    const result = streamText({
      model: anthropic(request.model),
      messages: request.messages,
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
