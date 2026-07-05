import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useRef, useState, type JSX } from "react";
import type { PendingPermission, Usage } from "@symphony/shared";
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

/**
 * TUI agent modu (ROADMAP Faz 3): görev girişi → agent.start → izin kutusu (tek tuş
 * e/d/h) + renkli diff + canlı araç günlüğü → sonuç/hata. `symphony agent <ad> <görev>`
 * (cli/src/commands/agent.ts) ile AYNI olaylara abone olur — yalnız sunum katmanı Ink.
 */
export function AgentRun(props: {
  client: DaemonClient;
  agentId: string;
  cwd: string;
}): JSX.Element {
  const [task, setTask] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [log, setLog] = useState<ToolLogEntry[]>([]);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (task === null) return;
    const mine = (id: string): boolean => runIdRef.current !== null && id === runIdRef.current;

    const offs = [
      props.client.on("agent.run.state", (payload) => {
        if (!mine(payload.runId)) return;
        setThinking(payload.state === "thinking");
        if (payload.state === "cancelled") setOutcome({ kind: "cancelled" });
      }),
      props.client.on("agent.tool.started", (payload) => {
        if (!mine(payload.runId)) return;
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

    props.client
      .request("agent.start", { agentId: props.agentId, task, cwd: props.cwd })
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
  }, [task]);

  useInput((input, key) => {
    if (pending !== null) {
      const canAlways = pending.riskClass !== "destructive";
      const answer = input.toLowerCase();
      const decision =
        answer === "e"
          ? "allow"
          : canAlways && answer === "d"
            ? "always_allow"
            : answer === "h"
              ? "deny"
              : null;
      if (decision === null) return;
      void props.client.request("permission.respond", {
        requestId: pending.requestId,
        decision,
      });
      setPending(null);
      return;
    }
    if (key.escape && runId !== null && outcome === null) {
      void props.client.request("agent.cancel", { runId }).catch(() => undefined);
    }
  });

  if (task === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{props.agentId}</Text>
        <Text dimColor>Görev nedir?</Text>
        <Box>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={draft}
            onChange={setDraft}
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
        🤖 {props.agentId} · {props.cwd}
        {runId !== null ? ` · koşu ${runId.slice(0, 8)}` : ""} — Esc: iptal
      </Text>
      {startError !== null && <Text color="red">⚠ {startError}</Text>}
      {log.map((entry, i) => (
        <Text key={i} color={entry.kind === "completed" ? (entry.ok === true ? "green" : "red") : "cyan"}>
          {entry.kind === "started" ? "▶ " : entry.ok === true ? "✔ " : "✘ "}
          {entry.summary}
        </Text>
      ))}
      {thinking && pending === null && outcome === null && <Text dimColor>· düşünüyor…</Text>}
      {pending !== null && <PermissionBox permission={pending} />}
      {outcome !== null && <Outcome outcome={outcome} />}
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
      <Text>{canAlways ? "[e]vet   [d]aima izin ver   [h]ayır" : "[e]vet   [h]ayır"}</Text>
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
