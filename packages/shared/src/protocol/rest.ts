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
