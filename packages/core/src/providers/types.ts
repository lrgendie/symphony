import type { ChatMessage, ModelInfo } from "@symphony/shared";

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
}

export interface ChatUsageResult {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * Her model sağlayıcısı bu arayüzün arkasındadır (ADR-003):
 * Anthropic, OpenAI, Google, Ollama — daemon için hepsi aynıdır.
 */
export interface ProviderAdapter {
  readonly name: string;
  listModels(): ModelInfo[];
  isConfigured(): Promise<boolean>;
  /** Metin parçaları akıtır; bittiğinde kullanım/maliyet döndürür. */
  streamChat(request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void>;
}
