import {
  ContextMapResponseSchema,
  createMessage,
  HistorySessionDetailResponseSchema,
  parseMessage,
  PROTOCOL_VERSION,
  RoadmapResponseSchema,
  type ContextMapResponse,
  type Envelope,
  type EventPayload,
  type EventType,
  type HistorySessionDetailResponse,
  type RoadmapPhase,
} from "@lrgendie/shared";
import { getBootstrap } from "../config";
import { useStore } from "../store";

/**
 * Tarayıcı/webview tarafı daemon istemcisi — PROTOKOL.md'nin UI ayağı.
 * CLI'nin DaemonClient'ı node `ws` + dosya sistemine bağlıdır; bu ise native
 * WebSocket + `@lrgendie/shared` (saf zod) kullanır, hiçbir Node API'sine dokunmaz.
 * Read-only: hello el sıkışması → snapshot → yayın olaylarını store'a akıtır.
 * Yeniden bağlanma üstel geri çekilmeli (ADR-011: replay yok, her bağlanışta snapshot).
 */

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];

/** İzin kararı (SPEC-AGENT §5) — masaüstünden de gönderilebilir; ilk cevap kazanır. */
export type PermissionDecision = "allow" | "deny" | "always_allow" | "allow_for_run";

/**
 * Bağlam haritası kürasyon isteğinin sonucu (ADR-019, Dilim H3). `respond()`/`queryUsage()`in
 * fire-and-forget deseninden FARKLI: bu istekler `.ok`/`error` cevabını BEKLER (kürasyon
 * düğmesi başarı/başarısızlık göstermeli). Sürüm sapması (Karar 7c): eski daemon `map.*` tipini
 * tanımaz → cevap `replyTo:null` ile gelir, korelasyon eşleşmez → timeout → güncelleme ipucu.
 */
export type CurationResult =
  | { ok: true; nodeId?: string }
  | { ok: false; code: string; message: string };

const CURATION_TIMEOUT_MS = 8000;

export class DaemonConnection {
  private ws: WebSocket | null = null;
  private closed = false;
  private helloId = "";
  private attempt = 0;
  /** Bekleyen kürasyon istekleri: mesaj id → sonucu çözecek geri çağrı + zaman aşımı timer'ı. */
  private pending = new Map<string, { resolve: (r: CurationResult) => void; timer: number }>();

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

  // ---- Bağlam haritası kürasyonu (ADR-019 Karar 2/6, Dilim H3) ----
  // Her biri tek bir `map.*` isteği yollar ve `.ok`/`error` cevabını bekler. Şema `createMessage`
  // içinde doğrulanır (garbage-out önlemi); daemon doğrulaması (PROTECTED/UNKNOWN/REF_UNKNOWN)
  // `error` cevabı olarak döner ve `CurationResult` içinde çağırana taşınır.

  pin(ref: { kind: "session" | "run"; id: string }): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.pin", { ref }));
  }
  renameNode(nodeId: string, title: string): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.node.rename", { nodeId, title }));
  }
  deleteNode(nodeId: string): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.node.delete", { nodeId }));
  }
  createGroup(title: string, members: string[]): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.group.create", { title, members }));
  }
  addMember(groupId: string, nodeId: string): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.member.add", { groupId, nodeId }));
  }
  removeMember(groupId: string, nodeId: string): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.member.remove", { groupId, nodeId }));
  }
  addLink(from: string, to: string): Promise<CurationResult> {
    return this.awaitReply(createMessage("map.link.add", { from, to }));
  }

  /** Mesajı yollar, `replyTo` ile eşleşen cevabı (ya da zaman aşımını) bekler. */
  private awaitReply(msg: Envelope): Promise<CurationResult> {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({
        ok: false,
        code: "DISCONNECTED",
        message: "Daemon bağlantısı yok — yeniden bağlanılıyor, sonra tekrar dene.",
      });
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.settle(msg.id, {
          ok: false,
          code: "TIMEOUT",
          message: "Daemon yanıt vermedi. Eski bir daemon olabilir — güncelle: symphony update",
        });
      }, CURATION_TIMEOUT_MS);
      this.pending.set(msg.id, { resolve, timer });
      ws.send(JSON.stringify(msg));
    });
  }

  /** Bekleyen bir isteği çözer (cevap geldi, timeout doldu ya da bağlantı kapandı). */
  private settle(id: string, result: CurationResult): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    window.clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(result);
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
          "`symphony status` ile başlat. (Tarayıcı dev için: `pnpm --filter @lrgendie/ui dev:token`.)",
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
      // Bekleyen kürasyon istekleri asılı kalmasın — hepsi bağlantı-kapandı ile çözülür.
      for (const id of [...this.pending.keys()]) {
        this.settle(id, { ok: false, code: "DISCONNECTED", message: "Bağlantı kapandı." });
      }
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

    // Bekleyen bir kürasyon isteğinin cevabı mı? (map.*.ok / hedefli error) — store'a düşmez.
    if (replyTo !== null && this.pending.has(replyTo)) {
      if (type === "error") {
        const err = payload as EventPayload<"error">;
        this.settle(replyTo, { ok: false, code: err.code, message: err.message });
      } else {
        const ok = payload as { nodeId?: string };
        this.settle(replyTo, { ok: true, nodeId: ok.nodeId });
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
export async function fetchContextMap(
  opts: { limit?: number; week?: string } = {},
): Promise<ContextMapResponse | null> {
  const boot = getBootstrap();
  if (boot === null) return null;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.week !== undefined) params.set("week", opts.week);
  const query = params.toString();
  let res: Response;
  try {
    res = await fetch(
      `http://127.0.0.1:${boot.port}/api/context-map${query === "" ? "" : `?${query}`}`,
      { headers: { authorization: `Bearer ${boot.token}` } },
    );
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
    res = await fetch(`http://127.0.0.1:${boot.port}/api/history/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${boot.token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = HistorySessionDetailResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}
