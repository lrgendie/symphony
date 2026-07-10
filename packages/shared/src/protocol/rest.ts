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
