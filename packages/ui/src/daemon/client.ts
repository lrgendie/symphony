import {
  createMessage,
  parseMessage,
  PROTOCOL_VERSION,
  type EventPayload,
  type EventType,
} from "@symphony/shared";
import { getBootstrap } from "../config";
import { useStore } from "../store";

/**
 * Tarayıcı/webview tarafı daemon istemcisi — PROTOKOL.md'nin UI ayağı.
 * CLI'nin DaemonClient'ı node `ws` + dosya sistemine bağlıdır; bu ise native
 * WebSocket + `@symphony/shared` (saf zod) kullanır, hiçbir Node API'sine dokunmaz.
 * Read-only: hello el sıkışması → snapshot → yayın olaylarını store'a akıtır.
 * Yeniden bağlanma üstel geri çekilmeli (ADR-011: replay yok, her bağlanışta snapshot).
 */

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

export class DaemonConnection {
  private ws: WebSocket | null = null;
  private closed = false;
  private helloId = "";
  private attempt = 0;

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    const boot = getBootstrap();
    const store = useStore.getState();
    if (boot === null) {
      store.setStatus("disconnected");
      store.setError(
        "Daemon bağlantı bilgisi yok. Daemon çalışmıyor olabilir — terminalde " +
          "`symphony status` ile başlat. (Tarayıcı dev için: `pnpm --filter @symphony/ui dev:token`.)",
      );
      return;
    }

    store.setStatus("connecting");
    const ws = new WebSocket(`ws://127.0.0.1:${boot.port}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      const hello = createMessage("hello", {
        token: boot.token,
        client: "desktop",
        protocolVersion: PROTOCOL_VERSION,
      });
      this.helloId = hello.id;
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (event) => this.onMessage(String(event.data));

    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      useStore.getState().setStatus("disconnected");
      const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 15000;
      this.attempt += 1;
      window.setTimeout(() => {
        if (!this.closed) this.open();
      }, delay);
    };

    // onerror'da bir şey yapmıyoruz: her hata zaten onclose'u tetikler (yeniden bağlan).
    ws.onerror = () => undefined;
  }

  private onMessage(raw: string): void {
    let input: unknown;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {
      return; // bozuk çerçeve: yok say (daemon şemasız mesaj göndermez)
    }
    const result = parseMessage(input);
    if (!result.ok) return;
    const { type, payload, replyTo } = result.message;
    const store = useStore.getState();

    if (replyTo === this.helloId && this.helloId !== "") {
      if (type === "hello.ok") {
        this.attempt = 0;
        const ok = payload as EventPayload<"hello.ok">;
        store.applySnapshot(ok.snapshot, ok.daemonVersion);
        store.setStatus("connected");
      } else if (type === "error") {
        const err = payload as EventPayload<"error">;
        store.setError(`${err.code}: ${err.message}`);
      }
      return;
    }

    store.handleEvent(type as EventType, payload);
  }
}
