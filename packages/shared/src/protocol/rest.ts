import { z } from "zod";
import { ChatMessageSchema } from "./common.js";

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
