import type { LanguageModel } from "ai";
import type { ChatMessage, ModelInfo } from "@lrgendie/shared";
import type { RateLimitSnapshot } from "./telemetry.js";

export interface ChatStreamRequest {
  model: string;
  messages: ChatMessage[];
  /**
   * ADR-008: varsayılan 0 (determinizm). Adapter, sağlayıcı bu parametreyi
   * desteklemiyorsa (ör. Claude 4.7+ ailesi sampling parametrelerini 400 ile
   * reddeder) YOK SAYAR — istek düşürmek yerine parametre atlanır.
   */
  temperature: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  /**
   * ADR-013: kullanıcı profili buradan geçer — AI SDK v7 `messages` içinde `system`
   * rolünü KABUL ETMEZ (`streamText`'in kendi `instructions` seçeneği kullanılmalı,
   * engine.ts'teki agent yoluyla aynı desen). `payload.messages` bu yüzden DEĞİŞMEZ.
   */
  instructions?: string;
}

export interface ChatUsageResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Prompt-cache token'ları (yalnız destekleyen sağlayıcı, ör. Anthropic). */
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Bu cevabın header'larından okunan rate-limit görüntüsü (yoksa undefined). */
  limits?: RateLimitSnapshot;
}

/**
 * Her model sağlayıcısı bu arayüzün arkasındadır (ADR-003):
 * Anthropic, OpenAI, Google, Ollama — daemon için hepsi aynıdır.
 */
export interface ProviderAdapter {
  readonly name: string;
  /**
   * temperature API'ye iletilir mi? Claude 4.7+/GPT-5 aileleri sampling
   * parametrelerini 400 ile reddeder → false; Gemini/Ollama → true.
   * Agent motoru (tool-calling) da bu bayrağa uyar — chat ile aynı kural.
   */
  readonly forwardsTemperature: boolean;
  /**
   * Async'tir çünkü liste her sağlayıcıda statik değildir: Ollama'da
   * "kullanıcı ne indirdiyse o" — sunucudan sorgulanır. Sunucuya
   * ulaşılamıyorsa hata değil BOŞ liste döner (sağlayıcı yok sayılır).
   */
  listModels(): Promise<ModelInfo[]>;
  isConfigured(): Promise<boolean>;
  /**
   * AI SDK modeli — agent motorunun tool-calling döngüsü (generateText) için.
   * Anahtar yoksa PROVIDER_NOT_CONFIGURED mesajıyla reddeder.
   */
  languageModel(modelId: string): Promise<LanguageModel>;
  /** Metin parçaları akıtır; bittiğinde kullanım/maliyet döndürür. */
  streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void>;
}
