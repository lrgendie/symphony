import { randomUUID } from "node:crypto";
import { generateText, tool as defineTool, type ModelMessage } from "ai";
import type { Logger } from "pino";
import {
  canTransition,
  ERROR_CODE_PATTERN,
  type ActiveRun,
  type AgentRunState,
  type AgentSummary,
  type PendingPermission,
  type RequestPayload,
  type RiskClass,
  type Usage,
} from "@symphony/shared";
import type { DataStore } from "../db/store.js";
import { computeCostUsd } from "../providers/pricing.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { EventBus } from "../server/bus.js";
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
  type AgentToolSpec,
  type ToolContext,
  type ToolPreview,
} from "./tools.js";

/**
 * Agent koşu motoru (SPEC-AGENT.md §4-§6): model → araç çağrısı → izin kapısı →
 * çalıştır → sonuç → model döngüsü. Araç çalıştırmanın TEK kapısı buradaki izin
 * denetimidir (SPEC §8.1) — araçların kendisi izin bilmez, daemon yalnız bu
 * motora delege eder.
 */

type PermissionDecision = "allow" | "deny" | "always_allow";
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
  abort: AbortController;
  pending: PendingPermissionInternal | null;
  startedAt: number;
}

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

export class AgentEngine {
  private readonly runs = new Map<string, ActiveRunRecord>();

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
    }));
  }

  pendingPermissions(): PendingPermission[] {
    return [...this.runs.values()].flatMap((run) =>
      run.pending !== null ? [run.pending.info] : [],
    );
  }

  async start(payload: RequestPayload<"agent.start">): Promise<{ runId: string }> {
    const definition = loadAgentDefinition(this.deps.agentsDir, payload.agentId);
    // SPEC §3: extraDirs agent.start'ta İNSANIN açıkça verdiği dizinlerdir —
    // istekte yer almaları açık onaydır; jail bunları köklere ekler.
    const jail = new WorkspaceJail(payload.cwd, payload.extraDirs ?? []);

    const provider = payload.provider ?? definition.provider;
    const model = payload.model ?? definition.model;
    let resolved: { provider: string; model: string };
    if (provider !== undefined && model !== undefined) {
      resolved = { provider, model };
    } else if (provider === undefined && model === undefined) {
      const picked = await this.deps.pickModel(payload.task);
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
      task: payload.task,
      provider: resolved.provider,
      model: resolved.model,
      cwd: jail.cwd,
      state: "queued",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      abort: new AbortController(),
      pending: null,
      startedAt: Date.now(),
    };
    this.runs.set(run.runId, run);
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
    });

    void this.runLoop(run, definition, adapter, jail).catch((error: unknown) => {
      // runLoop kendi hatalarını işler; buraya düşen motorun kendi kusurudur.
      this.deps.log.error({ runId: run.runId, err: error }, "agent motoru beklenmeyen hata");
      this.finish(run, "failed", {
        code: "INTERNAL_AGENT_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { runId: run.runId };
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new AgentError("AGENT_UNKNOWN_RUN", `Aktif koşu bulunamadı: ${runId}`);
    }
    run.abort.abort();
  }

  /** Daemon kapanışı: koşan her şey iptal edilir (araç süreçleri cancelSignal ile ölür). */
  cancelAll(): void {
    for (const run of this.runs.values()) run.abort.abort();
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
      // MCP istemcisi (ADR-007, SPEC-AGENT §2): koşu başında bağlan, finally'de kapat —
      // hata olursa (AGENT_MCP_*) aşağıdaki catch tarafından normal akışla işlenir.
      mcpConnections = await connectMcpServers(this.deps.mcpServersFile, definition.mcpServers);
      const specs = [
        ...definition.tools.map((name) => AGENT_TOOLS[name]),
        ...mcpConnections.flatMap((connection) => connection.tools),
      ];
      const sdkTools = Object.fromEntries(
        specs.map((spec) => [
          spec.name,
          defineTool({ description: spec.description, inputSchema: spec.inputSchema }),
        ]),
      );
      const languageModel = await adapter.languageModel(run.model);
      // AI SDK v7: system mesajı messages içinde YASAK — instructions seçeneğiyle verilir.
      const instructions = buildSystemPrompt(definition, jail);
      const messages: ModelMessage[] = [{ role: "user", content: run.task }];

      for (;;) {
        this.transition(run, "thinking");
        const turnStartedAt = Date.now();
        const result = await generateText({
          model: languageModel,
          instructions,
          tools: sdkTools,
          messages,
          abortSignal: run.abort.signal,
          // ADR-008: temperature yalnız kabul eden sağlayıcılara iletilir (chat ile aynı kural).
          ...(adapter.forwardsTemperature ? { temperature: definition.temperature } : {}),
        });
        this.recordTurnUsage(run, result.usage, turnStartedAt);
        messages.push(...result.response.messages);

        const calls = result.toolCalls as unknown as RawToolCall[];
        if (calls.length === 0) {
          this.finish(run, "completed", { result: result.text });
          return;
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

    const ruleDecision = permissions.decide(spec.name, target, riskClass);
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
    if (run.usage.inputTokens + run.usage.outputTokens > 0) {
      this.deps.bus.broadcast("usage.updated", {
        provider: run.provider,
        model: run.model,
        deltaTokens: run.usage.inputTokens + run.usage.outputTokens,
        deltaCostUsd: run.usage.costUsd,
        totals: this.deps.store.usageTotals(run.provider, run.model),
      });
    }
  }

  /** Her model turu requests tablosuna düşer — router v2 ve kullanım raporlarının hammaddesi. */
  private recordTurnUsage(
    run: ActiveRunRecord,
    usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined,
    startedAt: number,
  ): void {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const costUsd = computeCostUsd(run.model, inputTokens, outputTokens);
    run.usage = {
      inputTokens: run.usage.inputTokens + inputTokens,
      outputTokens: run.usage.outputTokens + outputTokens,
      costUsd: run.usage.costUsd + costUsd,
    };
    this.deps.store.recordRequest({
      id: randomUUID(),
      sessionId: run.runId,
      provider: run.provider,
      model: run.model,
      startedAt,
      durationMs: Date.now() - startedAt,
      usage: { inputTokens, outputTokens, costUsd },
      status: "ok",
    });
  }
}

function buildSystemPrompt(definition: AgentDefinition, jail: WorkspaceJail): string {
  return (
    `${definition.systemPrompt}\n\n` +
    `Çalışma dizini: ${jail.cwd}\n` +
    "Yalnız bu dizin ağacında çalışabilirsin; dışına çıkma girişimleri reddedilir.\n" +
    "Görev bittiğinde son cevabını araç çağrısı OLMADAN, kısa bir özet olarak yaz."
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
