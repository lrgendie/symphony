import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText, type LanguageModel } from "ai";
import type { ModelInfo } from "@symphony/shared";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "./types.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

/** Sağlık/liste sorgularında beklenecek üst sınır — yerel sunucu için cömert. */
const PROBE_TIMEOUT_MS = 2000;

/** Ollama `GET /api/tags` cevabının kullandığımız kısmı. */
interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

/**
 * Yerel Ollama adapter'ı (ADR-005).
 *
 * Bağlantı, Ollama'nın OpenAI-uyumlu `/v1` ucu üzerinden resmî
 * `@ai-sdk/openai-compatible` paketiyle kurulur (ADR-003: her çağrı Vercel AI
 * SDK'dan geçer). Topluluk paketi `ollama-ai-provider(-v2)` bilinçli olarak
 * KULLANILMADI: 2026-07 itibarıyla AI SDK v7 + zod v3 ile uyumsuz
 * (bkz. docs/GEREKSINIMLER.md envanter notu).
 *
 * "Yapılandırılmış olmak" = sunucunun ayakta olması; anahtar yoktur.
 * Model listesi dinamiktir: kullanıcı ne indirdiyse (`ollama pull ...`) o.
 */
export class OllamaAdapter implements ProviderAdapter {
  readonly name = "ollama";
  // Ollama sampling parametrelerini destekler → ADR-008 gereği temperature İLETİLİR.
  readonly forwardsTemperature = true;

  constructor(private readonly baseUrl: string = DEFAULT_OLLAMA_BASE_URL) {}

  languageModel(modelId: string): Promise<LanguageModel> {
    return Promise.resolve(
      createOpenAICompatible({
        name: this.name,
        baseURL: `${this.baseUrl}/v1`,
        includeUsage: true,
      }).chatModel(modelId),
    );
  }

  async listModels(): Promise<ModelInfo[]> {
    const tags = await this.fetchTags();
    if (tags === null) return [];
    return (tags.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0)
      .map((name) => ({
        provider: this.name,
        id: name,
        displayName: name,
        local: true,
      }));
  }

  async isConfigured(): Promise<boolean> {
    return (await this.fetchTags()) !== null;
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    const result = streamText({
      model: await this.languageModel(request.model),
      messages: request.messages,
      temperature: request.temperature,
      ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
      ...(request.abortSignal !== undefined ? { abortSignal: request.abortSignal } : {}),
    });

    for await (const delta of result.textStream) {
      yield delta;
    }

    const usage = await result.usage;
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: 0, // yerel model — ücretsiz (pricing.ts ile tutarlı)
    };
  }

  /** `/api/tags`'i kısa zaman aşımıyla dener; sunucu yoksa null (hata fırlatmaz). */
  private async fetchTags(): Promise<OllamaTagsResponse | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      return (await response.json()) as OllamaTagsResponse;
    } catch {
      return null;
    }
  }
}
