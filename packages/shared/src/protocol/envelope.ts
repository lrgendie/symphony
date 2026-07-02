import { z } from "zod";
import { REQUEST_PAYLOAD_SCHEMAS } from "./requests.js";
import { EVENT_PAYLOAD_SCHEMAS } from "./events.js";
import type { ErrorPayload } from "./common.js";

/**
 * Tüm WS mesajlarının tek zarfı (PROTOKOL.md §2).
 * `strip` modu bilinçlidir: ileri sürümden gelen bilinmeyen alan eskiyi kırmaz (§7).
 */
export const EnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1),
    ts: z.number().int().nonnegative(),
    replyTo: z.string().uuid().nullable().default(null),
    payload: z.unknown(),
  })
  .strip();

export type Envelope = z.infer<typeof EnvelopeSchema>;

export const MESSAGE_PAYLOAD_SCHEMAS = {
  ...REQUEST_PAYLOAD_SCHEMAS,
  ...EVENT_PAYLOAD_SCHEMAS,
} as const;

export type MessageType = keyof typeof MESSAGE_PAYLOAD_SCHEMAS;

export interface ParsedMessage {
  id: string;
  type: MessageType;
  ts: number;
  replyTo: string | null;
  payload: unknown;
}

export type ParseResult = { ok: true; message: ParsedMessage } | { ok: false; error: ErrorPayload };

/**
 * Ham gelen veriyi (JSON.parse edilmiş) doğrular: önce zarf, sonra type'a özgü payload.
 * Şeması olmayan mesaj gönderilemez/alınamaz (CLAUDE.md kural 1).
 */
export function parseMessage(input: unknown): ParseResult {
  const envelope = EnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ENVELOPE",
        message: "Mesaj zarfı geçersiz",
        details: { issues: envelope.error.issues },
      },
    };
  }

  const { type } = envelope.data;
  if (!(type in MESSAGE_PAYLOAD_SCHEMAS)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_UNKNOWN_TYPE",
        message: `Bilinmeyen mesaj tipi: ${type}`,
        details: { type },
      },
    };
  }

  const schema = MESSAGE_PAYLOAD_SCHEMAS[type as MessageType];
  const payload = schema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_PAYLOAD",
        message: `'${type}' payload'ı şemaya uymuyor`,
        details: { type, issues: payload.error.issues },
      },
    };
  }

  return {
    ok: true,
    message: {
      id: envelope.data.id,
      type: type as MessageType,
      ts: envelope.data.ts,
      replyTo: envelope.data.replyTo,
      payload: payload.data,
    },
  };
}

/** Giden mesaj üretici — id ve ts'yi doldurur; payload'ı şemadan geçirir (garbage-out önlemi). */
export function createMessage<T extends MessageType>(
  type: T,
  payload: z.input<(typeof MESSAGE_PAYLOAD_SCHEMAS)[T]>,
  replyTo: string | null = null,
): Envelope {
  const schema = MESSAGE_PAYLOAD_SCHEMAS[type];
  return {
    id: crypto.randomUUID(),
    type,
    ts: Date.now(),
    replyTo,
    payload: schema.parse(payload),
  };
}
