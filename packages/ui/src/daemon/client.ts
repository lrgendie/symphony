import {
  ContextMapResponseSchema,
  createMessage,
  HistorySessionDetailResponseSchema,
  parseMessage,
  PROTOCOL_VERSION,
  RoadmapResponseSchema,
  type ContextMapResponse,
  type EventPayload,
  type EventType,
  type HistorySessionDetailResponse,
  type RoadmapPhase,
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

/** İzin kararı (SPEC-AGENT §5) — masaüstünden de gönderilebilir; ilk cevap kazanır. */
export type PermissionDecision = "allow" | "deny" | "always_allow" | "allow_for_run";

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

  /**
   * İzin isteğine cevap gönderir (permission.respond). Fire-and-forget: asıl teyit,
   * daemon'ın TÜM istemcilere yaydığı `permission.resolved` olayıdır (store onu dinler).
   * Bağlı değilse sessizce düşer (kart yeniden bağlanınca snapshot'tan geri gelir).
   */
  respond(requestId: string, decision: PermissionDecision): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(createMessage("permission.respond", { requestId, decision })));
  }

  /**
   * Model panosu için tüm-zaman token/maliyet dökümünü ister (bağlanınca çağrılır).
   * Cevabı (`usage.query.ok`) hello dışı bir replyTo taşır → store.handleEvent seed'ler.
   */
  private queryUsage(): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(createMessage("usage.query", { groupBy: "model" })));
  }

  private open(): void {
    // Aynı anda birden çok soket açılmasın (StrictMode çift-mount / yeniden bağlanma).
    if (this.ws !== null) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
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
        // Snapshot canlı durumu verir ama geçmiş kullanımı değil; ayrı sorguyla seed'liyoruz.
        this.queryUsage();
      } else if (type === "error") {
        const err = payload as EventPayload<"error">;
        store.setError(`${err.code}: ${err.message}`);
      }
      return;
    }

    store.handleEvent(type as EventType, payload);
  }
}

/** Uygulama boyunca tek bağlantı — App effect'i start/stop eder, bileşenler respond() çağırır. */
export const daemon = new DaemonConnection();

/**
 * Yol haritası (ADR-015 Karar 3, Dilim P3) — WS akışının DIŞINDA, istek başına REST çağrısı
 * (roadmap'in her koşu olayında değişmesi beklenmez). Bağlantı bilgisi yoksa/istek başarısızsa/
 * `<dir>/ROADMAP.md` yoksa (404) sessizce `null` döner — panel gizlenir, hata gösterilmez.
 */
export async function fetchRoadmap(dir: string): Promise<RoadmapPhase[] | null> {
  const boot = getBootstrap();
  if (boot === null) return null;
  let res: Response;
  try {
    res = await fetch(
      `http://127.0.0.1:${boot.port}/api/roadmap?dir=${encodeURIComponent(dir)}`,
      { headers: { authorization: `Bearer ${boot.token}` } },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = RoadmapResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.phases : null;
}

/**
 * Bağlam haritası (ADR-016 Karar 6, Dilim Z5) — `fetchRoadmap` ile AYNI desen: istek başına
 * REST, bağlantı yok/ağ hatası/şema uyuşmazlığı → sessizce `null` (throw etmez, görünüm boş
 * mesajı gösterir). Sekme her açılışta yeniden çeker (agresif polling yok).
 */
export async function fetchContextMap(limit?: number): Promise<ContextMapResponse | null> {
  const boot = getBootstrap();
  if (boot === null) return null;
  const query = limit !== undefined ? `?limit=${limit}` : "";
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${boot.port}/api/context-map${query}`, {
      headers: { authorization: `Bearer ${boot.token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = ContextMapResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

/**
 * Bağlam haritasında bir "session" düğümüne tıklanınca tam döküm (ADR-016 Karar 6 Görsel:
 * "koşu detayı meta'dan, oturum dökümü history REST'inden") — `fetchRoadmap` ile AYNI desen.
 */
export async function fetchSessionDetail(sessionId: string): Promise<HistorySessionDetailResponse | null> {
  const boot = getBootstrap();
  if (boot === null) return null;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${boot.port}/api/history/sessions/${sessionId}`, {
      headers: { authorization: `Bearer ${boot.token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = HistorySessionDetailResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}
