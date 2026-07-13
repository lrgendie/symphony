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

/**
 * Kendini geliştirme özeti (ADR-018 Karar 5/6, Faz 8 Dilim D5) — `patches` tablosunun anlık
 * durumu (rapor ARALIĞIYLA sınırlı DEĞİL; sicil kümülatif bir kavramdır, D4'teki `patch trust`
 * ile AYNI yaklaşım). `recurring`: `doctor.diagnose()`nin ŞU ANKİ adayları (aynı deterministik
 * eşik, LLM YOK).
 */
export const ReportSelfDevCategorySchema = z
  .object({
    category: z.string().min(1),
    applied: z.number().int().nonnegative(),
    unhealthy: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strip();
export type ReportSelfDevCategory = z.infer<typeof ReportSelfDevCategorySchema>;

export const ReportSelfDevSchema = z
  .object({
    recurring: z.array(ReportErrorRowSchema),
    proposed: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
    reverted: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    categories: z.array(ReportSelfDevCategorySchema),
  })
  .strip();
export type ReportSelfDev = z.infer<typeof ReportSelfDevSchema>;

/**
 * Agent tanım-güncelleme önerisi (ADR-018 Karar 8, Faz 8 Dilim D7) — yalnız PİNSİZ agent'lar
 * için, yalnız model pinleme önerir. `symphony agent-oneri uygula <agentId>` bu satırı kullanır.
 */
export const AgentSuggestionSchema = z
  .object({
    agentId: z.string().min(1),
    suggestedProvider: z.string().min(1),
    suggestedModel: z.string().min(1),
    suggestedRuns: z.number().int().positive(),
    suggestedSuccessRate: z.number().min(0).max(1),
    runnerUpProvider: z.string().min(1),
    runnerUpModel: z.string().min(1),
    runnerUpSuccessRate: z.number().min(0).max(1),
    reason: z.string().min(1),
  })
  .strip();
export type AgentSuggestion = z.infer<typeof AgentSuggestionSchema>;

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
    selfDev: ReportSelfDevSchema,
    agentSuggestions: z.array(AgentSuggestionSchema),
  })
  .strip();
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

/**
 * Bağlam haritası (ADR-016 Karar 6, Dilim Z4; ADR-019 Karar 2/3/4/7b, Dilim H2): mevcut
 * `sessions`/`agent_runs` verisinin deterministik grafı + kalıcı kürasyon (`map_nodes`/
 * `map_edges`) bindirmesi + haftalık katlanma. Kurucu SAF core modülü
 * (`core/src/context-map/build.ts`), bu uç yalnız sarar.
 */
export const ContextMapNodeSchema = z
  .object({
    id: z.string().min(1),
    /**
     * İstemci toleransı (ADR-019 Karar 7b): katı enum DEĞİL — daemon önde/istemci geride
     * kaldığında bilinmeyen bir `kind` ayrıştırma hatasıyla haritayı "bağlantı yok"a düşürmesin,
     * UI tarafı bilinmeyen türü jenerik düğüm çizer. Bilinen türler: `ContextMapNodeKind`.
     */
    kind: z.string(),
    label: z.string(),
    /** epoch ms */
    at: z.number().int().nonnegative(),
    /** Görünüm için ek alanlar (provider/model/cwd/refKind/refId/sessionCount/...). */
    meta: z.record(z.unknown()),
  })
  .strip();
export type ContextMapNode = z.infer<typeof ContextMapNodeSchema>;

/** Bilinen düğüm türleri (dokümantasyon amaçlı union — şema `z.string()` ile gevşek kalır). */
export type ContextMapNodeKind =
  | "session"
  | "run"
  | "project"
  | "context"
  | "group"
  | "week"
  | "model"
  | "agent";

export const ContextMapEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    /** İstemci toleransı (ADR-019 Karar 7b) — bkz. `ContextMapNodeSchema.kind`. */
    kind: z.string(),
  })
  .strip();
export type ContextMapEdge = z.infer<typeof ContextMapEdgeSchema>;

/** Bilinen kenar türleri (dokümantasyon amaçlı union). */
export type ContextMapEdgeKind =
  | "project"
  | "same_day"
  | "pin"
  | "link"
  | "member"
  | "model"
  | "agent"
  | "week";

export const ContextMapResponseSchema = z
  .object({
    nodes: z.array(ContextMapNodeSchema),
    edges: z.array(ContextMapEdgeSchema),
  })
  .strip();
export type ContextMapResponse = z.infer<typeof ContextMapResponseSchema>;
