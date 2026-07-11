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
export type BusObserver = (type: MessageType, payload: unknown) => void;

export class EventBus {
  private readonly clients = new Set<WebSocket>();
  /** Daemon-İÇİ dinleyiciler (ADR-018 Dilim D2) — WS istemcisi DEĞİL, süreç içi boru hatları. */
  private readonly observers = new Set<BusObserver>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
  }

  remove(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Daemon içinden yayınlanan olayları dinler (doktor boru hattı bir koşunun BİTİŞİNİ böyle
   * bekler — ADR-018 Karar 2). Yalnız `broadcast` gözlemcilere düşer; `sendTo` DÜŞMEZ (o bir
   * isteğe verilen hedefli cevaptır, yayın değil). Dönen fonksiyon aboneliği kaldırır.
   */
  observe(observer: BusObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
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
    // Gözlemci hatası yayını KESMEZ — bir boru hattının çökmesi olay akışını bozamaz.
    for (const observer of this.observers) {
      try {
        observer(type, message.payload);
      } catch {
        // yut: gözlemci kendi hatasını kendi loglar.
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
