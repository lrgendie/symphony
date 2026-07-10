import { z } from "zod";
import { ChatMessageSchema, UsageSchema } from "./common.js";

/**
 * REST geçmiş uçlarının cevap şemaları (PROTOKOL.md §1.1).
 * Kalıcı sohbet geçmişi WS olayı değildir; yalnız REST ile sorgulanır (ADR-011).
 */

export const HistorySessionSummarySchema = z
  .object({
    sessionId: z.string().uuid(),
    provider: z.string().min(1),
    model: z.string().min(1),
    /** İlk kullanıcı mesajından türetilen kısa başlık. */
    title: z.string(),
    /** epoch ms */
    createdAt: z.number().int().nonnegative(),
    /** epoch ms — son turun zamanı */
    updatedAt: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
  })
  .strip();
export type HistorySessionSummary = z.infer<typeof HistorySessionSummarySchema>;

export const HistoryMessageSchema = ChatMessageSchema.extend({
  /** epoch ms — mesajın oturuma ilk yazıldığı tur */
  at: z.number().int().nonnegative(),
}).strip();
export type HistoryMessage = z.infer<typeof HistoryMessageSchema>;

export const HistorySessionsResponseSchema = z
  .object({ sessions: z.array(HistorySessionSummarySchema) })
  .strip();
export type HistorySessionsResponse = z.infer<typeof HistorySessionsResponseSchema>;

export const HistorySessionDetailResponseSchema = z
  .object({
    session: HistorySessionSummarySchema,
    messages: z.array(HistoryMessageSchema),
  })
  .strip();
export type HistorySessionDetailResponse = z.infer<typeof HistorySessionDetailResponseSchema>;

/**
 * Kullanıcı profili REST uçları (ADR-013, Dilim M2). `content` her zaman dosyanın TAM
 * (kesilmemiş) içeriğidir — `truncated` yalnız agent bağlamına enjekte edilen kesimin
 * (MAX_PROFILE_CHARS) bir uyarısıdır, `content`'i etkilemez.
 */
export const MemoryGetResponseSchema = z
  .object({
    content: z.string(),
    chars: z.number().int().nonnegative(),
    truncated: z.boolean(),
    /** epoch ms — dosyanın son değişim zamanı; dosya hiç yazılmamışsa null */
    updatedAt: z.number().int().nonnegative().nullable(),
  })
  .strip();
export type MemoryGetResponse = z.infer<typeof MemoryGetResponseSchema>;

export const MemoryPutRequestSchema = z.object({ content: z.string() }).strip();
export type MemoryPutRequest = z.infer<typeof MemoryPutRequestSchema>;

/**
 * Yol haritası REST ucu (ADR-015 Karar 3, Dilim P2). `ROADMAP.md` sözleşmesi: `### başlık`
 * fazlar (başlıkta `✅` = tamamlanmış), `- [ ]/- [x]/- [~]` adımlar (todo/done/in_progress).
 * Bu kalıba uyan HERHANGİ bir dizinin ROADMAP.md'sinde çalışır — Symphony'ye özgü bir kayıt
 * DEĞİLDİR. `done`/`total` ilerleme çubuğu içindir (P3); `state` fazın genel rengi içindir.
 */
export const RoadmapPhaseSchema = z
  .object({
    title: z.string(),
    /** Tamamlanmış (`- [x]`) adım sayısı. */
    done: z.number().int().nonnegative(),
    /** Toplam adım sayısı (`- [ ]/- [x]/- [~]` hepsi). */
    total: z.number().int().nonnegative(),
    state: z.enum(["done", "in_progress", "todo"]),
  })
  .strip();
export type RoadmapPhase = z.infer<typeof RoadmapPhaseSchema>;

export const RoadmapResponseSchema = z.object({ phases: z.array(RoadmapPhaseSchema) }).strip();
export type RoadmapResponse = z.infer<typeof RoadmapResponseSchema>;

/**
 * Kullanım raporu (ADR-016 Karar 5, Dilim Z3): deterministik agregasyon, LLM YOK — bu uçtan
 * hiçbir provider çağrısı yapılmaz (kabul maddesi, `report/build.test.ts`'te doğrulanır).
 */
export const ReportUsageRowSchema = z
  .object({
    key: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strip();
export type ReportUsageRow = z.infer<typeof ReportUsageRowSchema>;

/** Model×görev-türü başarı satırı — router v2'nin (ADR-016 Karar 1) AYNI kaynağından türetilir. */
export const ReportSuccessRowSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    taskKind: z.enum(["code", "quick", "longContext", "general"]),
    runs: z.number().int().nonnegative(),
    /** Ham başarı oranı (ok/runs), 0..1 — router'ın Laplace-düzeltmeli skoru DEĞİL, insana gösterim içindir. */
    successRate: z.number().min(0).max(1),
    avgCostUsd: z.number().nonnegative(),
    avgTurnMs: z.number().nonnegative().optional(),
    /** `runs >= MIN_SAMPLES` mi — az örnekli satırlar bulgulara GİRMEZ (bkz. `findings`). */
    hasEvidence: z.boolean(),
  })
  .strip();
export type ReportSuccessRow = z.infer<typeof ReportSuccessRowSchema>;

export const ReportErrorRowSchema = z
  .object({ code: z.string().min(1), count: z.number().int().positive() })
  .strip();
export type ReportErrorRow = z.infer<typeof ReportErrorRowSchema>;

export const ReportFeedbackSummarySchema = z
  .object({ good: z.number().int().nonnegative(), bad: z.number().int().nonnegative() })
  .strip();
export type ReportFeedbackSummary = z.infer<typeof ReportFeedbackSummarySchema>;

export const ReportResponseSchema = z
  .object({
    /** epoch ms — sorgu aralığı (dahil). */
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    totals: UsageSchema,
    usageByModel: z.array(ReportUsageRowSchema),
    usageByDay: z.array(ReportUsageRowSchema),
    successTable: z.array(ReportSuccessRowSchema),
    topErrors: z.array(ReportErrorRowSchema),
    feedback: ReportFeedbackSummarySchema,
    /** Eşik-tabanlı, deterministik öneri cümleleri (Türkçe) — LLM üretmez. */
    findings: z.array(z.string()),
  })
  .strip();
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

/**
 * Bağlam haritası (ADR-016 Karar 6, Dilim Z4): mevcut `sessions`/`agent_runs` verisinin
 * deterministik grafı — embedding YOK. Kenarlar run→proje (cwd) ve aynı-takvim-günü zamansal
 * komşuluk; model bağı kenar DEĞİL, düğüm `meta`'sında taşınır (görsel kanal — renk/filtre).
 * Kurucu SAF core modülü (`core/src/context-map/build.ts`), bu uç yalnız sarar.
 */
export const ContextMapNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["session", "run", "project"]),
    label: z.string(),
    /** epoch ms */
    at: z.number().int().nonnegative(),
    /** Görünüm için ek alanlar (provider/model/cwd) — koşu detayı v1'de buradan gelir. */
    meta: z.record(z.unknown()),
  })
  .strip();
export type ContextMapNode = z.infer<typeof ContextMapNodeSchema>;

export const ContextMapEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    kind: z.enum(["project", "same_day"]),
  })
  .strip();
export type ContextMapEdge = z.infer<typeof ContextMapEdgeSchema>;

export const ContextMapResponseSchema = z
  .object({
    nodes: z.array(ContextMapNodeSchema),
    edges: z.array(ContextMapEdgeSchema),
  })
  .strip();
export type ContextMapResponse = z.infer<typeof ContextMapResponseSchema>;
