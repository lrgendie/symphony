import { create } from "zustand";
import type {
  ActiveRun,
  EventType,
  PendingPermission,
  ProviderHealth,
  Snapshot,
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

    setStatus: (status) => set({ status, ...(status === "connected" ? { error: null } : {}) }),
    setError: (error) => set({ error }),
    removePending: (requestId) =>
      set((state) => ({
        pendingPermissions: state.pendingPermissions.filter((p) => p.requestId !== requestId),
      })),

    applySnapshot: (snapshot, daemonVersion) =>
      set({
        daemonVersion,
        providers: snapshot.providers,
        runs: snapshot.runs,
        pendingPermissions: snapshot.pendingPermissions,
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
        default:
          // chat.delta ve diğer yüksek-frekanslı olaylar log'u boğmasın diye yok sayılır.
          return;
      }
    },
  };
});
