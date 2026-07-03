import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import type { ModelInfo } from "@symphony/shared";
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

  constructor(private readonly secrets: SecretStore) {}

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(MODELS);
  }

  async isConfigured(): Promise<boolean> {
    return (await this.secrets.get(this.name)) !== null;
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    const apiKey = await this.secrets.get(this.name);
    if (!apiKey) {
      throw new Error(
        "PROVIDER_NOT_CONFIGURED: Google anahtarı kayıtlı değil. " +
          "Kaydetmek için: pnpm --filter @symphony/core key:set google",
      );
    }
    const google = createGoogleGenerativeAI({ apiKey });

    // Gemini sampling destekler → ADR-008 gereği temperature (varsayılan 0) İLETİLİR.
    const result = streamText({
      model: google(request.model),
      messages: request.messages,
      temperature: request.temperature,
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
