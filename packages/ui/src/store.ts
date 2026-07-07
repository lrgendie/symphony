import { create } from "zustand";
import type {
  ActiveRun,
  EventType,
  GpuSample,
  PendingPermission,
  ProviderHealth,
  ProviderLimitsPayload,
  Snapshot,
  Usage,
} from "@symphony/shared";

/**
 * WS olaylarıyla beslenen tek durum kaynağı (zustand). DaemonConnection (daemon/client.ts)
 * bu store'un action'larını çağırır; React bileşenleri selector'larla okur. Protokol
 * yalnız `@symphony/shared` tipleriyle konuşulur (CLAUDE.md kural 1).
 */

export type ConnStatus = "connecting" | "connected" | "disconnected";

export type LogTone = "info" | "tool" | "good" | "bad" | "chat" | "warn";

export interface LogItem {
  id: number;
  ts: number;
  tone: LogTone;
  text: string;
}

/** Model panosu satırı: bir modelin tüm-zaman token/maliyet kümülatifi (usage.updated.totals). */
export interface ModelUsage {
  model: string;
  /** İlk seed'de (usage.query groupBy:model) bilinmez; canlı usage.updated ile dolar. */
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const MAX_LOG = 200;
let logSeq = 0;

interface UiState {
  status: ConnStatus;
  error: string | null;
  daemonVersion: string | null;
  providers: ProviderHealth[];
  runs: ActiveRun[];
  pendingPermissions: PendingPermission[];
  /** Son hata anı (ms) — yaşayan küre kısa bir "kırmızı flaş" için okur (scene/mood.ts). */
  lastErrorAt: number | null;
  log: LogItem[];
  /** Tüm-zaman token/maliyet toplamı (bağlanınca usage.query ile seed, usage.updated ile büyür). */
  usageTotals: Usage;
  /** Model başına tüm-zaman kullanım, maliyete göre azalan sırada. */
  usageByModel: ModelUsage[];
  /** Bu bağlantı boyunca biriken token/maliyet (her applySnapshot'ta sıfırlanır). */
  sessionTokens: number;
  sessionCostUsd: number;
  /** Bu bağlantıda okunan/yazılan prompt-cache token'ları (cache isabet göstergesi). */
  sessionCacheReadTokens: number;
  sessionCacheCreationTokens: number;
  /** Sağlayıcı başına son API rate-limit görüntüsü (provider.limits). */
  limits: Record<string, ProviderLimitsPayload>;
  /** Yerel GPU vitalleri (hardware.updated). Yaşayan Küre'yi fiziksel yükle sürer. */
  gpus: GpuSample[];
  setStatus: (status: ConnStatus) => void;
  setError: (error: string | null) => void;
  applySnapshot: (snapshot: Snapshot, daemonVersion: string) => void;
  handleEvent: (type: EventType, payload: unknown) => void;
  /** İstek gönderildikten sonra iyimser kaldırma (permission.resolved zaten teyit eder). */
  removePending: (requestId: string) => void;
}

/** args özeti/uzun metinleri kısaltır (log satırı tek satır kalsın). */
function short(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

function sumUsage(items: ReadonlyArray<ModelUsage>): Usage {
  return items.reduce<Usage>(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      costUsd: acc.costUsd + m.costUsd,
    }),
    { ...EMPTY_USAGE },
  );
}

/**
 * Bir modelin girdisini yeni kümülatif toplamla (usage.updated.totals) DEĞİŞTİRİR — eklemez.
 * totals zaten deltayı içerir (daemon isteği kaydettikten sonra hesaplar), o yüzden çift sayım yok.
 * Maliyete göre azalan sıralar (en pahalı model başta).
 */
function upsertModelUsage(
  list: ReadonlyArray<ModelUsage>,
  model: string,
  provider: string | undefined,
  totals: Usage,
): ModelUsage[] {
  const rest = list.filter((m) => m.model !== model);
  return [
    ...rest,
    {
      model,
      provider,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      costUsd: totals.costUsd,
    },
  ].sort((a, b) => b.costUsd - a.costUsd);
}

export const useStore = create<UiState>((set) => {
  const pushLog = (tone: LogTone, text: string): void =>
    set((state) => ({
      log: [{ id: ++logSeq, ts: Date.now(), tone, text }, ...state.log].slice(0, MAX_LOG),
    }));

  const upsertRun = (run: ActiveRun): void =>
    set((state) => {
      const rest = state.runs.filter((r) => r.runId !== run.runId);
      return { runs: [run, ...rest] };
    });

  const patchRun = (runId: string, patch: Partial<ActiveRun>): void =>
    set((state) => ({
      runs: state.runs.map((r) => (r.runId === runId ? { ...r, ...patch } : r)),
    }));

  const removeRun = (runId: string): void =>
    set((state) => ({ runs: state.runs.filter((r) => r.runId !== runId) }));

  return {
    status: "connecting",
    error: null,
    daemonVersion: null,
    providers: [],
    runs: [],
    pendingPermissions: [],
    lastErrorAt: null,
    log: [],
    usageTotals: { ...EMPTY_USAGE },
    usageByModel: [],
    sessionTokens: 0,
    sessionCostUsd: 0,
    sessionCacheReadTokens: 0,
    sessionCacheCreationTokens: 0,
    limits: {},
    gpus: [],

    setStatus: (status) => set({ status, ...(status === "connected" ? { error: null } : {}) }),
    setError: (error) => set({ error }),
    removePending: (requestId) =>
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== requestId),
      })),

    applySnapshot: (snapshot, daemonVersion) =>
      // Yeni bağlantı = yeni oturum görünümü: canlı deltalar sıfırdan sayılır.
      // usageTotals/usageByModel'e DOKUNMAZ — bağlanınca gelen usage.query.ok onları seed'ler.
      set({
        daemonVersion,
        providers: snapshot.providers,
        runs: snapshot.runs,
        pendingPermissions: snapshot.pendingPermissions,
        sessionTokens: 0,
        sessionCostUsd: 0,
        sessionCacheReadTokens: 0,
        sessionCacheCreationTokens: 0,
        // Bayat rate-limit görüntüsünü de sıfırla (bir sonraki çağrıda tazelenir).
        limits: {},
        // Bayat GPU örneğini temizle; daemon hello sonrası son örneği hemen yeniden yollar.
        gpus: [],
      }),

    handleEvent: (type, payload) => {
      switch (type) {
        case "provider.health": {
          const p = payload as ProviderHealth;
          set((state) => ({
            providers: [...state.providers.filter((x) => x.provider !== p.provider), p].sort((a, b) =>
              a.provider.localeCompare(b.provider),
            ),
          }));
          return;
        }
        case "agent.run.started": {
          const p = payload as { runId: string; agentId: string; task: string; model: string };
          upsertRun({ runId: p.runId, agentId: p.agentId, task: p.task, state: "queued", model: p.model });
          pushLog("info", `▶ agent «${p.agentId}» başladı — ${short(p.task, 60)}`);
          return;
        }
        case "agent.run.state": {
          const p = payload as { runId: string; state: ActiveRun["state"] };
          patchRun(p.runId, { state: p.state });
          return;
        }
        case "agent.tool.started": {
          const p = payload as { tool: string; argsSummary: string };
          pushLog("tool", `⚙ ${short(p.argsSummary)}`);
          return;
        }
        case "agent.tool.completed": {
          const p = payload as { tool: string; ok: boolean; resultSummary: string; durationMs: number };
          if (!p.ok) set({ lastErrorAt: Date.now() });
          pushLog(p.ok ? "good" : "bad", `${p.ok ? "✔" : "✘"} ${p.tool} (${p.durationMs}ms) ${short(p.resultSummary, 60)}`);
          return;
        }
        case "agent.tool.requested": {
          // Olay yükü PendingPermission'la aynı alanlara sahip (runId/requestId/tool/args/riskClass/diff).
          const p = payload as PendingPermission;
          set((state) => ({
            pendingPermissions: [
              ...state.pendingPermissions.filter((x) => x.requestId !== p.requestId),
              p,
            ],
          }));
          pushLog("warn", `🔐 izin bekliyor: ${p.tool} [${p.riskClass}]`);
          return;
        }
        case "permission.resolved": {
          const p = payload as { requestId: string; decision: string; resolvedBy?: string };
          set((state) => ({
            pendingPermissions: state.pendingPermissions.filter((x) => x.requestId !== p.requestId),
          }));
          pushLog("info", `🔓 izin kararı: ${p.decision}${p.resolvedBy !== undefined ? ` (${p.resolvedBy})` : ""}`);
          return;
        }
        case "agent.run.completed": {
          const p = payload as { runId: string; usage: { costUsd: number } };
          removeRun(p.runId);
          pushLog("good", `✔ koşu tamamlandı — $${p.usage.costUsd.toFixed(4)}`);
          return;
        }
        case "agent.run.failed": {
          const p = payload as { runId: string; error: { code: string } };
          removeRun(p.runId);
          set({ lastErrorAt: Date.now() });
          pushLog("bad", `✘ koşu başarısız: ${p.error.code}`);
          return;
        }
        case "chat.completed": {
          const p = payload as { usage: { inputTokens: number; outputTokens: number; costUsd: number } };
          pushLog("chat", `💬 sohbet turu — ${p.usage.inputTokens}+${p.usage.outputTokens} token · $${p.usage.costUsd.toFixed(4)}`);
          return;
        }
        case "usage.updated": {
          // totals = o provider+model'in tüm-zaman kümülatifi; delta = bu turun artışı (SPEC).
          const p = payload as {
            provider: string;
            model: string;
            deltaTokens: number;
            deltaCostUsd: number;
            totals: Usage;
            cacheReadTokens?: number;
            cacheCreationTokens?: number;
          };
          set((state) => {
            const usageByModel = upsertModelUsage(state.usageByModel, p.model, p.provider, p.totals);
            return {
              usageByModel,
              usageTotals: sumUsage(usageByModel),
              sessionTokens: state.sessionTokens + p.deltaTokens,
              sessionCostUsd: state.sessionCostUsd + p.deltaCostUsd,
              sessionCacheReadTokens: state.sessionCacheReadTokens + (p.cacheReadTokens ?? 0),
              sessionCacheCreationTokens:
                state.sessionCacheCreationTokens + (p.cacheCreationTokens ?? 0),
            };
          });
          return;
        }
        case "provider.limits": {
          const p = payload as ProviderLimitsPayload;
          set((state) => ({ limits: { ...state.limits, [p.provider]: p } }));
          return;
        }
        case "usage.query.ok": {
          // Bağlanınca gönderilen usage.query {groupBy:"model"} cevabı — tüm-zaman dökümünü seed'ler.
          const p = payload as {
            rows: Array<{ key: string; inputTokens: number; outputTokens: number; costUsd: number }>;
            totals: Usage;
          };
          set({
            usageByModel: p.rows
              .map((r) => ({
                model: r.key,
                inputTokens: r.inputTokens,
                outputTokens: r.outputTokens,
                costUsd: r.costUsd,
              }))
              .sort((a, b) => b.costUsd - a.costUsd),
            usageTotals: p.totals,
          });
          return;
        }
        case "hardware.updated": {
          const p = payload as { gpus: GpuSample[] };
          set({ gpus: p.gpus });
          return;
        }
        default:
          // chat.delta ve diğer yüksek-frekanslı olaylar log'u boğmasın diye yok sayılır.
          return;
      }
    },
  };
});
