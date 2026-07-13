import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";
import { pino } from "pino";
import {
  ChatStartPayloadSchema,
  DAEMON_HOST,
  MemoryPutRequestSchema,
  PROTOCOL_VERSION,
  createMessage,
  parseMessage,
  type ErrorPayload,
  type GpuSample,
  type ModelInfo,
  type ProviderHealth,
  type ReportResponse,
  type RequestPayload,
  type Snapshot,
  type Usage,
} from "@symphony/shared";
import { ensureSymphonyHome } from "../config/paths.js";
import { loadConfig } from "../config/config.js";
import { createSecretStore } from "../secrets/secret-store.js";
import { AnthropicAdapter } from "../providers/anthropic.js";
import { GoogleAdapter } from "../providers/google.js";
import { OllamaAdapter } from "../providers/ollama.js";
import { OpenAIAdapter } from "../providers/openai.js";
import type { ProviderAdapter } from "../providers/types.js";
import { DataStore } from "../db/store.js";
import { detectVramGb, sampleGpus } from "../router/hardware.js";
import { suggestModels } from "../router/router.js";
import {
  classifyFeedbackRows,
  computeRouterStats,
  STATS_WINDOW_DAYS,
  type RouterStats,
} from "../router/stats.js";
import { buildReport } from "../report/build.js";
import { decideWeeklyReport, formatReportMarkdown } from "../report/markdown.js";
import { bekciErrorCode, readBekciRegistry } from "../bekci/registry.js";
import { findMatches, shouldRecordBekciMatch } from "../bekci/scan.js";
import { buildContextMap } from "../context-map/build.js";
import {
  checkCurationTarget,
  checkGraphReference,
  checkGroupTarget,
  checkPinRef,
  type MapNodeLookupFn,
  type MapRefExistsFn,
} from "../context-map/curation.js";
import { DoctorPipeline } from "../doctor/pipeline.js";
import { AgentEngine } from "../agent/engine.js";
import { ensureDefaultAgent, listAgentDefinitions } from "../agent/definition.js";
import { registerMcpServer } from "../agent/mcp.js";
import { parseRoadmap } from "../roadmap/parse.js";
import {
  ensureProfileScaffold,
  formatProfileContext,
  loadProfile,
  readProfileSnapshot,
  writeProfile,
} from "../memory/profile.js";
import { EventBus } from "./bus.js";
import { DeltaBatcher } from "./delta-batcher.js";
import { generateDaemonToken, loadExistingToken, persistDaemonToken } from "./token.js";

// ADR-017 (Faz 7, Dilim F1): sürüm tek kaynağı package.json — hardcode edilmez. Self-referans
// (`@symphony/core/package.json`) `exports` haritasındaki `./package.json` girdisiyle çalışır.
const require = createRequire(import.meta.url);
export const DAEMON_VERSION: string = (
  require("@symphony/core/package.json") as { version: string }
).version;

export interface DaemonOptions {
  /** Test/geliştirme: 0 verilirse boş bir port seçilir. */
  port?: number;
  /** Test: `~/.symphony` yerine kullanılacak dizin. */
  home?: string;
  /** Test: sahte Ollama sunucusuna yönlendirme. Varsayılan: http://127.0.0.1:11434 */
  ollamaBaseUrl?: string;
  /** YALNIZ test: gerçek adapter'ların yerine geçer (agent motoru senaryoları için). */
  testProviders?: ProviderAdapter[];
  /**
   * GPU vital örneklemesi (`hardware.updated`). Testlerde kapatılır: gerçek nvidia-smi
   * çağrısı + periyodik yayın, olay dizisi bekleyen testleri bozar. Varsayılan: true.
   */
  sampleHardware?: boolean;
  /**
   * Haftalık kendini geliştirme raporu (yoksa yaz) + günlük tekrarlayan-hata uyarısı
   * (ADR-018 Karar 5/6, Faz 8 Dilim D5). Testlerde kapatılır: gerçek dosya yazımı + 24
   * saatlik zamanlayıcı, olay dizisi bekleyen testleri bozar. Varsayılan: true.
   */
  scheduleReports?: boolean;
  /**
   * Bekçi log izleme (ADR-018 Karar 7, Faz 8 Dilim D6): kayıtlı proje log dosyalarını poll'lar.
   * Testlerde kapatılır (gerçek dosya izleme + zamanlayıcı). Varsayılan: true.
   */
  watchBekci?: boolean;
  /** Test: poll aralığı (ms). Varsayılan: 10.000 — testte kısaltılır (bekçi.test.ts'in canlı ucu). */
  bekciPollMs?: number;
}

export interface RunningDaemon {
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const paths = ensureSymphonyHome(options.home);
  const config = loadConfig(paths);
  const port = options.port ?? config.daemon.port;

  // Tek-kopya kilidi (2026-07-03 dersi): çalışan bir symphonyd varken ikinci
  // kopya, token dosyasına DOKUNMADAN burada durdurulur. (port 0 = test/ephemeral,
  // çakışamaz.) Sondanın yakalayamadığı yabancı süreçlerde EADDRINUSE yine erken
  // fırlar — token dinleme başarılı olana dek yazılmadığı için dosya güvendedir.
  if (port !== 0) {
    const running = await probeRunningDaemon(port);
    if (running !== null) {
      throw makeError(
        "DAEMON_ALREADY_RUNNING",
        `Port ${port}'de zaten bir symphonyd çalışıyor (v${running.daemonVersion}). ` +
          "İkinci kopya başlatılmadı; mevcut daemon'ı kullan veya önce onu durdur.",
      );
    }
  }

  // Diskteki geçerli token'ı yeniden kullan (daemon restart'ında istemciler kopmasın); yoksa üret.
  const token = loadExistingToken(paths.daemonTokenFile) ?? generateDaemonToken();
  const log = pino({ name: "symphonyd" });

  const secrets = await createSecretStore();
  const store = new DataStore(paths.databaseFile);
  // SPEC-AGENT §4: önceki ömürden yarım kalan koşular failed(AGENT_DAEMON_RESTART).
  const interrupted = store.markInterruptedAgentRuns();
  if (interrupted > 0) log.warn({ interrupted }, "yarım kalmış agent koşuları failed işaretlendi");
  ensureDefaultAgent(paths.agentsDir);
  // ADR-013: dosya yoksa yalnız boş iskelet (başlıklar) yazılır — gerçek içerik hep kullanıcıdan.
  ensureProfileScaffold(paths.profileFile);

  /** Taze okur (µs-ölçek, cache gereksiz); `memory.enabled=false` acil kapatma anahtarıdır. */
  const loadMemoryProfile = (): string | null => {
    if (!config.memory.enabled) return null;
    const loaded = loadProfile(paths.profileFile);
    if (loaded === null) return null;
    if (loaded.truncated) {
      log.warn({ file: paths.profileFile }, "kullanıcı profili MAX_PROFILE_CHARS'ı aştı, kesildi");
    }
    return loaded.text;
  };

  const providers = new Map<string, ProviderAdapter>();
  for (const adapter of options.testProviders ?? [
    new AnthropicAdapter(secrets),
    new OpenAIAdapter(secrets),
    new GoogleAdapter(secrets),
    new OllamaAdapter(options.ollamaBaseUrl),
  ]) {
    providers.set(adapter.name, adapter);
  }

  const bus = new EventBus();
  const activeChats = new Map<string, AbortController>();
  // rapor §5.1: chat.delta de agent.delta ile aynı desende toplu yayınlanır (anahtar = sessionId).
  const chatDeltaBatcher = new DeltaBatcher((sessionId, text) =>
    bus.broadcast("chat.delta", { sessionId, text }),
  );

  // Yerel GPU vitalleri (TASARIM §2): periyodik örneklenir, hardware.updated ile TÜM istemcilere
  // yayınlanır; yeni bağlanan istemciye son örnek anında gönderilir. Snapshot GPU taşımaz —
  // bu canlı telemetri, geçmiş değil. GPU yoksa (nvidia-smi başarısız) hiç yayınlanmaz.
  const HARDWARE_POLL_MS = 2000;
  let latestHardware: { gpus: GpuSample[]; sampledAt: number } | null = null;
  let hardwareTimer: NodeJS.Timeout | null = null;
  if (options.sampleHardware ?? true) {
    const pollHardware = async (): Promise<void> => {
      const gpus = await sampleGpus();
      latestHardware = { gpus, sampledAt: Date.now() };
      if (gpus.length > 0) bus.broadcast("hardware.updated", latestHardware);
    };
    void pollHardware();
    // unref: yalnız GPU örneklemek için süreç ayakta tutulmaz (kapanışı geciktirmez).
    hardwareTimer = setInterval(() => void pollHardware(), HARDWARE_POLL_MS);
    hardwareTimer.unref();
  }

  // VRAM bir kez tespit edilir (alt süreç maliyeti); ilk router.suggest'te tembel başlar.
  let vramProbe: Promise<number | null> | null = null;
  const getVramGb = (): Promise<number | null> => (vramProbe ??= detectVramGb());

  /** Router yalnız KULLANILABİLİR sağlayıcıların modellerini görür. */
  async function availableModels(): Promise<ModelInfo[]> {
    const lists = await Promise.all(
      [...providers.values()].map(async (provider) =>
        (await provider.isConfigured()) ? provider.listModels() : [],
      ),
    );
    return lists.flat();
  }

  /**
   * Router v2 (ADR-016 Karar 1/2/4): mevcut tablolardan sorgu-zamanı skor agregasyonu — fiziksel
   * skor tablosu yok. `router.suggest` işleyicisi VE `pickModel` (agent motoru) AYNI fonksiyonu
   * çağırır ki iki yol aynı kanıta göre aynı kararı versin (SPEC §1 "boşsa router seçer" ilkesiyle
   * tutarlılık). Rolling window — üst sınır YOK (her zaman "şimdi"ye kadar); rapor (Z3) kendi
   * `[from,to]` aralığı için AYNI `computeRouterStats`'ı ayrı çağırır (ikinci gerçek üretilmez).
   */
  function buildRouterStats(): RouterStats {
    const sinceMs = Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const feedback = classifyFeedbackRows(store.feedbackSince(sinceMs));
    return computeRouterStats(store.runsSince(sinceMs), store.turnStatsSince(sinceMs), feedback);
  }

  async function providerStatuses(): Promise<ProviderHealth[]> {
    const statuses: ProviderHealth[] = [];
    for (const provider of providers.values()) {
      statuses.push({
        provider: provider.name,
        status: (await provider.isConfigured()) ? "up" : "down",
      });
    }
    return statuses;
  }

  const engine = new AgentEngine({
    providers,
    bus,
    store,
    log,
    agentsDir: paths.agentsDir,
    permissionsFile: paths.permissionsFile,
    mcpServersFile: paths.mcpServersFile,
    // "boşsa router seçer" (SPEC-AGENT §1): ilk öneri kullanılır.
    pickModel: async (task) => {
      const [models, vramGb] = await Promise.all([availableModels(), getVramGb()]);
      const suggestions = suggestModels(task, undefined, { models, vramGb, stats: buildRouterStats() });
      const first = suggestions[0];
      return first === undefined ? null : { provider: first.provider, model: first.model };
    },
    loadMemoryProfile,
    maxOutputTokens: config.limits.maxOutputTokens,
  });

  /**
   * Kendini geliştirme (ADR-018, Faz 8 Dilim D2). Motorun TAMAMINI değil yalnız `startRun`
   * yüzeyini görür — boru hattı normal bir agent koşusu başlatır (doktor bir agent TANIMIDIR,
   * ayrıcalıklı bir mod değil): izin kapısı, jail ve durum makinesi aynen geçerlidir.
   */
  const doctor = new DoctorPipeline({
    store,
    bus,
    log,
    startRun: (input) => engine.start(input),
    selfDev: config.selfDev,
    bekciFile: paths.bekciFile,
  });

  /**
   * REST `/api/report` İLE zamanlanmış haftalık yazım (aşağıda) AYNI mantığı kullanır — "ikinci
   * gerçek üretilmez" (Z3'ün kendi ilkesi). `patches` ADR-018 Karar 5/6 (Dilim D5): sicil
   * kümülatiftir, `[from,to]`ile SINIRLANMAZ; `doctor.diagnose()` şu anki adayları verir.
   */
  function buildWeeklyReport(from: number, to: number): ReportResponse {
    const routerStats = computeRouterStats(
      store.runsSince(from, to),
      store.turnStatsSince(from, to),
      classifyFeedbackRows(store.feedbackSince(from, to)),
    );
    // Agent tanım-güncelleme önerisi (ADR-018 Karar 8, Dilim D7): rapor [from,to]'u DEĞİL,
    // router v2 ile AYNI rolling-window (STATS_WINDOW_DAYS) kullanılır — agent koşuları seyrek
    // olabilir, kısa bir rapor penceresi yeterli kanıt biriktiremez. Yalnız PİNSİZ (model boş)
    // tanımlar aday olur — pinli agent için alternatif önerisi TAHMİN olurdu (Karar 8).
    const agentStatsSinceMs = Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const unpinnedAgentIds = listAgentDefinitions(paths.agentsDir)
      .filter((d) => d.model === undefined)
      .map((d) => d.id);
    return buildReport({
      from,
      to,
      usageByModel: store.usageQuery({ from, to, groupBy: "model" }),
      usageByDay: store.usageQuery({ from, to, groupBy: "day" }),
      routerStats,
      topErrors: store.topErrorCodesSince(from, to),
      feedback: store.feedbackSummarySince(from, to),
      patches: { recurring: doctor.diagnose(), entries: store.listPatches() },
      agents: { unpinnedAgentIds, usage: store.agentModelUsageSince(agentStatsSinceMs) },
    });
  }

  const REPORT_CHECK_MS = 24 * 60 * 60 * 1000;
  const REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  /** Bu haftanın rapor dosyası yoksa üretir + yazar (ADR-018 Karar 5/6, Dilim D5). */
  function ensureWeeklyReportWritten(): void {
    const now = Date.now();
    const decision = decideWeeklyReport(paths.reportsDir, now, existsSync);
    if (!decision.shouldWrite) return;
    const report = buildWeeklyReport(now - REPORT_WINDOW_MS, now);
    writeFileSync(decision.path, formatReportMarkdown(report), "utf8");
    log.info({ file: decision.path }, "haftalık kendini geliştirme raporu otomatik üretildi");
  }

  /** Günlük tekrarlayan-hata taraması (ADR-018 Karar 5) — LLM'e sorulmaz, deterministik eşik. */
  function runDailyDetection(): void {
    for (const candidate of doctor.diagnose()) {
      bus.broadcast("log.entry", {
        level: "warn",
        source: "doctor",
        message: `tekrarlayan hata: ${candidate.code} (${candidate.count} kez) — \`symphony doctor\` çalıştır`,
      });
    }
  }

  let reportTimer: NodeJS.Timeout | null = null;
  if (options.scheduleReports ?? true) {
    ensureWeeklyReportWritten();
    runDailyDetection();
    // unref: yalnız rapor/tespit zamanlaması için süreç ayakta tutulmaz (kapanışı geciktirmez).
    reportTimer = setInterval(() => {
      ensureWeeklyReportWritten();
      runDailyDetection();
    }, REPORT_CHECK_MS);
    reportTimer.unref();
  }

  /**
   * Bekçi log izleme (ADR-018 Karar 7, Faz 8 Dilim D6): kayıtlı proje log dosyalarını poll'lar.
   * Ofset + debounce zaman damgası BELLEKTE tutulur (daemon yeniden başlarsa sıfırlanır — kabul
   * edilir, en kötü ihtimalle bir sonraki restart'ta aynı hata bir kez daha yakalanır).
   * Registry HER poll'da YENİDEN okunur — daemon yeniden başlatmadan `bekci ekle` görünür olur.
   */
  interface BekciPollState {
    offset: number;
    lastRecordedAt: Record<string, number>;
  }
  const bekciState = new Map<string, BekciPollState>();

  /**
   * Hata yutma sınırları (2026-07-11 mimari tarama bulgusu B1): bu fonksiyon `setInterval`
   * içinde çağrılır — yakalanmayan bir istisna `uncaughtException`'a, o da DAEMON'UN
   * ÇÖKMESİNE yol açar. `readBekciRegistry` artık bozuk JSON'da fırlamıyor (B3) ama başka
   * G/Ç hataları (izin, disk) hâlâ mümkün; kayıt defteri okuma AYRI, her PROJE'nin kendi
   * log G/Ç'si AYRI try/catch'e alınır — bir projenin (silinen/kilitli log dosyası gibi)
   * hatası ne daemon'ı ne diğer projelerin izlenmesini etkiler.
   */
  function pollBekci(): void {
    let registry: ReturnType<typeof readBekciRegistry>;
    try {
      registry = readBekciRegistry(paths.bekciFile);
    } catch (error) {
      log.warn({ err: error }, "bekçi kayıt defteri okunamadı (bu tur atlandı)");
      return;
    }
    const seen = new Set<string>();
    for (const project of registry.projeler) {
      seen.add(project.ad);
      try {
        if (!existsSync(project.logFile)) continue;
        const stat = statSync(project.logFile);
        let state = bekciState.get(project.ad);
        if (state === undefined) {
          // İLK GÖRÜŞ: var olan içeriği ATLA — her restart'ta geçmiş hataları yeniden yakalamayız.
          state = { offset: stat.size, lastRecordedAt: {} };
          bekciState.set(project.ad, state);
          continue;
        }
        if (stat.size < state.offset) state.offset = 0; // log döndürülmüş (rotate) — baştan izle
        if (stat.size === state.offset) continue; // yeni içerik yok

        const length = stat.size - state.offset;
        const buffer = Buffer.alloc(length);
        const fd = openSync(project.logFile, "r");
        try {
          readSync(fd, buffer, 0, length, state.offset);
        } finally {
          closeSync(fd);
        }
        state.offset = stat.size;

        const newLines = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.length > 0);
        const excerpts = findMatches(newLines);
        if (excerpts.length === 0) continue;

        const code = bekciErrorCode(project.ad);
        const now = Date.now();
        if (!shouldRecordBekciMatch(state.lastRecordedAt[code] ?? null, now)) continue;
        state.lastRecordedAt[code] = now;

        store.recordTelemetry({
          scope: "bekci",
          code,
          message: excerpts[excerpts.length - 1] ?? "",
          context: { proje: project.ad, logFile: project.logFile },
        });
        bus.broadcast("log.entry", {
          level: "warn",
          source: `bekci:${project.ad}`,
          message: `'${project.ad}' log'unda hata deseni yakalandı — \`symphony doctor --proje ${project.ad}\` çalıştır`,
        });
      } catch (error) {
        log.warn({ err: error, proje: project.ad }, "bekçi log izleme hatası (bu proje bu tur atlandı)");
      }
    }
    // Kayıttan silinen projelerin ofsetini biriktirmeyiz (bellek sızıntısı olmaz, sayı zaten küçük).
    for (const ad of bekciState.keys()) {
      if (!seen.has(ad)) bekciState.delete(ad);
    }
  }

  let bekciTimer: NodeJS.Timeout | null = null;
  if (options.watchBekci ?? true) {
    pollBekci();
    bekciTimer = setInterval(pollBekci, options.bekciPollMs ?? 10_000);
    bekciTimer.unref();
  }

  async function buildSnapshot(): Promise<Snapshot> {
    return {
      runs: engine.activeRuns(),
      providers: await providerStatuses(),
      pendingPermissions: engine.pendingPermissions(),
    };
  }

  /**
   * WS ve REST'in ortak sohbet yolu: delta'lar TÜM istemcilere yayınlanır.
   * Her istek — başarı, hata, iptal — `requests` tablosuna kayıt düşer;
   * gerçek hatalar (iptal değil) ayrıca telemetriye yazılır (ROADMAP Faz 1).
   */
  async function runChat(
    payload: RequestPayload<"chat.start">,
    sessionId: string,
    onDelta?: (text: string) => void,
  ): Promise<Usage> {
    const startedAt = Date.now();
    const abort = new AbortController();
    activeChats.set(sessionId, abort);
    try {
      const provider = providers.get(payload.provider);
      if (!provider) {
        throw makeError("PROVIDER_UNKNOWN", `Bilinmeyen sağlayıcı: ${payload.provider}`);
      }
      // ADR-013: profil `instructions` ile taşınır (AI SDK v7 `messages` içinde system KABUL
      // ETMEZ — engine.ts'teki agent yoluyla aynı desen). `payload.messages` DEĞİŞMEZ; aşağıda
      // `saveChatTurn`'a giden de budur (kalıcı geçmişe profil asla girmez).
      const profile = loadMemoryProfile();
      const stream = provider.streamChat({
        model: payload.model,
        messages: payload.messages,
        temperature: payload.options.temperature,
        // Kaçak üretim sigortası (canlı bulgu #1): istemci bir tavan vermezse config'inki
        // uygulanır — sohbet de agent turları gibi SONLANMASI garanti bir üst sınıra sahiptir.
        maxTokens: payload.options.maxTokens ?? config.limits.maxOutputTokens,
        ...(profile !== null ? { instructions: formatProfileContext(profile) } : {}),
        abortSignal: abort.signal,
      });
      let usageResult;
      let answer = "";
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          usageResult = next.value;
          break;
        }
        answer += next.value;
        // rapor §5.1: WS broadcast'i chunk başına DEĞİL, kısa bir pencerede toplu yapar.
        chatDeltaBatcher.push(sessionId, next.value);
        onDelta?.(next.value);
      }
      // Tur bitti — kalanı chat.completed'DAN ÖNCE yayınla (istemcide sıra bozulmasın, rapor §5.1).
      chatDeltaBatcher.flush(sessionId);
      const usage: Usage = {
        inputTokens: usageResult.inputTokens,
        outputTokens: usageResult.outputTokens,
        costUsd: usageResult.costUsd,
      };
      store.recordRequest({
        id: randomUUID(),
        sessionId,
        provider: payload.provider,
        model: payload.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        usage,
        status: "ok",
      });
      // Sohbet geçmişi (PROTOKOL §3): yalnız başarılı tur oturumu günceller.
      store.saveChatTurn({
        sessionId,
        provider: payload.provider,
        model: payload.model,
        messages: payload.messages,
        assistantText: answer,
      });
      bus.broadcast("chat.completed", { sessionId, usage });
      bus.broadcast("usage.updated", {
        provider: payload.provider,
        model: payload.model,
        deltaTokens: usage.inputTokens + usage.outputTokens,
        deltaCostUsd: usage.costUsd,
        totals: store.usageTotals(payload.provider, payload.model),
        ...(usageResult.cacheReadTokens !== undefined
          ? { cacheReadTokens: usageResult.cacheReadTokens }
          : {}),
        ...(usageResult.cacheCreationTokens !== undefined
          ? { cacheCreationTokens: usageResult.cacheCreationTokens }
          : {}),
      });
      if (usageResult.limits !== undefined) {
        bus.broadcast("provider.limits", {
          provider: payload.provider,
          ...usageResult.limits,
          at: Date.now(),
        });
      }
      log.info({ sessionId, model: payload.model, ...usage }, "sohbet tamamlandı");
      return usage;
    } catch (error) {
      // Güvenlik ağı: hata/iptal döngüyü erken kesmiş olabilir (normal yoldaki explicit flush
      // hiç çalışmamıştır) — kalıntı kaybolmasın (rapor §5.1/§5.4, agent.delta ile aynı desen).
      chatDeltaBatcher.flush(sessionId);
      const cancelled = abort.signal.aborted;
      const errorPayload = toErrorPayload(error);
      store.recordRequest({
        id: randomUUID(),
        sessionId,
        provider: payload.provider,
        model: payload.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        status: cancelled ? "cancelled" : "error",
        errorCode: errorPayload.code,
      });
      if (!cancelled) {
        store.recordTelemetry({
          scope: "chat",
          code: errorPayload.code,
          message: errorPayload.message,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
          // Girdi ÖZETİ — ham mesaj içeriği asla yazılmaz (SPEC-AGENT §7).
          context: {
            provider: payload.provider,
            model: payload.model,
            sessionId,
            messageCount: payload.messages.length,
          },
        });
      }
      throw error;
    } finally {
      activeChats.delete(sessionId);
    }
  }

  // ---- REST ----

  const app = Fastify({ logger: false });

  // CORS (2026-07-10 bulgusu — Dilim Z5): ui webview'i (vite dev origin'i / Tauri'nin kendi
  // origin'i) `fetch()`'le REST'e Bearer header'ıyla istek atınca tarayıcı bir preflight (OPTIONS)
  // gönderir; bu eklenti OLMADAN AUTH hook'u preflight'ı 401'ler (preflight token TAŞIMAZ) VE
  // normal cevapta `Access-Control-Allow-Origin` yoksa tarayıcı cevabı zaten OKUMAZ. Sonuç:
  // WS akan her şey çalışıyordu ama `fetchRoadmap`/`fetchContextMap` gibi REST-tabanlı istekler
  // sessizce (roadmap) ya da görünür biçimde (bağlam haritası "daemon'a bağlantı yok") kırıktı.
  // `origin: true` bilinçli: gerçek güven sınırı zaten 256-bit token (yalnız Tauri/dev-token
  // dosyadan okur, hiçbir sayfaya sızdırılmaz) — CORS burada ek bir yetkilendirme katmanı değil,
  // yalnız aynı-uygulamanın kendi webview'inin daemon'a erişebilmesini SAĞLAR. Kayıt SIRASI
  // önemli: aşağıdaki Bearer-auth hook'undan ÖNCE olmalı ki preflight ona hiç varmadan cevaplansın.
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type"],
  });

  app.get("/api/health", async () => ({
    ok: true,
    daemonVersion: DAEMON_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }));

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/api/health") return;
    if (request.headers.authorization !== `Bearer ${token}`) {
      await reply
        .code(401)
        .send({ code: "AUTH_TOKEN_INVALID", message: "Geçersiz veya eksik daemon token'ı" });
    }
  });

  // curl ile kabul testi için SSE ucu: data: {"type":"delta"|"completed"|"error", ...}
  app.post("/api/chat", async (request, reply) => {
    const parsed = ChatStartPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({
        code: "VALIDATION_PAYLOAD",
        message: "chat.start şemasına uymuyor",
        details: { issues: parsed.error.issues },
      });
      return;
    }
    const sessionId = parsed.data.sessionId ?? randomUUID();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "session", sessionId });
    try {
      const usage = await runChat(parsed.data, sessionId, (text) => send({ type: "delta", text }));
      send({ type: "completed", usage });
    } catch (error) {
      send({ type: "error", ...toErrorPayload(error) });
    }
    reply.raw.end();
  });

  // Sohbet geçmişi REST ile sorgulanır (PROTOKOL §1.1) — olay replay'i yok (ADR-011).
  app.get("/api/history/sessions", async (request) => {
    const rawLimit = Number((request.query as { limit?: string }).limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 50;
    return { sessions: store.listSessions(limit) };
  });

  app.get("/api/history/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = store.sessionDetail(id);
    if (detail === null) {
      return reply.code(404).send({
        code: "VALIDATION_SESSION_NOT_FOUND",
        message: `Oturum bulunamadı: ${id}`,
      });
    }
    return detail;
  });

  // Kullanıcı profili (ADR-013, Dilim M2). Agent araç yüzeyinde bu uca giden yol
  // YOKTUR — yalnız insan arayüzü (CLI/masaüstü) çağırır.
  app.get("/api/memory", async () => readProfileSnapshot(paths.profileFile));

  app.put("/api/memory", async (request, reply) => {
    const parsed = MemoryPutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "VALIDATION_PAYLOAD",
        message: "memory.put şemasına uymuyor",
        details: { issues: parsed.error.issues },
      });
    }
    return writeProfile(paths.profileFile, parsed.data.content);
  });

  // Yol haritası (ADR-015 Karar 3, Dilim P2). İstemci (masaüstü webview) dosya sistemine
  // erişemediği için dizini query'de gönderir, daemon okuyup ayrıştırır.
  app.get("/api/roadmap", async (request, reply) => {
    const { dir } = request.query as { dir?: string };
    if (dir === undefined || dir.length === 0) {
      return reply.code(400).send({
        code: "VALIDATION_ROADMAP_DIR_REQUIRED",
        message: "dir sorgu parametresi zorunludur",
      });
    }
    const file = join(dir, "ROADMAP.md");
    if (!existsSync(file)) {
      return reply.code(404).send({
        code: "VALIDATION_ROADMAP_NOT_FOUND",
        message: `ROADMAP.md bulunamadı: ${file}`,
      });
    }
    return { phases: parseRoadmap(readFileSync(file, "utf8")) };
  });

  // Kullanım raporu (ADR-016 Karar 5, Dilim Z3): deterministik agregasyon, LLM YOK. `from`/`to`
  // verilmezse son 7 gün. model×görev-türü tablosu router v2 (Z1) ile AYNI computeRouterStats'ı
  // AYRI bir [from,to] aralığıyla çağırır — ikinci gerçek üretilmez.
  app.get("/api/report", async (request, reply) => {
    const query = request.query as { from?: string; to?: string };
    const to = query.to !== undefined ? Number(query.to) : Date.now();
    const from = query.from !== undefined ? Number(query.from) : to - 7 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
      return reply.code(400).send({
        code: "VALIDATION_REPORT_RANGE_INVALID",
        message: "from/to epoch ms olmalı ve from <= to sağlanmalı",
      });
    }
    return buildWeeklyReport(from, to);
  });

  // Bağlam haritası (ADR-016 Karar 6, Dilim Z4 + ADR-019 Karar 2/3/4, Dilim H2): mevcut
  // sessions/agent_runs'ın deterministik grafı + kalıcı kürasyon bindirmesi + haftalık katlanma
  // — embedding YOK, hiçbir provider çağrısı yapmaz. `limit`: sessions+runs biriminden en-yeni N
  // (vars./tavan 500) — `/api/history/sessions`'la AYNI clamp deseni. `week`/`flat`: Karar 4.
  app.get("/api/context-map", async (request) => {
    const query = request.query as { limit?: string; week?: string; flat?: string };
    const rawLimit = Number(query.limit ?? 500);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 500;
    const runs = store.recentAgentRuns(limit).map((row) => ({
      id: row.id,
      cwd: row.cwd,
      task: row.task,
      provider: row.provider,
      model: row.model,
      agentId: row.agent_id,
      at: row.started_at,
    }));
    const sessions = store.listSessions(limit).map((s) => ({
      id: s.sessionId,
      title: s.title,
      provider: s.provider,
      model: s.model,
      at: s.updatedAt,
    }));
    return buildContextMap({
      runs,
      sessions,
      limit,
      mapNodes: store.listMapNodes(),
      mapEdges: store.listMapEdges(),
      week: query.week,
      flat: query.flat === "1",
    });
  });

  // Otomatik güncelleme/rollback (ADR-017 Karar 4, Dilim F5): daemon'ı TEMİZ kapatır. Cevap
  // GÖNDERİLDİKTEN SONRA `close()` çağrılır — aksi hâlde `app.close()` bağlantıyı bu isteği
  // flush etmeden keser, istemci (symphony update/rollback) cevabı hiç görmez. `close` aşağıda
  // TANIMLIDIR (return'de) — closure JS'te bu SIRA sorunu yaratmaz (handler ancak gerçek bir
  // istekte ÇALIŞIR, o zamana dek `close` çoktan atanmış olur).
  app.post("/api/shutdown", async (request, reply) => {
    await reply.send({ ok: true });
    void close();
  });

  // ---- Bağlam Haritası kürasyonu (ADR-019 Karar 1/2, Faz "H" Dilim H1) ----
  // `context-map/curation.ts`in dar enjeksiyon yüzeyleri — SAF doğrulama fonksiyonları bu
  // closure'ları alır, testte sahtelenirler (bkz. curation.test.ts).
  const mapNodeLookup: MapNodeLookupFn = (id) => {
    const node = store.mapNodeById(id);
    return node === null ? null : { kind: node.kind };
  };
  const mapRefExists: MapRefExistsFn = (kind, id) =>
    kind === "session" ? store.sessionDetail(id) !== null : store.agentRunExists(id);

  // ---- WebSocket ----

  const wss = new WebSocketServer({ noServer: true });

  app.server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws: WebSocket) => {
    let authed = false;
    /** hello.client — permission.resolved.resolvedBy bu bilgiyle doldurulur. */
    let clientKind: "cli" | "desktop" | "web" = "cli";
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4001, "hello zaman aşımı");
    }, 3000);

    const sendError = (error: ErrorPayload, replyTo: string | null = null): void => {
      ws.send(JSON.stringify(createMessage("error", error, replyTo)));
    };

    ws.on("close", () => {
      clearTimeout(helloTimer);
      bus.remove(ws);
    });

    ws.on("message", (raw) => {
      void (async () => {
        let input: unknown;
        try {
          input = JSON.parse(String(raw));
        } catch {
          sendError({ code: "VALIDATION_ENVELOPE", message: "Geçersiz JSON" });
          return;
        }
        const result = parseMessage(input);
        if (!result.ok) {
          sendError(result.error);
          return;
        }
        const message = result.message;

        if (!authed) {
          if (message.type !== "hello") {
            sendError({ code: "AUTH_HELLO_REQUIRED", message: "İlk mesaj hello olmalı" });
            ws.close(4002, "hello bekleniyor");
            return;
          }
          const hello = message.payload as RequestPayload<"hello">;
          if (hello.token !== token) {
            sendError({ code: "AUTH_TOKEN_INVALID", message: "Geçersiz token" }, message.id);
            ws.close(4003, "kimlik doğrulanamadı");
            return;
          }
          if (hello.protocolVersion !== PROTOCOL_VERSION) {
            sendError(
              {
                code: "AUTH_PROTOCOL_MISMATCH",
                message: `Daemon protokol v${PROTOCOL_VERSION}, istemci v${hello.protocolVersion} — istemciyi güncelle`,
              },
              message.id,
            );
            ws.close(4004, "protokol uyuşmazlığı");
            return;
          }
          authed = true;
          clientKind = hello.client;
          clearTimeout(helloTimer);
          bus.add(ws);
          bus.sendTo(
            ws,
            "hello.ok",
            {
              daemonVersion: DAEMON_VERSION,
              protocolVersion: PROTOCOL_VERSION,
              snapshot: await buildSnapshot(),
            },
            message.id,
          );
          // Son GPU örneğini anında ver (bir sonraki periyodik tik'i beklemesin).
          if (latestHardware !== null && latestHardware.gpus.length > 0) {
            bus.sendTo(ws, "hardware.updated", latestHardware);
          }
          return;
        }

        switch (message.type) {
          case "state.sync": {
            bus.sendTo(ws, "state.sync.ok", { snapshot: await buildSnapshot() }, message.id);
            return;
          }
          case "chat.start": {
            const payload = message.payload as RequestPayload<"chat.start">;
            const sessionId = payload.sessionId ?? randomUUID();
            bus.sendTo(ws, "chat.start.ok", { sessionId }, message.id);
            runChat(payload, sessionId).catch((error: unknown) => {
              sendError(toErrorPayload(error), message.id);
            });
            return;
          }
          case "chat.cancel": {
            const payload = message.payload as RequestPayload<"chat.cancel">;
            activeChats.get(payload.sessionId)?.abort();
            bus.sendTo(ws, "chat.cancel.ok", {}, message.id);
            return;
          }
          case "models.list": {
            const lists = await Promise.all([...providers.values()].map((p) => p.listModels()));
            bus.sendTo(ws, "models.list.ok", { models: lists.flat() }, message.id);
            return;
          }
          case "agents.list": {
            bus.sendTo(ws, "agents.list.ok", { agents: engine.listAgents() }, message.id);
            return;
          }
          case "agent.start": {
            const payload = message.payload as RequestPayload<"agent.start">;
            try {
              const { runId, sessionId } = await engine.start(payload);
              bus.sendTo(ws, "agent.start.ok", { runId, sessionId }, message.id);
            } catch (error) {
              // Beklenen doğrulama hataları (AGENT_UNKNOWN, PERMISSION_JAIL...) —
              // telemetriye değil, isteği yapana gider.
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "agent.cancel": {
            const payload = message.payload as RequestPayload<"agent.cancel">;
            try {
              engine.cancel(payload.runId);
              bus.sendTo(ws, "agent.cancel.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "patches.list": {
            // `diff` BİLİNÇLE dışarıda — büyük olabilir; liste yüzeyinde taşınmaz.
            const patches = store.listPatches().map(({ diff: _diff, ...summary }) => summary);
            bus.sendTo(ws, "patches.list.ok", { patches }, message.id);
            return;
          }
          case "patch.resolve": {
            // Daemon yalnız SONUCU yazar — merge/build/test/restart/geri-alma zinciri CLI'de
            // (ADR-018 Karar 3: daemon kendi bacağını kesemez).
            const payload = message.payload as RequestPayload<"patch.resolve">;
            if (store.patchById(payload.patchId) === null) {
              sendError(
                {
                  code: "VALIDATION_PATCH_UNKNOWN",
                  message: `Bilinmeyen yama id'si: ${payload.patchId}`,
                },
                message.id,
              );
              return;
            }
            store.resolvePatch(payload.patchId, payload.state);
            bus.sendTo(ws, "patch.resolve.ok", {}, message.id);
            return;
          }
          case "map.pin": {
            // "Bunu haritaya ekleyelim" anı (ADR-019 Karar 1/2): ref verilirse başlığı ref'ten
            // türet (session başlığı / koşu görevi); ref'siz çağrıda şema title'ı zaten zorunlu kılmıştı.
            const payload = message.payload as RequestPayload<"map.pin">;
            const refCheck = checkPinRef(payload.ref, mapRefExists);
            if (!refCheck.ok) {
              sendError(
                { code: refCheck.code, message: `Bilinmeyen referans: ${payload.ref?.kind} ${payload.ref?.id}` },
                message.id,
              );
              return;
            }
            const ref = payload.ref;
            const title =
              payload.title ??
              (ref?.kind === "session"
                ? (store.sessionDetail(ref.id)?.session.title ?? "")
                : ref !== undefined
                  ? (store.agentRunById(ref.id)?.task ?? "")
                  : "");
            const nodeId = randomUUID();
            store.insertMapNode({
              id: nodeId,
              kind: "context",
              title,
              createdAt: Date.now(),
              refKind: ref?.kind ?? null,
              refId: ref?.id ?? null,
            });
            bus.sendTo(ws, "map.pin.ok", { nodeId }, message.id);
            return;
          }
          case "map.node.rename": {
            const payload = message.payload as RequestPayload<"map.node.rename">;
            const check = checkCurationTarget(payload.nodeId, mapNodeLookup, mapRefExists);
            if (!check.ok) {
              sendError(
                { code: check.code, message: `Kürasyon düğümü değil: ${payload.nodeId}` },
                message.id,
              );
              return;
            }
            store.renameMapNode(payload.nodeId, payload.title);
            bus.sendTo(ws, "map.node.rename.ok", {}, message.id);
            return;
          }
          case "map.node.delete": {
            const payload = message.payload as RequestPayload<"map.node.delete">;
            const check = checkCurationTarget(payload.nodeId, mapNodeLookup, mapRefExists);
            if (!check.ok) {
              sendError(
                { code: check.code, message: `Kürasyon düğümü değil: ${payload.nodeId}` },
                message.id,
              );
              return;
            }
            // Kenar kaskadı store.deleteMapNode İÇİNDE (transaction) — türetilmiş düğümler
            // buraya hiç ulaşamaz (checkCurationTarget PROTECTED ile yukarıda eledi).
            store.deleteMapNode(payload.nodeId);
            bus.sendTo(ws, "map.node.delete.ok", {}, message.id);
            return;
          }
          case "map.group.create": {
            const payload = message.payload as RequestPayload<"map.group.create">;
            for (const memberId of payload.members) {
              const check = checkGraphReference(memberId, mapNodeLookup, mapRefExists);
              if (!check.ok) {
                sendError({ code: check.code, message: `Bilinmeyen düğüm: ${memberId}` }, message.id);
                return;
              }
            }
            const nodeId = randomUUID();
            const now = Date.now();
            store.insertMapNode({
              id: nodeId,
              kind: "group",
              title: payload.title,
              createdAt: now,
              refKind: null,
              refId: null,
            });
            for (const memberId of payload.members) {
              store.insertMapEdge({ id: randomUUID(), fromId: memberId, toId: nodeId, kind: "member", createdAt: now });
            }
            bus.sendTo(ws, "map.group.create.ok", { nodeId }, message.id);
            return;
          }
          case "map.member.add": {
            const payload = message.payload as RequestPayload<"map.member.add">;
            const groupCheck = checkGroupTarget(payload.groupId, mapNodeLookup);
            if (!groupCheck.ok) {
              sendError({ code: groupCheck.code, message: `Grup değil: ${payload.groupId}` }, message.id);
              return;
            }
            const nodeCheck = checkGraphReference(payload.nodeId, mapNodeLookup, mapRefExists);
            if (!nodeCheck.ok) {
              sendError({ code: nodeCheck.code, message: `Bilinmeyen düğüm: ${payload.nodeId}` }, message.id);
              return;
            }
            // Tekrar eklemek çoğaltmaz (D4'ün withTrust deseniyle AYNI idempotentlik).
            const alreadyMember = store
              .listMapEdges()
              .some((e) => e.kind === "member" && e.fromId === payload.nodeId && e.toId === payload.groupId);
            if (!alreadyMember) {
              store.insertMapEdge({
                id: randomUUID(),
                fromId: payload.nodeId,
                toId: payload.groupId,
                kind: "member",
                createdAt: Date.now(),
              });
            }
            bus.sendTo(ws, "map.member.add.ok", {}, message.id);
            return;
          }
          case "map.member.remove": {
            // Koparma HER ZAMAN güvenlidir (D4'ün untrust deseni) — eşleşme yoksa no-op.
            const payload = message.payload as RequestPayload<"map.member.remove">;
            store.deleteMapEdgeBetween(payload.nodeId, payload.groupId, "member");
            bus.sendTo(ws, "map.member.remove.ok", {}, message.id);
            return;
          }
          case "map.link.add": {
            const payload = message.payload as RequestPayload<"map.link.add">;
            const fromCheck = checkGraphReference(payload.from, mapNodeLookup, mapRefExists);
            if (!fromCheck.ok) {
              sendError({ code: fromCheck.code, message: `Bilinmeyen düğüm: ${payload.from}` }, message.id);
              return;
            }
            const toCheck = checkGraphReference(payload.to, mapNodeLookup, mapRefExists);
            if (!toCheck.ok) {
              sendError({ code: toCheck.code, message: `Bilinmeyen düğüm: ${payload.to}` }, message.id);
              return;
            }
            const alreadyLinked = store
              .listMapEdges()
              .some((e) => e.kind === "link" && e.fromId === payload.from && e.toId === payload.to);
            if (!alreadyLinked) {
              store.insertMapEdge({
                id: randomUUID(),
                fromId: payload.from,
                toId: payload.to,
                kind: "link",
                createdAt: Date.now(),
              });
            }
            bus.sendTo(ws, "map.link.add.ok", {}, message.id);
            return;
          }
          case "map.link.remove": {
            const payload = message.payload as RequestPayload<"map.link.remove">;
            store.deleteMapEdgeBetween(payload.from, payload.to, "link");
            bus.sendTo(ws, "map.link.remove.ok", {}, message.id);
            return;
          }
          case "doctor.diagnose": {
            // Deterministik (ADR-018 Karar 1) — LLM'e "hangi hata önemli" sorulmaz.
            bus.sendTo(ws, "doctor.diagnose.ok", { candidates: doctor.diagnose() }, message.id);
            return;
          }
          case "doctor.run": {
            const payload = message.payload as RequestPayload<"doctor.run">;
            try {
              // Yalnız DOĞRULAMA'yı bekler (repo/kod/meşguliyet); boru hattının kendisi arka
              // planda ilerler — worktree + pnpm install tek başına WS zaman aşımını (30sn) aşar.
              // `proje` (Dilim D6): bekçi projesi modu — `errorCode` YOK SAYILIR, kod daemon'ca
              // türetilir (istemci yanlış ad-alanı üretemez).
              if (payload.proje !== undefined) {
                await doctor.runForProject(payload.proje);
              } else {
                if (payload.errorCode === undefined) {
                  throw makeError(
                    "VALIDATION_DOCTOR_ERRORCODE_REQUIRED",
                    "proje verilmiyorsa errorCode zorunludur",
                  );
                }
                await doctor.run(payload.errorCode);
              }
              bus.sendTo(ws, "doctor.run.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "agent.say": {
            // Konuşmalı koşunun sonraki turu (ADR-012) — motor awaiting_user dışında reddeder.
            const payload = message.payload as RequestPayload<"agent.say">;
            try {
              engine.say(payload);
              bus.sendTo(ws, "agent.say.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "permission.respond": {
            const payload = message.payload as RequestPayload<"permission.respond">;
            try {
              engine.respond(payload, clientKind);
              bus.sendTo(ws, "permission.respond.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "providers.status": {
            bus.sendTo(
              ws,
              "providers.status.ok",
              { providers: await providerStatuses() },
              message.id,
            );
            return;
          }
          case "usage.query": {
            const payload = message.payload as RequestPayload<"usage.query">;
            bus.sendTo(ws, "usage.query.ok", store.usageQuery(payload), message.id);
            return;
          }
          case "router.suggest": {
            const payload = message.payload as RequestPayload<"router.suggest">;
            const [models, vramGb] = await Promise.all([availableModels(), getVramGb()]);
            const suggestions = suggestModels(payload.task, payload.constraints, {
              models,
              vramGb,
              stats: buildRouterStats(),
            });
            if (suggestions.length === 0) {
              sendError(
                {
                  code: "PROVIDER_NONE_AVAILABLE",
                  message:
                    "Önerilecek model yok: hiçbir sağlayıcı yapılandırılmamış/erişilebilir değil " +
                    "ya da bütçe sınırı tüm seçenekleri eledi",
                },
                message.id,
              );
              return;
            }
            bus.sendTo(ws, "router.suggest.ok", { suggestions }, message.id);
            return;
          }
          case "mcp.addServer": {
            const payload = message.payload as RequestPayload<"mcp.addServer">;
            try {
              const tools = await registerMcpServer(paths.mcpServersFile, payload.name, {
                command: payload.command,
                args: payload.args,
              });
              bus.sendTo(ws, "mcp.addServer.ok", { name: payload.name, tools }, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "feedback.submit": {
            const payload = message.payload as RequestPayload<"feedback.submit">;
            const exists =
              payload.subject === "run"
                ? store.agentRunExists(payload.id)
                : store.sessionDetail(payload.id) !== null;
            if (!exists) {
              sendError(
                {
                  code: "VALIDATION_FEEDBACK_SUBJECT_UNKNOWN",
                  message: `Bilinmeyen ${payload.subject === "run" ? "koşu" : "oturum"} id'si: ${payload.id}`,
                },
                message.id,
              );
              return;
            }
            store.recordFeedback({
              subjectKind: payload.subject,
              subjectId: payload.id,
              verdict: payload.verdict,
              ...(payload.note !== undefined ? { note: payload.note } : {}),
            });
            bus.sendTo(ws, "feedback.submit.ok", {}, message.id);
            return;
          }
          default: {
            sendError(
              {
                code: "VALIDATION_NOT_IMPLEMENTED",
                message: `'${message.type}' bu fazda desteklenmiyor (bkz. ROADMAP.md)`,
              },
              message.id,
            );
          }
        }
      })().catch((error: unknown) => {
        // Buraya düşen her şey beklenmeyen daemon hatasıdır → telemetriye yaz.
        // (runChat kendi hatasını zaten kaydediyor; o yol buradan geçmez.)
        const errorPayload = toErrorPayload(error);
        store.recordTelemetry({
          scope: "ws.message",
          code: errorPayload.code,
          message: errorPayload.message,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
        });
        sendError(errorPayload);
      });
    });
  });

  await app.listen({ port, host: DAEMON_HOST });
  // Token dosyası ancak dinleme BAŞARILI olunca yazılır (tek-kopya kilidinin ikinci yarısı).
  persistDaemonToken(paths.daemonTokenFile, token);
  const address = app.server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  log.info({ port: boundPort, protocolVersion: PROTOCOL_VERSION }, "symphonyd dinliyor");

  const close = async (): Promise<void> => {
    if (hardwareTimer !== null) clearInterval(hardwareTimer);
    if (reportTimer !== null) clearInterval(reportTimer);
    if (bekciTimer !== null) clearInterval(bekciTimer);
    engine.cancelAll();
    for (const abort of activeChats.values()) abort.abort();
    // Açık istemci soketleri koparılmazsa app.close() sonsuza dek bekleyebilir.
    for (const client of wss.clients) client.terminate();
    wss.close();
    await app.close();
    store.close();
  };

  return { port: boundPort, token, close };
}

function makeError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

/** Portta çalışan bir symphonyd var mı? Sağlık ucu authsuz olduğu için sondalanabilir. */
async function probeRunningDaemon(port: number): Promise<{ daemonVersion: string } | null> {
  try {
    const response = await fetch(`http://${DAEMON_HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; daemonVersion?: string };
    return body.ok === true ? { daemonVersion: body.daemonVersion ?? "?" } : null;
  } catch {
    return null;
  }
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    const code = /^(AUTH|PROVIDER|AGENT|PERMISSION|VALIDATION|INTERNAL)_[A-Z0-9_]+$/.test(
      error.name,
    )
      ? error.name
      : error.message.startsWith("PROVIDER_NOT_CONFIGURED")
        ? "PROVIDER_NOT_CONFIGURED"
        : "INTERNAL_ERROR";
    return { code, message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: String(error) };
}
