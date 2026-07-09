import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useRef, useState, type JSX } from "react";
import type { ModelInfo, PendingPermission, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";

interface ToolLogEntry {
  kind: "started" | "completed";
  tool: string;
  summary: string;
  ok?: boolean;
}

interface RunOutcome {
  kind: "completed" | "failed" | "cancelled";
  result?: string;
  usage?: Usage;
  errorCode?: string;
  errorMessage?: string;
}

type ModelChoice = ModelInfo | "router";

/**
 * TUI agent modu (ROADMAP Faz 3): çalışma dizini onayı → model seçimi → görev girişi →
 * agent.start → izin kutusu (tek tuş e/d/h) + renkli diff + canlı araç günlüğü →
 * sonuç/hata. `symphony agent <ad> <görev>` (cli/src/commands/agent.ts) ile AYNI
 * olaylara abone olur — yalnız sunum katmanı Ink.
 *
 * Çalışma dizini ve model ADIM OLARAK sorulur (varsayılan: bulunduğun dizin / router
 * seçimi) — sessizce "neredeysen orası" almak kullanıcıyı şaşırtabiliyor: yanlış dizinde
 * başlatılan bir koşu, agent'ın alakasız/devasa bir ağaçta (ör. ev dizini) gezinip
 * konudan sapmasına yol açabilir (2026-07-05, gerçek kullanıcı testinde görüldü).
 */
export function AgentRun(props: {
  client: DaemonClient;
  agentId: string;
  cwd: string;
  models: ModelInfo[];
  /** Koşu bitince Esc → ana menü (App mode/agent'ı sıfırlar). TUI kapanmaz. */
  onExit: () => void;
}): JSX.Element {
  const [cwd, setCwd] = useState<string | null>(null);
  const [cwdDraft, setCwdDraft] = useState(props.cwd);
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [log, setLog] = useState<ToolLogEntry[]>([]);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [streaming, setStreaming] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (task === null || cwd === null) return;
    const mine = (id: string): boolean => runIdRef.current !== null && id === runIdRef.current;

    const offs = [
      props.client.on("agent.run.state", (payload) => {
        if (!mine(payload.runId)) return;
        setThinking(payload.state === "thinking");
        if (payload.state === "cancelled") setOutcome({ kind: "cancelled" });
      }),
      // Akışlı asistan metni (ADR-012): tur boyunca birikir, araç başlayınca sıfırlanır.
      props.client.on("agent.delta", (payload) => {
        if (!mine(payload.runId)) return;
        setStreaming((s) => s + payload.text);
      }),
      props.client.on("agent.tool.started", (payload) => {
        if (!mine(payload.runId)) return;
        setStreaming("");
        setLog((l) => [...l, { kind: "started", tool: payload.tool, summary: payload.argsSummary }]);
      }),
      props.client.on("agent.tool.completed", (payload) => {
        if (!mine(payload.runId)) return;
        setLog((l) => [
          ...l,
          { kind: "completed", tool: payload.tool, summary: payload.resultSummary, ok: payload.ok },
        ]);
      }),
      props.client.on("agent.tool.requested", (payload) => {
        if (!mine(payload.runId)) return;
        setPending(payload);
      }),
      props.client.on("agent.run.completed", (payload) => {
        if (!mine(payload.runId)) return;
        setPending(null);
        setOutcome({ kind: "completed", result: payload.result, usage: payload.usage });
      }),
      props.client.on("agent.run.failed", (payload) => {
        if (!mine(payload.runId)) return;
        setPending(null);
        setOutcome({ kind: "failed", errorCode: payload.error.code, errorMessage: payload.error.message });
      }),
    ];

    const modelFields =
      modelChoice !== null && modelChoice !== "router"
        ? { provider: modelChoice.provider, model: modelChoice.id }
        : {};
    props.client
      .request("agent.start", { agentId: props.agentId, task, cwd, ...modelFields })
      .then((ok) => {
        runIdRef.current = ok.runId;
        setRunId(ok.runId);
      })
      .catch((error: unknown) => {
        setStartError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      for (const off of offs) off();
    };
  }, [task, cwd]);

  /** Aynı agent/dizin/model ile yeni görev: koşu durumunu sıfırla, görev girişine dön. */
  const resetForNewTask = (): void => {
    runIdRef.current = null;
    setRunId(null);
    setTask(null);
    setTaskDraft("");
    setLog([]);
    setPending(null);
    setThinking(false);
    setOutcome(null);
    setStreaming("");
    setStartError(null);
  };

  useInput((input, key) => {
    if (pending !== null) {
      const canAlways = pending.riskClass !== "destructive";
      const answer = input.toLowerCase();
      const decision =
        answer === "e"
          ? "allow"
          : canAlways && answer === "b"
            ? "allow_for_run"
            : canAlways && answer === "d"
              ? "always_allow"
              : answer === "h"
                ? "deny"
                : null;
      if (decision === null) return;
      // .catch ŞART: yakalanmamış promise reddi Node 24'te tüm süreci çökertir.
      void props.client
        .request("permission.respond", { requestId: pending.requestId, decision })
        .catch((error: unknown) => {
          setStartError(error instanceof Error ? error.message : String(error));
        });
      setPending(null);
      return;
    }
    // Koşu bitti: Enter → yeni görev, Esc → ana menü. Süreç KAPANMAZ (tek-seferlik değil).
    if (outcome !== null) {
      if (key.return) resetForNewTask();
      else if (key.escape) props.onExit();
      return;
    }
    if (key.escape && runId !== null) {
      void props.client.request("agent.cancel", { runId }).catch(() => undefined);
    }
  });

  if (cwd === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{props.agentId}</Text>
        <Text dimColor>Çalışma dizini (Enter: olduğu gibi kabul et):</Text>
        <Box>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={cwdDraft}
            onChange={setCwdDraft}
            onSubmit={(value) => {
              const trimmed = value.trim();
              setCwd(trimmed.length > 0 ? trimmed : props.cwd);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (modelChoice === null) {
    return <AgentModelPicker models={props.models} onPick={setModelChoice} />;
  }

  if (task === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{props.agentId}</Text>
        <Text dimColor>{cwd}</Text>
        <Text dimColor>Görev nedir?</Text>
        <Box>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={taskDraft}
            onChange={setTaskDraft}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length > 0) setTask(trimmed);
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        🤖 {props.agentId} · {cwd}
        {modelChoice !== "router" ? ` · ${modelChoice.provider}/${modelChoice.id}` : " · router seçti"}
        {runId !== null ? ` · koşu ${runId.slice(0, 8)}` : ""} — Esc: iptal
      </Text>
      {startError !== null && <Text color="red">⚠ {startError}</Text>}
      {log.map((entry, i) => (
        <Text key={i} color={entry.kind === "completed" ? (entry.ok === true ? "green" : "red") : "cyan"}>
          {entry.kind === "started" ? "▶ " : entry.ok === true ? "✔ " : "✘ "}
          {entry.summary}
        </Text>
      ))}
      {streaming.length > 0 && outcome === null && <Text color="green">{streaming}</Text>}
      {thinking && streaming.length === 0 && pending === null && outcome === null && (
        <Text dimColor>· düşünüyor…</Text>
      )}
      {pending !== null && <PermissionBox permission={pending} />}
      {outcome !== null && (
        <>
          <Outcome outcome={outcome} />
          <Text dimColor>↵ Enter: yeni görev · Esc: ana menü</Text>
        </>
      )}
    </Box>
  );
}

/** Model seçici + "router seçsin" seçeneği (model-picker.tsx ile aynı ↑/↓+Enter deseni). */
function AgentModelPicker(props: {
  models: ModelInfo[];
  onPick: (choice: ModelChoice) => void;
}): JSX.Element {
  const options: ModelChoice[] = ["router", ...props.models];
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    if (key.downArrow) setIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    if (key.return) {
      const choice = options[index];
      if (choice !== undefined) props.onPick(choice);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Hangi model? (↑/↓ + Enter):</Text>
      {options.map((choice, i) => {
        const selected = i === index;
        const label =
          choice === "router" ? (
            <>
              Router seçsin <Text dimColor>(önerilen — göreve göre otomatik seçer)</Text>
            </>
          ) : (
            <>
              {choice.provider}/{choice.id} <Text dimColor>[{choice.local ? "yerel" : "bulut"}]</Text>
            </>
          );
        return (
          <Text key={choice === "router" ? "router" : `${choice.provider}/${choice.id}`} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {label}
          </Text>
        );
      })}
    </Box>
  );
}

function PermissionBox(props: { permission: PendingPermission }): JSX.Element {
  const canAlways = props.permission.riskClass !== "destructive";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>
        🔐 izin isteği: {props.permission.tool}{" "}
        <Text dimColor>[risk: {props.permission.riskClass}]</Text>
      </Text>
      <Text dimColor>{JSON.stringify(props.permission.args)}</Text>
      {props.permission.diff !== undefined && <DiffView diff={props.permission.diff} />}
      <Text>
        {canAlways
          ? "[e]vet   [b]u koşu boyunca   [d]aima izin ver   [h]ayır"
          : "[e]vet   [h]ayır"}
      </Text>
    </Box>
  );
}

function DiffView(props: { diff: string }): JSX.Element {
  return (
    <Box flexDirection="column">
      {props.diff.split("\n").map((line, i) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        return (
          <Text key={i} color={added ? "green" : removed ? "red" : undefined} dimColor={!added && !removed}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function Outcome(props: { outcome: RunOutcome }): JSX.Element {
  if (props.outcome.kind === "completed") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green" bold>
          ✔ koşu tamamlandı
        </Text>
        <Text>{props.outcome.result}</Text>
        {props.outcome.usage !== undefined && (
          <Text dimColor>
            {props.outcome.usage.inputTokens}+{props.outcome.usage.outputTokens} token · $
            {props.outcome.usage.costUsd.toFixed(4)}
          </Text>
        )}
      </Box>
    );
  }
  if (props.outcome.kind === "cancelled") {
    return <Text color="yellow">⚠ koşu iptal edildi</Text>;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="red" bold>
        ✘ koşu başarısız: {props.outcome.errorCode}
      </Text>
      <Text color="red">{props.outcome.errorMessage}</Text>
    </Box>
  );
}
