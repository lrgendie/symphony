import { z } from "zod";
import {
  AgentSummarySchema,
  ErrorPayloadSchema,
  ModelInfoSchema,
  ProviderHealthSchema,
  RiskClassSchema,
  SnapshotSchema,
  UsageSchema,
} from "./common.js";
import { AgentRunStateSchema } from "./agent-state.js";

/**
 * Daemon → İstemci olayları ve istek cevapları (PROTOKOL.md §4).
 * Olaylar `replyTo` taşımaz ve TÜM bağlı istemcilere yayınlanır —
 * terminal ⇄ masaüstü eş zamanlılığının kaynağı budur.
 */

// ---- İstek cevapları (`<type>.ok`) ----

export const HelloOkPayloadSchema = z
  .object({
    daemonVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
    snapshot: SnapshotSchema,
  })
  .strip();

export const StateSyncOkPayloadSchema = z.object({ snapshot: SnapshotSchema }).strip();

export const ChatStartOkPayloadSchema = z.object({ sessionId: z.string().uuid() }).strip();
export const AckPayloadSchema = z.object({}).strip();
export const AgentStartOkPayloadSchema = z.object({ runId: z.string().uuid() }).strip();

export const ModelsListOkPayloadSchema = z.object({ models: z.array(ModelInfoSchema) }).strip();

export const AgentsListOkPayloadSchema = z.object({ agents: z.array(AgentSummarySchema) }).strip();

export const ProvidersStatusOkPayloadSchema = z
  .object({ providers: z.array(ProviderHealthSchema) })
  .strip();

/** Router önerisi her zaman gerekçelidir — "şeffaf gerekçeli seçenek sunma" (ROADMAP Faz 6). */
export const RouterSuggestOkPayloadSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            provider: z.string().min(1),
            model: z.string().min(1),
            reason: z.string().min(1),
            local: z.boolean(),
            estimatedCostUsd: z.number().nonnegative().optional(),
          })
          .strip(),
      )
      .min(1),
  })
  .strip();

export const McpAddServerOkPayloadSchema = z
  .object({ name: z.string().min(1), tools: z.array(z.string().min(1)) })
  .strip();

export const UsageQueryOkPayloadSchema = z
  .object({
    rows: z.array(
      z
        .object({
          key: z.string(),
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          costUsd: z.number().nonnegative(),
        })
        .strip(),
    ),
    totals: UsageSchema,
  })
  .strip();

// ---- Yayın olayları ----

export const ChatDeltaPayloadSchema = z
  .object({ sessionId: z.string().uuid(), text: z.string() })
  .strip();

export const ChatCompletedPayloadSchema = z
  .object({ sessionId: z.string().uuid(), usage: UsageSchema })
  .strip();

export const AgentRunStartedPayloadSchema = z
  .object({
    runId: z.string().uuid(),
    agentId: z.string().min(1),
    task: z.string(),
    model: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strip();

export const AgentRunStatePayloadSchema = z
  .object({ runId: z.string().uuid(), state: AgentRunStateSchema })
  .strip();

export const AgentStepThinkingPayloadSchema = z
  .object({ runId: z.string().uuid(), summary: z.string().optional() })
  .strip();

export const AgentToolRequestedPayloadSchema = z
  .object({
    runId: z.string().uuid(),
    requestId: z.string().uuid(),
    tool: z.string().min(1),
    args: z.record(z.unknown()),
    riskClass: RiskClassSchema,
    // Dosya değişikliklerinde diff ZORUNLUDUR — doğrulama SPEC-AGENT.md §6'ya göre core'da yapılır.
    diff: z.string().optional(),
  })
  .strip();

export const AgentToolStartedPayloadSchema = z
  .object({ runId: z.string().uuid(), tool: z.string().min(1), argsSummary: z.string() })
  .strip();

export const AgentToolCompletedPayloadSchema = z
  .object({
    runId: z.string().uuid(),
    tool: z.string().min(1),
    ok: z.boolean(),
    resultSummary: z.string(),
    durationMs: z.number().nonnegative(),
  })
  .strip();

export const AgentRunCompletedPayloadSchema = z
  .object({ runId: z.string().uuid(), result: z.string(), usage: UsageSchema })
  .strip();

export const AgentRunFailedPayloadSchema = z
  .object({ runId: z.string().uuid(), error: ErrorPayloadSchema })
  .strip();

/** Çok istemcili onay çakışmasını çözer: ilk cevap kazanır, diğerleri bunu görür (SPEC-AGENT.md §5). */
export const PermissionResolvedPayloadSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(["allow", "deny", "always_allow", "allow_for_run"]),
    resolvedBy: z.enum(["cli", "desktop", "web"]).optional(),
  })
  .strip();

export const UsageUpdatedPayloadSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    deltaTokens: z.number().int().nonnegative(),
    deltaCostUsd: z.number().nonnegative(),
    totals: UsageSchema,
    // Prompt caching token'ları — yalnız destekleyen sağlayıcıda (Anthropic) gelir.
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheCreationTokens: z.number().int().nonnegative().optional(),
  })
  .strip();

/**
 * API rate-limit anlık görüntüsü (sağlayıcı cevap header'larından türetilir).
 * Alanların hepsi opsiyonel: header taşımayan sağlayıcı/uç yalnız `provider`+`at` gönderir.
 * `*ResetAt` epoch ms; `retryAfterSec` yalnız 429 sonrası dolar.
 */
export const ProviderLimitsPayloadSchema = z
  .object({
    provider: z.string().min(1),
    requestsRemaining: z.number().int().nonnegative().optional(),
    requestsLimit: z.number().int().nonnegative().optional(),
    requestsResetAt: z.number().int().nonnegative().optional(),
    tokensRemaining: z.number().int().nonnegative().optional(),
    tokensLimit: z.number().int().nonnegative().optional(),
    tokensResetAt: z.number().int().nonnegative().optional(),
    retryAfterSec: z.number().nonnegative().optional(),
    at: z.number().int().nonnegative(),
  })
  .strip();
export type ProviderLimitsPayload = z.infer<typeof ProviderLimitsPayloadSchema>;

/** Tek bir GPU'nun anlık vitalleri (nvidia-smi'den örneklenir). `temperatureC` null olabilir (bazı GPU'lar bildirmez). */
export const GpuSampleSchema = z
  .object({
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    utilizationPct: z.number().min(0).max(100),
    memUsedMb: z.number().nonnegative(),
    memTotalMb: z.number().nonnegative(),
    temperatureC: z.number().nullable(),
  })
  .strip();
export type GpuSample = z.infer<typeof GpuSampleSchema>;

/** Yerel donanım vitalleri — Yaşayan Küre'yi fiziksel yükle sürer (TASARIM.md §2). */
export const HardwareUpdatedPayloadSchema = z
  .object({
    gpus: z.array(GpuSampleSchema),
    sampledAt: z.number().int().nonnegative(),
  })
  .strip();
export type HardwareUpdatedPayload = z.infer<typeof HardwareUpdatedPayloadSchema>;

export const LogEntryPayloadSchema = z
  .object({
    level: z.enum(["debug", "info", "warn", "error"]),
    source: z.string().min(1),
    message: z.string(),
    runId: z.string().uuid().optional(),
  })
  .strip();

export const EVENT_PAYLOAD_SCHEMAS = {
  "hello.ok": HelloOkPayloadSchema,
  "state.sync.ok": StateSyncOkPayloadSchema,
  "chat.start.ok": ChatStartOkPayloadSchema,
  "chat.cancel.ok": AckPayloadSchema,
  "agent.start.ok": AgentStartOkPayloadSchema,
  "agent.cancel.ok": AckPayloadSchema,
  "permission.respond.ok": AckPayloadSchema,
  "models.list.ok": ModelsListOkPayloadSchema,
  "agents.list.ok": AgentsListOkPayloadSchema,
  "providers.status.ok": ProvidersStatusOkPayloadSchema,
  "router.suggest.ok": RouterSuggestOkPayloadSchema,
  "usage.query.ok": UsageQueryOkPayloadSchema,
  "mcp.addServer.ok": McpAddServerOkPayloadSchema,
  "chat.delta": ChatDeltaPayloadSchema,
  "chat.completed": ChatCompletedPayloadSchema,
  "agent.run.started": AgentRunStartedPayloadSchema,
  "agent.run.state": AgentRunStatePayloadSchema,
  "agent.step.thinking": AgentStepThinkingPayloadSchema,
  "agent.tool.requested": AgentToolRequestedPayloadSchema,
  "agent.tool.started": AgentToolStartedPayloadSchema,
  "agent.tool.completed": AgentToolCompletedPayloadSchema,
  "agent.run.completed": AgentRunCompletedPayloadSchema,
  "agent.run.failed": AgentRunFailedPayloadSchema,
  "permission.resolved": PermissionResolvedPayloadSchema,
  "provider.health": ProviderHealthSchema,
  "usage.updated": UsageUpdatedPayloadSchema,
  "provider.limits": ProviderLimitsPayloadSchema,
  "hardware.updated": HardwareUpdatedPayloadSchema,
  "log.entry": LogEntryPayloadSchema,
  error: ErrorPayloadSchema,
} as const;

export type EventType = keyof typeof EVENT_PAYLOAD_SCHEMAS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[T]>;
