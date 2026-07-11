import { randomUUID } from "node:crypto";
import { streamText, tool as defineTool, type ModelMessage } from "ai";
import type { Logger } from "pino";
import { z } from "zod";
import {
  canTransition,
  ERROR_CODE_PATTERN,
  type ActiveRun,
  type AgentRunState,
  type AgentSummary,
  type ChatMessage,
  type PendingPermission,
  type RequestPayload,
  type RiskClass,
  type Usage,
} from "@symphony/shared";
import type { DataStore } from "../db/store.js";
import { formatProfileContext } from "../memory/profile.js";
import { computeCostUsd, type CacheTokens } from "../providers/pricing.js";
import { applyPromptCacheBreakpoints } from "./prompt-cache.js";
import { extractCacheTokens, parseRateLimits } from "../providers/telemetry.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { EventBus } from "../server/bus.js";
import { DeltaBatcher } from "../server/delta-batcher.js";
import {
  listAgentDefinitions,
  loadAgentDefinition,
  toAgentSummary,
  type AgentDefinition,
} from "./definition.js";
import { AgentError } from "./errors.js";
import { WorkspaceJail } from "./jail.js";
import { closeMcpConnections, connectMcpServers, type McpConnection } from "./mcp.js";
import { PermissionEngine } from "./permissions.js";
import {
  AGENT_TOOLS,
  maskSecrets,
  TOOL_NAMES,
  type AgentToolSpec,
  type ToolContext,
  type ToolName,
  type ToolPreview,
} from "./tools.js";

/**
 * Agent koşu motoru (SPEC-AGENT.md §4-§6): model → araç çağrısı → izin kapısı →
 * çalıştır → sonuç → model döngüsü. Araç çalıştırmanın TEK kapısı buradaki izin
 * denetimidir (SPEC §8.1) — araçların kendisi izin bilmez, daemon yalnız bu
 * motora delege eder.
 */

type PermissionDecision = "allow" | "deny" | "always_allow" | "allow_for_run";
type ClientKind = "cli" | "desktop" | "web";

export interface AgentEngineDeps {
  providers: ReadonlyMap<string, ProviderAdapter>;
  bus: EventBus;
  store: DataStore;
  log: Logger;
  agentsDir: string;
  permissionsFile: string;
  mcpServersFile: string;
  /** model/provider verilmediyse router'a sorulur ("boşsa router seçer", SPEC §1). */
  pickModel(task: string): Promise<{ provider: string; model: string } | null>;
  /** ADR-013: kullanıcı profilini taze okur (null = yok/kapalı) — agent'lar buradan YAZAMAZ. */
  loadMemoryProfile(): string | null;
  /**
   * Kaçak üretim sigortası (SPEC §4): tur başına token tavanı, `config.limits.maxOutputTokens`.
   * Agent tanımındaki `maxOutputTokens` bunu ezer. Zorunlu — sessiz varsayılan yok.
   */
  maxOutputTokens: number;
}

interface PendingPermissionInternal {
  info: PendingPermission;
  resolve(decision: PermissionDecision): void;
}

interface ActiveRunRecord {
  runId: string;
  agentId: string;
  task: string;
  provider: string;
  model: string;
  cwd: string;
  state: AgentRunState;
  steps: number;
  usage: Usage;
  /** Koşu boyunca biriken prompt-cache token'ları (usage.updated'a eklenir). */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  abort: AbortController;
  pending: PendingPermissionInternal | null;
  startedAt: number;
  /** `allow_for_run` ile onaylanan araç adları — yalnız bu koşu için, diske YAZILMAZ (SPEC §5). */
  trustedForRun: Set<string>;
  /** ADR-012: true → tur araçsız bitince completed yerine awaiting_user'a park eder. */
  conversational: boolean;
  /** awaiting_user park kapısı: agent.say gelince sonraki kullanıcı metniyle çözülür. */
  nextUser: ((text: string) => void) | null;
  /** Dilim 2.3b: konuşmanın yazıldığı oturum (istekte verilmezse üretilir). */
  sessionId: string;
  /** Resume: istekte sessionId verildiyse (o oturuma devam) — geçmiş buradan tohumlanır; yoksa null. */
  resumeFrom: string | null;
  /** Kalıcılığa giden TEMİZ transcript (yalnız user/assistant metin turları; araç mesajları HARİÇ). */
  transcript: ChatMessage[];
  /** Faz 5 (ADR-014): devreden koşunun runId'si — yalnız `run_agent` ile başlatılan çocuklarda dolu. */
  parentRunId: string | undefined;
  /** Faz 5 (ADR-014): `run_agent` ile başlattığı çocukların runId'leri (iptal kaskadı + MAX_CHILD_RUNS). */
  childRunIds: string[];
  /** Faz 5 (ADR-014): yalnız çocuk koşularda dolu — `finish()` koşu ne şekilde biterse bitsin çağırır. */
  onChildFinish: ((outcome: ChildOutcome) => void) | null;
}

/** Faz 5 (ADR-014): `run_agent` aracının beklediği çocuk-koşu sonucu. */
type ChildOutcome = { ok: true; text: string } | { ok: false; error: AgentError };

/** AI SDK v7 araç çağrısının motorun kullandığı kesiti (invalid = şemadan geçmedi). */
interface RawToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid?: boolean;
}

type ToolResultParts = Extract<ModelMessage, { role: "tool" }>["content"];

interface ToolOutcome {
  ok: boolean;
  text: string;
  errorCode: string | null;
}

/** Aynı araçta üst üste bu kadar aynı hata → koşu AGENT_TOOL_LOOP ile kapanır (SPEC §4). */
const TOOL_LOOP_LIMIT = 3;
/** Onay anında dosya bu kadar kez değişirse çağrı PERMISSION_STALE_DIFF ile düşer (SPEC §6). */
const STALE_DIFF_LIMIT = 3;
/** Faz 5 (ADR-014 Karar 4): koşu başına en çok bu kadar `run_agent` çocuğu. */
const MAX_CHILD_RUNS = 8;
/**
 * Faz 5 (ADR-014 §9): `run_agent` tek bir statik araçtan (30sn) çok daha uzun sürebilir —
 * çocuk kendi başına birden çok model turu atabilir. 2026-07-10 canlı bulgusu (küçük yerel
 * model bir turu ~15dk döngüye soktu) bu tavanın gerçek bir güvenlik ağı olduğunu gösterdi:
 * süre dolunca çocuk `cancel()` ile durdurulur, şef araç HATASI alır (koşusu düşmez).
 */
const RUN_AGENT_TIMEOUT_MS = 300_000;
/** run_agent risk sınıfı için: hedefin araç seti TAMAMEN salt-okur mu (ADR-014 Karar 3). */
const SAFE_RUN_AGENT_TOOLS = new Set<string>(["read_file", "glob", "grep"]);

const RunAgentArgsSchema = z
  .object({
    agent: z.string().min(1).describe("Devredilecek agent'ın id'si (~/.symphony/agents/<id>.md)"),
    task: z.string().min(1).describe("Alt-agent'a verilecek görev metni"),
    model: z.string().min(1).optional().describe("İsteğe bağlı: modeli pinle (provider ile birlikte)"),
    provider: z.string().min(1).optional().describe("İsteğe bağlı: sağlayıcıyı pinle (model ile birlikte)"),
  })
  .strip();

/** Faz 5 (ADR-014 Karar 1): `run_agent`'ın motor içi başlatma parametreleri (dış `agent.start`
 * isteğinden AYRI — `parentRunId`/`onChildFinish` yalnız engine'in kendi çağrılarında dolar,
 * hiçbir wire mesajından gelemez). */
interface StartParams {
  agentId: string;
  task: string;
  cwd: string;
  extraDirs?: string[] | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  conversational?: boolean | undefined;
  sessionId?: string | undefined;
  parentRunId?: string | undefined;
  onChildFinish?: ((outcome: ChildOutcome) => void) | undefined;
}

export class AgentEngine {
  private readonly runs = new Map<string, ActiveRunRecord>();
  // rapor §5.1: token-başına WS broadcast amplifikasyonunu azaltır (anahtar = runId).
  private readonly deltaBatcher = new DeltaBatcher((runId, text) =>
    this.deps.bus.broadcast("agent.delta", { runId, text }),
  );

  constructor(private readonly deps: AgentEngineDeps) {}

  listAgents(): AgentSummary[] {
    return listAgentDefinitions(this.deps.agentsDir).map(toAgentSummary);
  }

  activeRuns(): ActiveRun[] {
    return [...this.runs.values()].map((run) => ({
      runId: run.runId,
      agentId: run.agentId,
      task: run.task,
      state: run.state,
      model: run.model,
      cwd: run.cwd,
      ...(run.parentRunId !== undefined ? { parentRunId: run.parentRunId } : {}),
    }));
  }

  pendingPermissions(): PendingPermission[] {
    return [...this.runs.values()].flatMap((run) =>
      run.pending !== null ? [run.pending.info] : [],
    );
  }

  async start(payload: RequestPayload<"agent.start">): Promise<{ runId: string; sessionId: string }> {
    return this.startInternal({
      agentId: payload.agentId,
      task: payload.task,
      cwd: payload.cwd,
      extraDirs: payload.extraDirs,
      model: payload.model,
      provider: payload.provider,
      conversational: payload.conversational,
      sessionId: payload.sessionId,
    });
  }

  /**
   * Faz 5 (ADR-014 Karar 1): `start()` (wire isteği) VE `run_agent` aracı (motor içi devretme)
   * AYNI kapıdan geçer — `parentRunId`/`onChildFinish` yalnız ikincisinde dolar, dışarıdan
   * asla verilemez (payload şemasında bu alanlar yok).
   */
  private async startInternal(
    params: StartParams,
  ): Promise<{ runId: string; sessionId: string }> {
    const definition = loadAgentDefinition(this.deps.agentsDir, params.agentId);
    // SPEC §3: extraDirs agent.start'ta İNSANIN açıkça verdiği dizinlerdir — istekte yer
    // almaları açık onaydır; jail bunları köklere ekler. Çocuk koşular extraDirs ALMAZ
    // (ADR-014 Karar 3: şef kendi hapsinden geniş bir hapis dağıtamaz).
    const jail = new WorkspaceJail(params.cwd, params.extraDirs ?? []);

    const provider = params.provider ?? definition.provider;
    const model = params.model ?? definition.model;
    let resolved: { provider: string; model: string };
    if (provider !== undefined && model !== undefined) {
      resolved = { provider, model };
    } else if (provider === undefined && model === undefined) {
      const picked = await this.deps.pickModel(params.task);
      if (picked === null) {
        throw new AgentError(
          "PROVIDER_NONE_AVAILABLE",
          "Model seçilemedi: hiçbir sağlayıcı kullanılabilir değil (agent tanımına ya da isteğe model/provider yaz)",
        );
      }
      resolved = picked;
    } else {
      throw new AgentError(
        "VALIDATION_MODEL_PAIR",
        "model ve provider birlikte verilmeli — ya da ikisini de boş bırak, router seçer",
      );
    }

    const adapter = this.deps.providers.get(resolved.provider);
    if (adapter === undefined) {
      throw new AgentError("PROVIDER_UNKNOWN", `Bilinmeyen sağlayıcı: ${resolved.provider}`);
    }
    if (!(await adapter.isConfigured())) {
      throw new AgentError(
        "PROVIDER_NOT_CONFIGURED",
        `${resolved.provider} yapılandırılmamış (anahtar/sunucu yok)`,
      );
    }

    const run: ActiveRunRecord = {
      runId: randomUUID(),
      agentId: definition.id,
      task: params.task,
      provider: resolved.provider,
      model: resolved.model,
      cwd: jail.cwd,
      state: "queued",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      abort: new AbortController(),
      pending: null,
      startedAt: Date.now(),
      trustedForRun: new Set(),
      // Faz 5 (ADR-014 Karar 4): çocuklar DAİMA tek-seferlik — run_agent bu alanı hiç geçmez.
      conversational: params.conversational ?? false,
      nextUser: null,
      // Konuşma kalıcılığı (2.3b): sessionId istekte verilirse o oturuma devam; yoksa yeni üret.
      sessionId: params.sessionId ?? randomUUID(),
      resumeFrom: params.sessionId ?? null,
      transcript: [],
      parentRunId: params.parentRunId,
      childRunIds: [],
      onChildFinish: params.onChildFinish ?? null,
    };
    this.runs.set(run.runId, run);
    if (params.parentRunId !== undefined) {
      this.runs.get(params.parentRunId)?.childRunIds.push(run.runId);
    }
    this.deps.store.createAgentRun({
      id: run.runId,
      agentId: run.agentId,
      task: run.task,
      provider: run.provider,
      model: run.model,
      cwd: run.cwd,
      startedAt: run.startedAt,
    });
    this.deps.bus.broadcast("agent.run.started", {
      runId: run.runId,
      agentId: run.agentId,
      task: run.task,
      model: run.model,
      cwd: run.cwd,
      ...(run.parentRunId !== undefined ? { parentRunId: run.parentRunId } : {}),
    });

    void this.runLoop(run, definition, adapter, jail).catch((error: unknown) => {
      // runLoop kendi hatalarını işler; buraya düşen motorun kendi kusurudur.
      this.deps.log.error({ runId: run.runId, err: error }, "agent motoru beklenmeyen hata");
      this.finish(run, "failed", {
        code: "INTERNAL_AGENT_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { runId: run.runId, sessionId: run.sessionId };
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new AgentError("AGENT_UNKNOWN_RUN", `Aktif koşu bulunamadı: ${runId}`);
    }
    // Faz 5 (ADR-014 Karar 4): ebeveyn iptali çocukları da kapsar — öksüz koşu kalmaz.
    for (const childId of run.childRunIds) {
      this.runs.get(childId)?.abort.abort();
    }
    run.abort.abort();
  }

  /** Daemon kapanışı: koşan her şey iptal edilir (araç süreçleri cancelSignal ile ölür). */
  cancelAll(): void {
    for (const run of this.runs.values()) run.abort.abort();
  }

  /**
   * Konuşmalı koşuya sonraki kullanıcı turu (ADR-012): yalnız awaiting_user'da park etmiş
   * koşu kabul eder. Metin runLoop'un bekleyen kapısına teslim edilir → thinking'e döner.
   */
  say(payload: RequestPayload<"agent.say">): void {
    const run = this.runs.get(payload.runId);
    if (run === undefined) {
      throw new AgentError("AGENT_UNKNOWN_RUN", `Aktif koşu bulunamadı: ${payload.runId}`);
    }
    if (run.state !== "awaiting_user" || run.nextUser === null) {
      throw new AgentError(
        "AGENT_NOT_AWAITING_USER",
        `Koşu kullanıcı turu beklemiyor (durum: ${run.state})`,
      );
    }
    const deliver = run.nextUser;
    run.nextUser = null;
    deliver(payload.text);
  }

  /** İlk cevap kazanır; karar tüm istemcilere permission.resolved ile duyurulur (SPEC §5). */
  respond(payload: RequestPayload<"permission.respond">, resolvedBy: ClientKind): void {
    const run = [...this.runs.values()].find(
      (candidate) => candidate.pending?.info.requestId === payload.requestId,
    );
    const pending = run?.pending ?? null;
    if (run === undefined || pending === null) {
      throw new AgentError(
        "PERMISSION_UNKNOWN_REQUEST",
        `Bekleyen izin isteği yok: ${payload.requestId} (başka istemci cevaplamış olabilir)`,
      );
    }
    run.pending = null;
    this.deps.bus.broadcast("permission.resolved", {
      requestId: payload.requestId,
      decision: payload.decision,
      resolvedBy,
    });
    pending.resolve(payload.decision);
  }

  /**
   * Faz 5 (ADR-014 §9): motor-içi dinamik araç — `AGENT_TOOLS`'ta YOK, yalnız `run.parentRunId
   * === undefined` VE tanımı listeleyen koşularda `runLoop` tarafından specs'e eklenir.
   */
  private makeRunAgentSpec(run: ActiveRunRecord): AgentToolSpec {
    return {
      name: "run_agent",
      description:
        "Başka bir agent'ı (agentId ile) bağımsız bir koşu olarak çalıştırır, kendi çalışma " +
        "dizinini (cwd) devralır ve o koşunun NİHAİ cevabını döner. model/provider verilmezse " +
        "hedefin kendi varsayılanı ya da router kullanılır.",
      inputSchema: RunAgentArgsSchema,
      timeoutMs: RUN_AGENT_TIMEOUT_MS,
      riskClass: (args) => {
        const parsed = RunAgentArgsSchema.safeParse(args);
        if (!parsed.success) return "mutating";
        try {
          const target = loadAgentDefinition(this.deps.agentsDir, parsed.data.agent);
          return isReadOnlyAgent(target) ? "safe" : "mutating";
        } catch {
          // Tanım yüklenemedi (yok/bozuk) — temkinli davran, sor (ADR-014 Karar 3).
          return "mutating";
        }
      },
      permissionTarget: (args) => {
        const parsed = RunAgentArgsSchema.safeParse(args);
        return parsed.success ? parsed.data.agent : "bilinmeyen-agent";
      },
      argsSummary: (args) => {
        const parsed = RunAgentArgsSchema.safeParse(args);
        return parsed.success
          ? `run_agent ${parsed.data.agent}: ${parsed.data.task.slice(0, 80)}`
          : "run_agent (geçersiz argüman)";
      },
      execute: async (args, _ctx, signal) => {
        const parsed = RunAgentArgsSchema.parse(args);
        if (run.childRunIds.length >= MAX_CHILD_RUNS) {
          throw new AgentError(
            "AGENT_MAX_CHILD_RUNS",
            `Koşu başına en çok ${MAX_CHILD_RUNS} alt-agent çalıştırılabilir`,
          );
        }
        let childRunId: string | null = null;
        const outcome = await new Promise<ChildOutcome>((resolve) => {
          // Zaman aşımı/ebeveyn iptali bu sinyali tetikler (executeToolCall run.abort.signal'ı
          // zaten combined signal'a katıyor) — çocuğu da durdurup öksüz koşu bırakmıyoruz.
          const onAbort = (): void => {
            if (childRunId !== null) this.cancel(childRunId);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          this.startInternal({
            agentId: parsed.agent,
            task: parsed.task,
            cwd: run.cwd,
            ...(parsed.model !== undefined ? { model: parsed.model } : {}),
            ...(parsed.provider !== undefined ? { provider: parsed.provider } : {}),
            parentRunId: run.runId,
            onChildFinish: (childOutcome) => {
              signal.removeEventListener("abort", onAbort);
              resolve(childOutcome);
            },
          })
            .then((ok) => {
              childRunId = ok.runId;
              if (signal.aborted) this.cancel(ok.runId);
            })
            .catch((error: unknown) => {
              signal.removeEventListener("abort", onAbort);
              resolve({
                ok: false,
                error:
                  error instanceof AgentError
                    ? error
                    : new AgentError(
                        "INTERNAL_AGENT_ERROR",
                        error instanceof Error ? error.message : String(error),
                      ),
              });
            });
        });
        if (!outcome.ok) throw outcome.error;
        return outcome.text;
      },
    };
  }

  // ---- Koşu ömrü ----

  private async runLoop(
    run: ActiveRunRecord,
    definition: AgentDefinition,
    adapter: ProviderAdapter,
    jail: WorkspaceJail,
  ): Promise<void> {
    const permissions = new PermissionEngine(this.deps.permissionsFile);
    const ctx: ToolContext = { jail };
    let mcpConnections: McpConnection[] = [];

    let failureKey = "";
    let failureCount = 0;
    const bumpFailure = (key: string): boolean => {
      failureCount = key === failureKey ? failureCount + 1 : 1;
      failureKey = key;
      return failureCount >= TOOL_LOOP_LIMIT;
    };

    try {
      // rapor2 §3.3: queued'dan doğrudan failed'e geçiş VALID_TRANSITIONS'ta YOK (yalnız
      // thinking/cancelled) — MCP bağlantısı (aşağıda) queued'dayken atılabilir bir hata
      // fırlatırsa geçiş REDDEDİLİR ve agent.run.state hiç yayınlanmazdı. Loop'un kendi ilk
      // transition(thinking)'ini burada, hazırlık adımlarından ÖNCE çağırmak bunu kapatır
      // (state zaten thinking'ken loop'un tekrar çağırması no-op'tur, çifte olay YOK).
      this.transition(run, "thinking");
      // MCP istemcisi (ADR-007, SPEC-AGENT §2): koşu başında bağlan, finally'de kapat —
      // hata olursa (AGENT_MCP_*) aşağıdaki catch tarafından normal akışla işlenir.
      mcpConnections = await connectMcpServers(this.deps.mcpServersFile, definition.mcpServers);
      const staticToolNames = definition.tools.filter((name): name is ToolName =>
        (TOOL_NAMES as readonly string[]).includes(name),
      );
      const specs = [
        ...staticToolNames.map((name) => AGENT_TOOLS[name]),
        ...mcpConnections.flatMap((connection) => connection.tools),
        // Faz 5 (ADR-014 Karar 1+4): yalnız listesinde run_agent OLAN VE kendisi bir çocuk
        // OLMAYAN (derinlik-1 sigortası) koşu bu aracı alır — çocuğa asla verilmez.
        ...(run.parentRunId === undefined && definition.tools.includes("run_agent")
          ? [this.makeRunAgentSpec(run)]
          : []),
      ];
      const sdkTools = Object.fromEntries(
        specs.map((spec) => [
          spec.name,
          defineTool({ description: spec.description, inputSchema: spec.inputSchema }),
        ]),
      );
      const languageModel = await adapter.languageModel(run.model);
      // AI SDK v7: system mesajı messages içinde YASAK — instructions seçeneğiyle verilir.
      // Canlı bulgu (2026-07-10): "damitici" (M3, arşiv damıtma) profil enjeksiyonundan
      // BİLİNÇLİ OLARAK MUAF — amacı arşivi TEMİZ okumaktır; mevcut profil enjekte edilirse
      // taslak, arşivden gelen yeni bilgiyle ZATEN bilinen profili ayırt edilemez şekilde
      // karıştırır (canlı testte gözlemlendi: taslakta arşivde hiç geçmeyen, yalnız mevcut
      // profildeki ifadeler çıktı).
      const memoryProfile = definition.id === "damitici" ? null : this.deps.loadMemoryProfile();
      const instructions = buildSystemPrompt(definition, jail, memoryProfile);
      // Resume (2.3b): sessionId istekte verildiyse önceki user/assistant metinlerini bağlama
      // tohumla. Yalnız metin turları (system daemon'ın talimatıdır; araç mesajları geçmişte yok).
      const seeded: ChatMessage[] =
        run.resumeFrom !== null
          ? (this.deps.store
              .sessionDetail(run.resumeFrom)
              ?.messages.filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: m.content })) ?? [])
          : [];
      run.transcript = [...seeded, { role: "user", content: run.task }];
      // rapor2 §3.2: görev metni model turu başlamadan HEMEN kalıcılaşır — ilk tur ölürse
      // (maxSteps, sağlayıcı hatası) bile kullanıcının görevi/resume bağlamı DB'de kaybolmaz.
      if (run.conversational) this.persistConversation(run);
      // transcript yalnız user/assistant taşır; her elemanı somut rol literaliyle ModelMessage'a çevir.
      const messages: ModelMessage[] = run.transcript.map((m): ModelMessage =>
        m.role === "assistant"
          ? { role: "assistant", content: m.content }
          : { role: "user", content: m.content },
      );

      // Kaçak üretim sigortası (SPEC §4): agent tanımı > config. Koşu boyunca sabit.
      const maxOutputTokens = definition.maxOutputTokens ?? this.deps.maxOutputTokens;

      for (;;) {
        this.transition(run, "thinking");
        const turnStartedAt = Date.now();
        // D2.5: prompt cache breakpoint'leri (SAF yardımcı, testli) — agent döngüsü her turda TÜM
        // konuşmayı yeniden gönderir; cache olmadan uzun koşular karesel maliyet üretir (canlı
        // ölçüm: bir doktor koşusu 4.28M girdi token / $13.08). Diğer sağlayıcılar bu ad-alanlı
        // alanı sessizce yok sayar.
        applyPromptCacheBreakpoints(messages);
        // streamText SENKRON döner (await YOK); vaatler akış tüketilince çözülür (ADR-012).
        const result = streamText({
          model: languageModel,
          instructions,
          tools: sdkTools,
          messages,
          abortSignal: run.abort.signal,
          maxOutputTokens,
          // ADR-008: temperature yalnız kabul eden sağlayıcılara iletilir (chat ile aynı kural).
          ...(adapter.forwardsTemperature ? { temperature: definition.temperature } : {}),
        });
        // Asistan metnini token-token yayınla (agent.delta) — sohbet UX'inin temeli.
        // rapor §5.1: WS broadcast'i chunk başına DEĞİL, kısa bir pencerede toplu yapar.
        for await (const chunk of result.textStream) {
          this.deltaBatcher.push(run.runId, chunk);
        }
        // Tur bitti (ya da sağlayıcı hatasıyla erken kesildi) — kalanı HEMEN yayınla, akan
        // metin kaybolmasın (rapor §5.4).
        this.deltaBatcher.flush(run.runId);
        const response = await result.response;
        // rapor §5.4 bulgusu (ai@7.0.11'de bir izole script'le DOĞRULANDI — kaynak okuması
        // yanıltıcıydı): stream ORTASINDA sağlayıcı hatası `result.response`/`result.usage`
        // promise'lerini REDDETMEZ; SDK bunu `finishReason:"error"` ile "normal" tamamlanmış
        // gibi döner. Kontrol edilmezse motor bunu BOŞ bir "completed" sonucu sanırdı —
        // burada açıkça fırlatılıp mevcut failed yoluna (catch → agent.run.failed) yönlendirilir.
        const finishReason = await result.finishReason;
        if (finishReason === "error") {
          throw new AgentError(
            "PROVIDER_STREAM_ERROR",
            "Sağlayıcı akışı hata ile bitti (finishReason: error) — model turu tamamlanamadı",
          );
        }
        // D2.5: cache token'ları maliyete girer — AI SDK'nın `inputTokens`'ı cache okumasını TAM
        // sayıyla içerir ama Anthropic onu %10'a fiyatlar; ham sayıyla çarpmak kendi defterimizi
        // 10 kat şişirirdi. AYNI ölçüm aşağıda `usage.updated`ın önbellek sayaçlarını da besler
        // (tek `extractCacheTokens` çağrısı — ikinci gerçek üretilmez).
        const turnCache = extractCacheTokens(await result.providerMetadata);
        this.recordTurnUsage(run, await result.usage, turnStartedAt, turnCache);
        // Kaçak üretim sigortası (SPEC §4, canlı bulgu #1): tavana çarpan tur YARIM'dır —
        // metni kesik, varsa araç çağrısı bozuk. Sessizce "nihai cevap" saymak, kullanıcıya
        // kesik bir yanıtı tamammış gibi göstermek olurdu. Usage'ı ÖNCE kaydediyoruz:
        // token gerçekten harcandı, maliyet defterinde görünmeli. Sonra koşuyu düşürüyoruz.
        if (finishReason === "length") {
          throw new AgentError(
            "AGENT_MAX_OUTPUT_TOKENS",
            `Kaçak üretim sigortası: model turu ${maxOutputTokens} token tavanına çarptı ` +
              `(cevap yarım kaldı). Tavanı config.json'daki limits.maxOutputTokens ya da ` +
              `agent tanımındaki maxOutputTokens ile yükseltebilirsin.`,
          );
        }
        // Telemetri: rate-limit her turda en taze; cache token'ları koşu boyunca birikir
        // (`turnCache` yukarıda maliyet için zaten ölçüldü — aynı değeri kullanırız).
        run.cacheReadTokens += turnCache.read;
        run.cacheCreationTokens += turnCache.creation;
        const limits = parseRateLimits(response.headers);
        if (limits !== null) {
          this.deps.bus.broadcast("provider.limits", {
            provider: run.provider,
            ...limits,
            at: Date.now(),
          });
        }
        messages.push(...response.messages);

        const calls = (await result.toolCalls) as unknown as RawToolCall[];
        if (calls.length === 0) {
          // Araçsız tur bitti = asistanın bu turdaki NİHAİ metni. Temiz transcript'e yaz ve
          // (konuşmalıysa) oturuma kalıcılaştır (2.3b) — araç turları geçmişe girmez.
          const finalText = await result.text;
          run.transcript.push({ role: "assistant", content: finalText });
          if (run.conversational) this.persistConversation(run);
          if (!run.conversational) {
            this.finish(run, "completed", { result: finalText });
            return;
          }
          // Konuşmalı koşu (ADR-012): finish YERİNE kullanıcıya park. Döngüden ÇIKILMAZ →
          // messages ve MCP bağlantıları canlı kalır (finally'ye inilmez; rapor §4.2 kararı:
          // v1'de turlar arasında açık tut, agent.cancel/daemon kapanışı kapatır).
          this.transition(run, "awaiting_user");
          const nextText = await this.waitForUser(run);
          run.transcript.push({ role: "user", content: nextText });
          // rapor2 §3.2: agent.say'in getirdiği kullanıcı turu, SONRAKİ asistan turu bitmeden
          // de kalıcılaşır — model turu ortasında koşu ölürse kullanıcının son mesajı kaybolmaz.
          this.persistConversation(run);
          messages.push({ role: "user", content: nextText });
          continue;
        }
        run.steps += 1;
        if (run.steps > definition.maxSteps) {
          this.finish(run, "failed", {
            code: "AGENT_MAX_STEPS",
            message: `Döngü sigortası: adım sınırı aşıldı (${definition.maxSteps})`,
          });
          return;
        }

        const parts: ToolResultParts = [];
        for (const call of calls) {
          if (run.abort.signal.aborted) {
            throw new AgentError("AGENT_CANCELLED", "Koşu iptal edildi");
          }
          const spec = specs.find((candidate) => candidate.name === call.toolName);
          if (call.invalid === true || spec === undefined) {
            // SDK, şemadan geçmeyen/bilinmeyen çağrının error tool-result'ını
            // response.messages'a KENDİSİ ekledi (çalıştırılmadı — SPEC §2).
            const summary = "VALIDATION_TOOL_ARGS: argümanlar şema doğrulamasından geçmedi";
            this.deps.bus.broadcast("agent.tool.completed", {
              runId: run.runId,
              tool: call.toolName,
              ok: false,
              resultSummary: summary,
              durationMs: 0,
            });
            this.deps.store.recordAgentStep({
              runId: run.runId,
              step: run.steps,
              tool: call.toolName,
              argsSummary: summary,
              ok: false,
              errorCode: "VALIDATION_TOOL_ARGS",
              durationMs: 0,
            });
            if (bumpFailure(`${call.toolName}:VALIDATION_TOOL_ARGS`)) {
              this.finish(run, "failed", {
                code: "AGENT_TOOL_LOOP",
                message: `${call.toolName} üst üste ${TOOL_LOOP_LIMIT} kez aynı hatayı aldı`,
              });
              return;
            }
            continue;
          }

          const outcome = await this.executeToolCall(run, spec, call, ctx, permissions);
          parts.push({
            type: "tool-result",
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            output: outcome.ok
              ? { type: "text", value: outcome.text }
              : { type: "error-text", value: outcome.text },
          });
          if (outcome.ok) {
            failureKey = "";
            failureCount = 0;
          } else if (bumpFailure(`${call.toolName}:${outcome.errorCode ?? outcome.text}`)) {
            this.finish(run, "failed", {
              code: "AGENT_TOOL_LOOP",
              message: `${call.toolName} üst üste ${TOOL_LOOP_LIMIT} kez aynı hatayı aldı`,
            });
            return;
          }
        }
        if (parts.length > 0) messages.push({ role: "tool", content: parts });
      }
    } catch (error) {
      // Güvenlik ağı: iptal/hata for-await'i erken kesmiş olabilir (normal yoldaki explicit
      // flush hiç çalışmamıştır) — terminal olaydan ÖNCE yayınla ki istemcide sıra bozulmasın.
      this.deltaBatcher.flush(run.runId);
      if (
        run.abort.signal.aborted ||
        (error instanceof AgentError && error.name === "AGENT_CANCELLED")
      ) {
        // SPEC §4: o ana dek yapılan dosya değişiklikleri GERİ ALINMAZ.
        this.finish(run, "cancelled");
        return;
      }
      this.finish(run, "failed", toErrorInfo(error));
    } finally {
      await closeMcpConnections(mcpConnections);
    }
  }

  private async executeToolCall(
    run: ActiveRunRecord,
    spec: AgentToolSpec,
    call: RawToolCall,
    ctx: ToolContext,
    permissions: PermissionEngine,
  ): Promise<ToolOutcome> {
    const summary = maskSecrets(spec.argsSummary(call.input));

    let target: string;
    let riskClass: RiskClass;
    let preview: ToolPreview | undefined;
    try {
      target = spec.permissionTarget(call.input, ctx);
      riskClass = spec.riskClass(call.input);
      preview = spec.preview?.(call.input, ctx);
    } catch (error) {
      // PERMISSION_JAIL, AGENT_FILE_NOT_FOUND, VALIDATION_EDIT_* buraya düşer:
      // araç ÇALIŞMAZ, hata modele döner, olay loglanır (SPEC §3).
      return this.toolFailed(run, spec.name, summary, error, 0);
    }

    const fileDecision = permissions.decide(spec.name, target, riskClass);
    // Koşu-içi güven (allow_for_run, SPEC §5): permissions.json'dan BAĞIMSIZ, yalnız
    // bellekte; deny/allow dosya kuralları hep önceliklidir, destructive çağrıda geçersizdir.
    const ruleDecision =
      fileDecision === "ask" && riskClass !== "destructive" && run.trustedForRun.has(spec.name)
        ? "allow"
        : fileDecision;
    if (ruleDecision === "deny") {
      return this.toolFailed(
        run,
        spec.name,
        summary,
        new AgentError("PERMISSION_RULE_DENY", `İzin kuralı bu çağrıyı reddediyor: ${target}`),
        0,
      );
    }
    if (ruleDecision === "ask") {
      try {
        for (let attempt = 0; ; attempt++) {
          if (attempt >= STALE_DIFF_LIMIT) {
            throw new AgentError(
              "PERMISSION_STALE_DIFF",
              "Dosya onay beklerken sürekli değişti; çağrı düşürüldü",
            );
          }
          const decision = await this.requestPermission(run, spec, call, riskClass, preview);
          if (decision === "deny") {
            this.transition(run, "thinking");
            return this.toolFailed(
              run,
              spec.name,
              summary,
              new AgentError("PERMISSION_DENIED", "Kullanıcı bu araç çağrısını reddetti"),
              0,
            );
          }
          if (decision === "always_allow") {
            if (riskClass === "destructive") {
              // SPEC §5: destructive'de always_allow sunulmaz; gelirse tek seferlik izin sayılır.
              this.deps.log.warn(
                { runId: run.runId, tool: spec.name },
                "destructive araçta always_allow kalıcılaştırılmadı (tek seferlik izin)",
              );
            } else {
              permissions.addAllowRule(spec.name, target);
            }
          }
          if (decision === "allow_for_run") {
            if (riskClass === "destructive") {
              // SPEC §5: destructive'de allow_for_run de sunulmaz; gelirse tek seferlik izin sayılır.
              this.deps.log.warn(
                { runId: run.runId, tool: spec.name },
                "destructive araçta allow_for_run uygulanmadı (tek seferlik izin)",
              );
            } else {
              run.trustedForRun.add(spec.name);
            }
          }
          // Bayat diff denetimi (SPEC §6): onay anında disk değiştiyse yeni diff'le yeniden sor.
          if (preview !== undefined && spec.preview !== undefined) {
            const fresh = spec.preview(call.input, ctx);
            if (fresh.baseHash !== preview.baseHash) {
              preview = fresh;
              continue;
            }
          }
          break;
        }
      } catch (error) {
        if (error instanceof AgentError && error.name === "AGENT_CANCELLED") throw error;
        this.transition(run, "thinking");
        return this.toolFailed(run, spec.name, summary, error, 0);
      }
    }

    this.transition(run, "executing_tool");
    this.deps.bus.broadcast("agent.tool.started", {
      runId: run.runId,
      tool: spec.name,
      argsSummary: summary,
    });
    const startedAt = Date.now();
    try {
      // Zaman aşımı (SPEC §4) iptal sinyaliyle birleşir; hangisi önce gelirse.
      const signal = AbortSignal.any([run.abort.signal, AbortSignal.timeout(spec.timeoutMs)]);
      const text = await spec.execute(call.input, ctx, signal);
      const durationMs = Date.now() - startedAt;
      this.deps.bus.broadcast("agent.tool.completed", {
        runId: run.runId,
        tool: spec.name,
        ok: true,
        resultSummary: maskSecrets(text.slice(0, 200)),
        durationMs,
      });
      this.deps.store.recordAgentStep({
        runId: run.runId,
        step: run.steps,
        tool: spec.name,
        argsSummary: summary,
        ok: true,
        errorCode: null,
        durationMs,
      });
      this.transition(run, "thinking");
      return { ok: true, text, errorCode: null };
    } catch (error) {
      if (run.abort.signal.aborted) {
        throw new AgentError("AGENT_CANCELLED", "Araç çalışırken koşu iptal edildi");
      }
      const wrapped =
        error instanceof Error && error.name === "TimeoutError"
          ? new AgentError(
              "AGENT_TOOL_TIMEOUT",
              `${spec.name} ${spec.timeoutMs / 1000} sn içinde bitmedi`,
            )
          : error;
      return this.toolFailed(run, spec.name, summary, wrapped, Date.now() - startedAt);
    }
  }

  /**
   * Konuşmayı sessions/messages'a REPLACE eder (2.3b) — chat.start ile aynı kalıcılık modeli.
   * DB hatası konuşmayı ÖLDÜRMEZ: canlı koşu bellekte sürer; hata loglanır (telemetri buna bağlı).
   */
  private persistConversation(run: ActiveRunRecord): void {
    try {
      this.deps.store.saveConversation({
        sessionId: run.sessionId,
        provider: run.provider,
        model: run.model,
        messages: run.transcript,
      });
    } catch (error) {
      this.deps.log.error(
        { runId: run.runId, sessionId: run.sessionId, err: error },
        "konuşma kalıcılaştırılamadı (koşu devam ediyor)",
      );
    }
  }

  /** awaiting_user kapısı: agent.say çözer, iptal reddeder (insan turu zaman aşımına uğramaz). */
  private waitForUser(run: ActiveRunRecord): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => {
        run.nextUser = null;
        reject(new AgentError("AGENT_CANCELLED", "Kullanıcı turu beklenirken koşu iptal edildi"));
      };
      run.abort.signal.addEventListener("abort", onAbort, { once: true });
      run.nextUser = (text) => {
        run.abort.signal.removeEventListener("abort", onAbort);
        resolve(text);
      };
    });
  }

  private requestPermission(
    run: ActiveRunRecord,
    spec: AgentToolSpec,
    call: RawToolCall,
    riskClass: RiskClass,
    preview: ToolPreview | undefined,
  ): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve, reject) => {
      const requestId = randomUUID();
      const args = call.input as Record<string, unknown>;
      const onAbort = (): void => {
        run.pending = null;
        reject(new AgentError("AGENT_CANCELLED", "İzin beklenirken koşu iptal edildi"));
      };
      run.abort.signal.addEventListener("abort", onAbort, { once: true });
      run.pending = {
        info: {
          requestId,
          runId: run.runId,
          tool: spec.name,
          args,
          riskClass,
          ...(preview !== undefined ? { diff: preview.diff } : {}),
        },
        resolve: (decision) => {
          run.abort.signal.removeEventListener("abort", onAbort);
          resolve(decision);
        },
      };
      this.deps.bus.broadcast("agent.tool.requested", {
        runId: run.runId,
        requestId,
        tool: spec.name,
        args,
        riskClass,
        // Dosya değişikliğinde diff ZORUNLU (PROTOKOL §4) — preview'lı araçlar hep gönderir.
        ...(preview !== undefined ? { diff: preview.diff } : {}),
      });
      // İnsan kararı zaman aşımına uğramaz: süresiz beklenir (SPEC §5).
      this.transition(run, "awaiting_permission");
    });
  }

  private toolFailed(
    run: ActiveRunRecord,
    toolName: string,
    summary: string,
    error: unknown,
    durationMs: number,
  ): ToolOutcome {
    const code =
      error instanceof Error && ERROR_CODE_PATTERN.test(error.name)
        ? error.name
        : "INTERNAL_TOOL_ERROR";
    const message = error instanceof Error ? error.message : String(error);
    const text = `${code}: ${message}`;
    this.deps.bus.broadcast("agent.tool.completed", {
      runId: run.runId,
      tool: toolName,
      ok: false,
      resultSummary: maskSecrets(text.slice(0, 300)),
      durationMs,
    });
    this.deps.store.recordAgentStep({
      runId: run.runId,
      step: run.steps,
      tool: toolName,
      argsSummary: summary,
      ok: false,
      errorCode: code,
      durationMs,
    });
    if (run.state === "executing_tool") this.transition(run, "thinking");
    return { ok: false, text, errorCode: code };
  }

  private transition(run: ActiveRunRecord, next: AgentRunState): void {
    if (run.state === next) return;
    if (!canTransition(run.state, next)) {
      // Protokol ihlali koruması — asla olmamalı; zorla geçmek yerine logla.
      this.deps.log.error(
        { runId: run.runId, from: run.state, to: next },
        "geçersiz agent durum geçişi engellendi",
      );
      return;
    }
    run.state = next;
    this.deps.store.updateAgentRunState(run.runId, next);
    this.deps.bus.broadcast("agent.run.state", { runId: run.runId, state: next });
  }

  private finish(
    run: ActiveRunRecord,
    state: "completed" | "failed" | "cancelled",
    extra?: { result?: string; code?: string; message?: string },
  ): void {
    if (!this.runs.has(run.runId)) return; // çifte kapanış koruması
    run.pending = null;
    run.nextUser = null;
    this.transition(run, state);
    this.runs.delete(run.runId);
    this.deps.store.finishAgentRun(run.runId, {
      state,
      result: extra?.result ?? null,
      errorCode: extra?.code ?? null,
      usage: run.usage,
      steps: run.steps,
    });
    if (state === "completed") {
      this.deps.bus.broadcast("agent.run.completed", {
        runId: run.runId,
        result: extra?.result ?? "",
        usage: run.usage,
      });
    } else if (state === "failed") {
      const error = {
        code: extra?.code ?? "INTERNAL_AGENT_ERROR",
        message: extra?.message ?? "bilinmeyen hata",
      };
      this.deps.bus.broadcast("agent.run.failed", { runId: run.runId, error });
      this.deps.store.recordTelemetry({
        scope: "agent",
        code: error.code,
        message: error.message,
        // Girdi ÖZETİ — görev metni/dosya içerikleri asla (SPEC §7).
        context: {
          runId: run.runId,
          agentId: run.agentId,
          provider: run.provider,
          model: run.model,
          steps: run.steps,
        },
      });
    }
    // Faz 5 (ADR-014): yalnız çocuk koşularda dolu — devreden `run_agent` çağrısını uyandırır.
    // completed→sonuç metni; failed/cancelled→araç HATASI (şefin koşusu düşmez, SPEC §4).
    if (run.onChildFinish !== null) {
      if (state === "completed") {
        run.onChildFinish({ ok: true, text: extra?.result ?? "" });
      } else {
        const code = extra?.code ?? (state === "cancelled" ? "AGENT_CANCELLED" : "INTERNAL_AGENT_ERROR");
        const message =
          extra?.message ?? (state === "cancelled" ? "Alt-agent koşusu iptal edildi" : "bilinmeyen hata");
        run.onChildFinish({ ok: false, error: new AgentError(code, message) });
      }
    }
    if (run.usage.inputTokens + run.usage.outputTokens > 0) {
      this.deps.bus.broadcast("usage.updated", {
        provider: run.provider,
        model: run.model,
        deltaTokens: run.usage.inputTokens + run.usage.outputTokens,
        deltaCostUsd: run.usage.costUsd,
        totals: this.deps.store.usageTotals(run.provider, run.model),
        ...(run.cacheReadTokens > 0 ? { cacheReadTokens: run.cacheReadTokens } : {}),
        ...(run.cacheCreationTokens > 0 ? { cacheCreationTokens: run.cacheCreationTokens } : {}),
      });
    }
  }

  /** Her model turu requests tablosuna düşer — router v2 ve kullanım raporlarının hammaddesi. */
  private recordTurnUsage(
    run: ActiveRunRecord,
    usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
    startedAt: number,
    cache?: CacheTokens,
  ): void {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const costUsd = computeCostUsd(run.model, inputTokens, outputTokens, cache);
    run.usage = {
      inputTokens: run.usage.inputTokens + inputTokens,
      outputTokens: run.usage.outputTokens + outputTokens,
      costUsd: run.usage.costUsd + costUsd,
    };
    this.deps.store.recordRequest({
      id: randomUUID(),
      // rapor2 §3.4: run.runId DEĞİL run.sessionId — chat.start ile aynı sütun anlamını taşır
      // (oturum kimliği), böylece requests tablosu oturum-bazlı maliyet/router v2 için birleşir.
      sessionId: run.sessionId,
      provider: run.provider,
      model: run.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      usage: { inputTokens, outputTokens, costUsd },
      status: "ok",
    });
  }
}

/** run_agent risk sınıfı için: hedefin araç seti TAMAMEN salt-okur mu (ADR-014 Karar 3). */
function isReadOnlyAgent(definition: AgentDefinition): boolean {
  return (
    definition.mcpServers.length === 0 &&
    definition.tools.every((name) => SAFE_RUN_AGENT_TOOLS.has(name))
  );
}

function buildSystemPrompt(
  definition: AgentDefinition,
  jail: WorkspaceJail,
  profile: string | null,
): string {
  return (
    `${definition.systemPrompt}\n\n` +
    `Çalışma dizini: ${jail.cwd}\n` +
    "Yalnız bu dizin ağacında çalışabilirsin; dışına çıkma girişimleri reddedilir.\n" +
    "Görev bittiğinde son cevabını araç çağrısı OLMADAN, kısa bir özet olarak yaz." +
    // ADR-013: kullanıcı profili yalnız bağlam — agent'lar bu dosyayı asla yazamaz.
    (profile !== null ? `\n\n${formatProfileContext(profile)}` : "")
  );
}

function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = ERROR_CODE_PATTERN.test(error.name)
      ? error.name
      : error.message.startsWith("PROVIDER_NOT_CONFIGURED")
        ? "PROVIDER_NOT_CONFIGURED"
        : "INTERNAL_AGENT_ERROR";
    return { code, message: error.message };
  }
  return { code: "INTERNAL_AGENT_ERROR", message: String(error) };
}
