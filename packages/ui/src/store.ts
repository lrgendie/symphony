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
// rapor §5.2: pano bir önizleme yüzeyidir, tam döküm değil — uzun cevaplarda sınırsız büyümesin.
const MAX_RUN_STREAM_CHARS = 2000;
let logSeq = 0;

/** Faz 4 "hangi dosya" zengin görünümü: yalnız dosya-dokunan araçlar için önizleme tutulur. */
const FILE_TOOLS = new Set(["read_file", "write_file", "edit"]);

/** Koşu satırının altında kalıcı gösterilen dosya önizlemesi (izin kartı kapansa da kaybolmaz). */
export interface RunFilePreview {
  tool: string;
  /** started/requested anındaki argüman özeti (ör. "read_file a.txt") — başlık olarak gösterilir. */
  summary: string;
  /** write_file/edit: izin isteğindeki birleşik diff. read_file'da yok (izin istemez). */
  diff?: string;
  /** Araç tamamlandıktan sonra sonucun kısa önizlemesi (ör. read_file içeriği, zaten sunucu tarafında kısaltılmış/maskelenmiş). */
  result?: string;
}

interface UiState {
  status: ConnStatus;
  error: string | null;
  daemonVersion: string | null;
  providers: ProviderHealth[];
  runs: ActiveRun[];
  /** Koşu başına akışlı asistan metni (agent.delta; ADR-012). Araç başlayınca/koşu bitince temizlenir. */
  runStreams: Record<string, string>;
  /** Faz 4: koşu başına "hangi dosya" zengin önizlemesi (yalnız read_file/write_file/edit). */
  runFiles: Record<string, RunFilePreview>;
  pendingPermissions: PendingPermission[];
  /** Son hata anı (ms) — yaşayan tesseract kısa bir "kırmızı flaş" için okur (scene/mood.ts). */
  lastErrorAt: number | null;
  /**
   * Son görev sonuçlanma anı (ms; agent.run.completed / chat.completed) — yaşayan tesseract
   * converge salvosunu (tüm sinapslar merkeze ateşler, çekirdek patlar) bununla tetikler.
   */
  lastCompletedAt: number | null;
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

/**
 * Faz 5 (ADR-014): çocuk koşu satırları ekranda ebeveyninin HEMEN ALTINDA görünsün diye
 * sıralar — ham `runs` dizisi ekleniş sırasına göredir (`upsertRun` başa ekler), bu yüzden
 * bir çocuk ebeveyninden ÖNCE gelebilir. Sahipsiz çocuk (ebeveyni artık listede yoksa,
 * ör. ebeveyn bitip kaldırıldı ama olay sırası nedeniyle çocuk hâlâ görünüyorsa) kaybolmaz,
 * yalnız gruplanamayıp sona düşer.
 */
export function orderRunsForDisplay(runs: ReadonlyArray<ActiveRun>): ActiveRun[] {
  const topLevel = runs.filter((r) => r.parentRunId === undefined);
  const topLevelIds = new Set(topLevel.map((r) => r.runId));
  const ordered: ActiveRun[] = [];
  for (const parent of topLevel) {
    ordered.push(parent);
    ordered.push(...runs.filter((r) => r.parentRunId === parent.runId));
  }
  ordered.push(...runs.filter((r) => r.parentRunId !== undefined && !topLevelIds.has(r.parentRunId)));
  return ordered;
}

/** Faz 4 (ADR-015 Karar 1/2): "proje" görünümünde bir grup — kayıt defteri YOK, ad cwd'nin son bileşeni. */
export interface ProjectGroup {
  /** Gruplama anahtarı — tam cwd; hiç koşunun cwd'si yoksa "" ("diğer" grubu, teoride oluşmaz). */
  cwd: string;
  /** Görünen ad — cwd'nin basename'i (path ayracı hem `/` hem `\`). */
  name: string;
  runs: ActiveRun[];
}

/**
 * Koşuları cwd'ye göre gruplar. ÇOCUK koşular (Faz 5, `parentRunId`) İÇİN AYRI bir eşleme
 * GEREKMEZ — `run_agent` çocuğa ebeveynin cwd'sini BİREBİR devralır (ADR-014 Karar 3: "çocuk
 * jail = ebeveyn cwd birebir"), yani `r.cwd` zaten aynı gruba düşürür. Grup içi sıralama yine
 * `orderRunsForDisplay` (çocuk girintisi grup İÇİNDE korunur). Gruplar ada göre alfabetik.
 */
export function groupRunsByProject(runs: ReadonlyArray<ActiveRun>): ProjectGroup[] {
  const groups = new Map<string, ActiveRun[]>();
  for (const run of runs) {
    const cwd = run.cwd ?? "";
    const list = groups.get(cwd);
    if (list === undefined) groups.set(cwd, [run]);
    else list.push(run);
  }
  return [...groups.entries()]
    .map(([cwd, groupRuns]) => ({
      cwd,
      name: cwd === "" ? "diğer" : basename(cwd),
      runs: orderRunsForDisplay(groupRuns),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `path.basename`in bağımsız/hafif karşılığı — hem `/` hem `\` ayracını kabul eder (Win+POSIX cwd). */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
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

  const appendStream = (runId: string, text: string): void =>
    set((state) => {
      const next = ((state.runStreams[runId] ?? "") + text).slice(-MAX_RUN_STREAM_CHARS);
      return { runStreams: { ...state.runStreams, [runId]: next } };
    });

  const clearStream = (runId: string): void =>
    set((state) => {
      if (!(runId in state.runStreams)) return {};
      const next = { ...state.runStreams };
      delete next[runId];
      return { runStreams: next };
    });

  const clearRunFile = (runId: string): void =>
    set((state) => {
      if (!(runId in state.runFiles)) return {};
      const next = { ...state.runFiles };
      delete next[runId];
      return { runFiles: next };
    });

  return {
    status: "connecting",
    error: null,
    daemonVersion: null,
    providers: [],
    runs: [],
    runStreams: {},
    runFiles: {},
    pendingPermissions: [],
    lastErrorAt: null,
    lastCompletedAt: null,
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
        // Bayat akış metnini temizle — koşular snapshot'tan taze gelir, deltalar yeniden akar.
        runStreams: {},
        runFiles: {},
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
          // Faz 5 (ADR-014): parentRunId varsa bu bir şefin run_agent ile başlattığı ÇOCUK koşu.
          const p = payload as {
            runId: string;
            agentId: string;
            task: string;
            model: string;
            cwd: string;
            parentRunId?: string;
          };
          upsertRun({
            runId: p.runId,
            agentId: p.agentId,
            task: p.task,
            state: "queued",
            model: p.model,
            cwd: p.cwd,
            ...(p.parentRunId !== undefined ? { parentRunId: p.parentRunId } : {}),
          });
          pushLog(
            "info",
            p.parentRunId !== undefined
              ? `↳ [${p.agentId}] koşu başladı — ${short(p.task, 60)}`
              : `▶ agent «${p.agentId}» başladı — ${short(p.task, 60)}`,
          );
          return;
        }
        case "agent.run.state": {
          const p = payload as { runId: string; state: ActiveRun["state"] };
          patchRun(p.runId, { state: p.state });
          if (p.state === "cancelled") {
            // completed/failed'la aynı davranış (rapor §5.3) — aksi hâlde satır panoda
            // bir sonraki snapshot'a dek "zombi" kalır (görsel fark olmadan asılı durur).
            clearStream(p.runId);
            clearRunFile(p.runId);
            removeRun(p.runId);
          }
          return;
        }
        case "agent.delta": {
          // Akışlı asistan metni (ADR-012): koşu başına birikir — terminal ⇄ masaüstü parite.
          const p = payload as { runId: string; text: string };
          appendStream(p.runId, p.text);
          return;
        }
        case "agent.tool.started": {
          const p = payload as { runId: string; tool: string; argsSummary: string };
          clearStream(p.runId); // yeni tur başlıyor: önceki turun metnini temizle
          // Faz 4 "hangi dosya": requested'tan gelen diff varsa KORU (izin kartı kapanınca da
          // kaybolmasın); yoksa (ör. read_file — izin istemez) taze başlık ile başlat.
          if (FILE_TOOLS.has(p.tool)) {
            set((state) => {
              const existing = state.runFiles[p.runId];
              return {
                runFiles: {
                  ...state.runFiles,
                  [p.runId]:
                    existing?.tool === p.tool
                      ? existing
                      : { tool: p.tool, summary: p.argsSummary },
                },
              };
            });
          }
          pushLog("tool", `⚙ ${short(p.argsSummary)}`);
          return;
        }
        case "agent.tool.completed": {
          const p = payload as {
            runId: string;
            tool: string;
            ok: boolean;
            resultSummary: string;
            durationMs: number;
          };
          if (!p.ok) set({ lastErrorAt: Date.now() });
          if (FILE_TOOLS.has(p.tool)) {
            set((state) => {
              const existing = state.runFiles[p.runId];
              if (existing === undefined || existing.tool !== p.tool) return {};
              return { runFiles: { ...state.runFiles, [p.runId]: { ...existing, result: p.resultSummary } } };
            });
          }
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
          // Faz 4 "hangi dosya": write_file/edit'in diff'i İZİN KARTI KAPANSA DA kalıcı kalsın.
          if (FILE_TOOLS.has(p.tool)) {
            set((state) => ({
              runFiles: {
                ...state.runFiles,
                [p.runId]: { tool: p.tool, summary: short(JSON.stringify(p.args)), ...(p.diff !== undefined ? { diff: p.diff } : {}) },
              },
            }));
          }
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
          clearStream(p.runId);
          clearRunFile(p.runId);
          set({ lastCompletedAt: Date.now() }); // tesseract converge salvosu (dilim 8)
          pushLog("good", `✔ koşu tamamlandı — $${p.usage.costUsd.toFixed(4)}`);
          return;
        }
        case "agent.run.failed": {
          const p = payload as { runId: string; error: { code: string } };
          removeRun(p.runId);
          clearStream(p.runId);
          clearRunFile(p.runId);
          set({ lastErrorAt: Date.now() });
          pushLog("bad", `✘ koşu başarısız: ${p.error.code}`);
          return;
        }
        case "chat.completed": {
          const p = payload as { usage: { inputTokens: number; outputTokens: number; costUsd: number } };
          set({ lastCompletedAt: Date.now() });
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
