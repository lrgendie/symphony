import { WebSocket } from "ws";
import type { z } from "zod";
import {
  createMessage,
  MESSAGE_PAYLOAD_SCHEMAS,
  type Envelope,
  type MessageType,
} from "@symphony/shared";

type PayloadInput<T extends MessageType> = z.input<(typeof MESSAGE_PAYLOAD_SCHEMAS)[T]>;

/**
 * Olay yayını: kimliği doğrulanmış TÜM istemcilere aynı olay gider —
 * terminal ⇄ masaüstü eş zamanlılığının kalbi (ADR-001).
 */
export class EventBus {
  private readonly clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast<T extends MessageType>(
    type: T,
    payload: PayloadInput<T>,
    replyTo: string | null = null,
  ): Envelope {
    const message = createMessage(type, payload, replyTo);
    const data = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
    return message;
  }

  sendTo<T extends MessageType>(
    ws: WebSocket,
    type: T,
    payload: PayloadInput<T>,
    replyTo: string | null = null,
  ): Envelope {
    const message = createMessage(type, payload, replyTo);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
    return message;
  }
}
