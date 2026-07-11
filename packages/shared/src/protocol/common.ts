import { z } from "zod";
import { AgentRunStateSchema } from "./agent-state.js";

/** Hata kodu uzayı: AUTH_*, PROVIDER_*, AGENT_*, PERMISSION_*, VALIDATION_*, INTERNAL_* (PROTOKOL.md §2). */
export const ERROR_CODE_PATTERN =
  /^(AUTH|PROVIDER|AGENT|PERMISSION|VALIDATION|INTERNAL)_[A-Z0-9_]+$/;

export const ErrorPayloadSchema = z
  .object({
    code: z.string().regex(ERROR_CODE_PATTERN),
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
  })
  .strip();
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strip();
export type Usage = z.infer<typeof UsageSchema>;

/** Araç risk sınıfları (SPEC-AGENT.md §2). */
export const RiskClassSchema = z.enum(["safe", "mutating", "destructive"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const ChatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })
  .strip();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ProviderHealthSchema = z
  .object({
    provider: z.string().min(1),
    status: z.enum(["up", "down", "degraded"]),
    latencyMs: z.number().nonnegative().optional(),
  })
  .strip();
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const PendingPermissionSchema = z
  .object({
    requestId: z.string().uuid(),
    runId: z.string().uuid(),
    tool: z.string().min(1),
    args: z.record(z.unknown()),
    riskClass: RiskClassSchema,
    diff: z.string().optional(),
  })
  .strip();
export type PendingPermission = z.infer<typeof PendingPermissionSchema>;

export const ActiveRunSchema = z
  .object({
    runId: z.string().uuid(),
    agentId: z.string().min(1),
    task: z.string(),
    state: AgentRunStateSchema,
    model: z.string().optional(),
    /** Faz 5 (ADR-014): koşu bir `run_agent` devretmesiyle başlatıldıysa ebeveynin runId'si. */
    parentRunId: z.string().uuid().optional(),
    /** Faz 4 (ADR-015): koşunun çalışma dizini — istemciler "proje" gruplamasını bununla kurar. */
    cwd: z.string().min(1).optional(),
  })
  .strip();
export type ActiveRun = z.infer<typeof ActiveRunSchema>;

/** Yeniden bağlanmada verilen tam durum görüntüsü — replay yok, snapshot var (ADR-011). */
export const SnapshotSchema = z
  .object({
    runs: z.array(ActiveRunSchema),
    providers: z.array(ProviderHealthSchema),
    pendingPermissions: z.array(PendingPermissionSchema),
  })
  .strip();
export type Snapshot = z.infer<typeof SnapshotSchema>;

/** `agents.list.ok` satırı: agent tanımının kimlik kartı (SPEC-AGENT.md §1). */
export const AgentSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    tools: z.array(z.string().min(1)),
    mcpServers: z.array(z.string().min(1)),
    maxSteps: z.number().int().positive(),
  })
  .strip();
export type AgentSummary = z.infer<typeof AgentSummarySchema>;

export const ModelInfoSchema = z
  .object({
    provider: z.string().min(1),
    id: z.string().min(1),
    displayName: z.string().optional(),
    local: z.boolean(),
    contextWindow: z.number().int().positive().optional(),
  })
  .strip();
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/**
 * Yama önerisi özeti (ADR-018 Karar 3, Faz 8 Dilim D3). `diff` BİLİNÇLE YOK — büyük olabilir;
 * liste yüzeyinde taşınmaz (`symphony patch show` gerekirse ayrı bir uçla gelir).
 */
export const PatchStateSchema = z.enum(["proposed", "applied", "rejected", "reverted", "failed"]);
export type PatchState = z.infer<typeof PatchStateSchema>;

export const PatchSummarySchema = z
  .object({
    id: z.string().uuid(),
    /** epoch ms */
    createdAt: z.number().int().nonnegative(),
    errorCode: z.string().min(1),
    category: z.string().min(1),
    /** `doktor/<slug>` — `patch apply`ın merge edeceği dal (D2 boru hattı commit'ledi). */
    branch: z.string().min(1),
    files: z.array(z.string()),
    /** BORU HATTININ ölçümü (agent beyanı DEĞİL, ADR-018 Karar 2). */
    testOk: z.boolean(),
    testSummary: z.string(),
    state: PatchStateSchema,
    resolvedAt: z.number().int().nonnegative().nullable(),
  })
  .strip();
export type PatchSummary = z.infer<typeof PatchSummarySchema>;
