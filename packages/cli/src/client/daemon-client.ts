import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import type { z } from "zod";
import {
  createMessage,
  HistorySessionDetailResponseSchema,
  HistorySessionsResponseSchema,
  parseMessage,
  PROTOCOL_VERSION,
  type EventPayload,
  type EventType,
  type HistorySessionDetailResponse,
  type HistorySessionSummary,
  type REQUEST_PAYLOAD_SCHEMAS,
  type RequestType,
  type Snapshot,
  type Usage,
} from "@symphony/shared";
import { getSymphonyPaths, loadConfig } from "@symphony/core";

/**
 * Daemon istemcisi — PROTOKOL.md'nin istemci tarafı.
 * WS bağlantısı + hello el sıkışması, replyTo korelasyonlu istek/cevap,
 * yayın olaylarına abonelik ve üstel geri çekilmeli yeniden bağlanma (§6).
 */

type RequestInput<T extends RequestType> = z.input<(typeof REQUEST_PAYLOAD_SCHEMAS)[T]>;
type OkType<T extends RequestType> = Extract<`${T}.ok`, EventType>;

export interface DaemonClientOptions {
  port: number;
  token: string;
  /** Yeniden bağlanma denemeleri (test için kapatılabilir). Varsayılan: açık. */
  reconnect?: boolean;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  /**
   * true → ilk cevapta silinmez: chat gibi akışlarda daemon aynı replyTo ile
   * ÖNCE `.ok`, SONRA (hata olursa) `error` gönderebilir; ikisi de yakalanmalı.
   */
  sticky?: boolean;
}

export class DaemonError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

export class DaemonClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly events = new EventEmitter();
  private closed = false;
  /** hello.ok ile gelen son tam durum görüntüsü (ADR-011: replay yok, snapshot var). */
  snapshot: Snapshot | null = null;

  constructor(private readonly options: DaemonClientOptions) {}

  /** Bağlan + hello el sıkışması. Başarıda snapshot dolu döner. */
  async open(): Promise<void> {
    await this.connectOnce();
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${this.options.port}/ws`);
      this.ws = ws;
      let helloDone = false;

      ws.on("open", () => {
        const hello = createMessage("hello", {
          token: this.options.token,
          client: "cli",
          protocolVersion: PROTOCOL_VERSION,
        });
        this.pending.set(hello.id, {
          resolve: (payload) => {
            helloDone = true;
            this.snapshot = (payload as { snapshot: Snapshot }).snapshot;
            resolve();
          },
          reject: (error) => {
            helloDone = true;
            reject(error);
          },
        });
        ws.send(JSON.stringify(hello));
      });

      ws.on("message", (raw) => this.handleMessage(String(raw)));

      ws.on("error", (error) => {
        if (!helloDone) reject(error);
      });

      ws.on("close", () => {
        this.failAllPending(new DaemonError("INTERNAL_CONNECTION_LOST", "Daemon bağlantısı koptu"));
        if (this.closed) return;
        if (!helloDone) {
          reject(new DaemonError("INTERNAL_CONNECTION_LOST", "Bağlantı hello öncesi kapandı"));
          return;
        }
        this.events.emit("client:down");
        if (this.options.reconnect !== false) void this.reconnectLoop();
      });
    });
  }

  /** PROTOKOL §6: 1s → 2s → 4s → ... maks 30s geri çekilme; başarıda snapshot yenilenir. */
  private async reconnectLoop(): Promise<void> {
    for (let attempt = 0; !this.closed; attempt++) {
      const step = BACKOFF_STEPS_MS[Math.min(attempt, BACKOFF_STEPS_MS.length - 1)] ?? 30_000;
      await delay(step);
      if (this.closed) return;
      try {
        await this.connectOnce();
        this.events.emit("client:reconnected", this.snapshot);
        return;
      } catch {
        // sıradaki denemeye geç
      }
    }
  }

  private handleMessage(raw: string): void {
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return; // bozuk çerçeve: yok say (daemon şemasız mesaj gönderemez)
    }
    const result = parseMessage(input);
    if (!result.ok) return;
    const message = result.message;

    if (message.replyTo !== null && this.pending.has(message.replyTo)) {
      const waiter = this.pending.get(message.replyTo);
      if (waiter !== undefined && waiter.sticky !== true) this.pending.delete(message.replyTo);
      if (message.type === "error") {
        const payload = message.payload as { code: string; message: string };
        this.pending.delete(message.replyTo); // hata her durumda korelasyonu bitirir
        waiter?.reject(new DaemonError(payload.code, payload.message));
      } else {
        waiter?.resolve(message.payload);
      }
      return;
    }
    // EventEmitter'da dinleyicisiz "error" olayı fırlatır — sahipsiz hata çökme yaratmasın
    if (message.type === "error" && this.events.listenerCount("error") === 0) return;
    // Yayın olayı (veya cevabı beklenmeyen mesaj) → abonelere dağıt
    this.events.emit(message.type, message.payload);
  }

  private failAllPending(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  /** İstek gönder, `<type>.ok` cevabını bekle. Hata cevabı DaemonError fırlatır. */
  async request<T extends RequestType>(
    type: T,
    payload: RequestInput<T>,
  ): Promise<EventPayload<OkType<T>>> {
    const { promise } = this.send(type, payload);
    return promise;
  }

  /** Düşük seviye: mesaj id'sini de döndürür (chat gibi olay-takipli akışlar için). */
  send<T extends RequestType>(
    type: T,
    payload: RequestInput<T>,
  ): { id: string; promise: Promise<EventPayload<OkType<T>>> } {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) {
      const error = new DaemonError("INTERNAL_NOT_CONNECTED", "Daemon'a bağlı değil");
      return { id: "", promise: Promise.reject(error) };
    }
    // Generic indeksleme (REQUEST ∪ EVENT birleşimi) TS'te çözümlenemiyor;
    // güvenlik kaybolmaz: createMessage payload'ı her durumda şemadan geçirir.
    const buildMessage = createMessage as (
      t: string,
      p: unknown,
    ) => ReturnType<typeof createMessage>;
    const message = buildMessage(type, payload);
    const promise = new Promise<EventPayload<OkType<T>>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(message.id);
        reject(
          new DaemonError(
            "INTERNAL_TIMEOUT",
            `'${type}' cevabı ${REQUEST_TIMEOUT_MS}ms içinde gelmedi`,
          ),
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(message.id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as EventPayload<OkType<T>>);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(JSON.stringify(message));
    });
    return { id: message.id, promise };
  }

  /** Yayın olayına abone ol; aboneliği kaldıran fonksiyon döner. */
  on<T extends EventType>(type: T, handler: (payload: EventPayload<T>) => void): () => void {
    this.events.on(type, handler);
    return () => this.events.off(type, handler);
  }

  /** Bağlantı meta olayları: "client:down" | "client:reconnected". */
  onClientEvent(type: "client:down" | "client:reconnected", handler: () => void): () => void {
    this.events.on(type, handler);
    return () => this.events.off(type, handler);
  }

  /**
   * Sohbet akışı: chat.start gönderir, delta'ları çağırıcıya iletir,
   * chat.completed ile kullanım döndürür. Korelasyon kaydı GÖNDERMEDEN ÖNCE
   * ve sticky yapılır: daemon aynı replyTo ile önce `.ok`, sonra (hata olursa)
   * `error` gönderir — ikisi aynı TCP paketinde bile gelse yakalanır.
   */
  chat(
    params: RequestInput<"chat.start">,
    onDelta: (text: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<Usage> {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new DaemonError("INTERNAL_NOT_CONNECTED", "Daemon'a bağlı değil"));
    }
    const buildMessage = createMessage as (
      t: string,
      p: unknown,
    ) => ReturnType<typeof createMessage>;
    const message = buildMessage("chat.start", params);

    return new Promise<Usage>((resolve, reject) => {
      let sessionId: string | null = null;
      const cleanups: Array<() => void> = [() => this.pending.delete(message.id)];
      const cleanup = (): void => {
        for (const fn of cleanups) fn();
      };
      const fail = (error: Error): void => {
        cleanup();
        reject(error);
      };

      this.pending.set(message.id, {
        sticky: true,
        resolve: (payload) => {
          sessionId = (payload as { sessionId: string }).sessionId;
        },
        reject: fail,
      });

      cleanups.push(
        this.on("chat.delta", (payload) => {
          if (payload.sessionId === sessionId) onDelta(payload.text);
        }),
      );
      cleanups.push(
        this.on("chat.completed", (payload) => {
          if (payload.sessionId !== sessionId) return;
          cleanup();
          resolve(payload.usage);
        }),
      );
      cleanups.push(
        this.onClientEvent("client:down", () => {
          fail(new DaemonError("INTERNAL_CONNECTION_LOST", "Sohbet sırasında bağlantı koptu"));
        }),
      );
      if (abortSignal !== undefined) {
        const onAbort = (): void => {
          if (sessionId !== null) {
            void this.request("chat.cancel", { sessionId }).catch(() => undefined);
          }
          fail(new DaemonError("INTERNAL_CANCELLED", "Sohbet iptal edildi"));
        };
        abortSignal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => abortSignal.removeEventListener("abort", onAbort));
      }

      ws.send(JSON.stringify(message));
    });
  }

  // ---- REST geçmiş sorguları (PROTOKOL §1.1) ----
  // Kalıcı sohbet geçmişi WS olayı değildir; Bearer token'lı REST ile sorgulanır (ADR-011).
  // WS zaten açık olduğundan port+token elimizde; ayrı bir el sıkışmasına gerek yok.

  /** /api/health dışı uçlar Bearer token ister; 404 → null (yok), diğer hatalar fırlatır. */
  private async getHistory(path: string): Promise<unknown | null> {
    const response = await fetch(`http://127.0.0.1:${this.options.port}${path}`, {
      headers: { authorization: `Bearer ${this.options.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new DaemonError(
        "INTERNAL_HISTORY_FAILED",
        body?.message ?? `Geçmiş sorgusu başarısız (HTTP ${response.status})`,
      );
    }
    return response.json();
  }

  /** Son sohbet oturumları (yeni→eski). Kayıt yoksa boş dizi. */
  async listSessions(limit = 50): Promise<HistorySessionSummary[]> {
    const raw = await this.getHistory(`/api/history/sessions?limit=${limit}`);
    return HistorySessionsResponseSchema.parse(raw).sessions;
  }

  /** Bir oturumun mesajlarıyla tam dökümü. Oturum yoksa null. */
  async sessionDetail(sessionId: string): Promise<HistorySessionDetailResponse | null> {
    const raw = await this.getHistory(`/api/history/sessions/${encodeURIComponent(sessionId)}`);
    return raw === null ? null : HistorySessionDetailResponseSchema.parse(raw);
  }

  close(): void {
    this.closed = true;
    this.failAllPending(new DaemonError("INTERNAL_CLOSED", "İstemci kapatıldı"));
    this.ws?.close();
  }
}

// ---- Daemon keşfi ve otomatik başlatma (ROADMAP Faz 2) ----

export interface EnsureDaemonResult {
  /** true = bu çağrı daemon'ı başlattı; false = zaten çalışıyordu. */
  started: boolean;
  port: number;
}

async function healthOk(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** `@symphony/core`'un daemon giriş noktası (dist/main.js) — spawn hedefi. */
export function resolveDaemonEntry(): string {
  const require = createRequire(import.meta.url);
  // core, exports haritasında "./daemon" alt yolunu bu amaçla açar.
  return require.resolve("@symphony/core/daemon");
}

/**
 * Daemon çalışmıyorsa ayrık (detached) süreç olarak başlatır ve sağlık bekler.
 * CLI kapansa da daemon yaşamaya devam eder — kalıcı süreç modeli (ADR-001).
 */
export async function ensureDaemonRunning(home?: string): Promise<EnsureDaemonResult> {
  const paths = getSymphonyPaths(home);
  const config = loadConfig(paths);
  const port = config.daemon.port;
  if (await healthOk(port)) return { started: false, port };

  const child = spawn(process.execPath, [resolveDaemonEntry()], {
    detached: true,
    stdio: "ignore",
    // Windows: detached node.exe aksi hâlde görünür bir konsol penceresi açar (kullanıcıya "flaşlayan
    // exe" gibi görünür). Daemon zaten arka plan sürecidir → pencereyi gizle. POSIX'te etkisizdir.
    windowsHide: true,
    env: { ...process.env, ...(home !== undefined ? { SYMPHONY_HOME: home } : {}) },
  });
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await healthOk(port)) return { started: true, port };
    await delay(250);
  }
  throw new DaemonError(
    "INTERNAL_DAEMON_START_FAILED",
    `Daemon ${port} portunda 10 sn içinde ayağa kalkmadı`,
  );
}

/** Tam akış: gerekirse başlat → token'ı oku → bağlan + hello. */
export async function connectToDaemon(options: { home?: string } = {}): Promise<DaemonClient> {
  const { port } = await ensureDaemonRunning(options.home);
  const paths = getSymphonyPaths(options.home);
  const token = readFileSync(paths.daemonTokenFile, "utf8").trim();
  const client = new DaemonClient({ port, token });
  await client.open();
  return client;
}
