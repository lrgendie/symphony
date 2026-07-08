import { Box, Text, render } from "ink";
import { useState, type JSX } from "react";
import type {
  AgentSummary,
  HistorySessionSummary,
  ModelInfo,
  ProviderHealth,
  Usage,
} from "@symphony/shared";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { AgentPicker } from "./agent-picker.js";
import { AgentRun } from "./agent-run.js";
import { Chat, type HistoryEntry } from "./chat.js";
import { ModelPicker } from "./model-picker.js";
import { ModePicker, type TuiMode } from "./mode-picker.js";
import { ResumePicker } from "./resume-picker.js";
import { Welcome } from "./welcome.js";

/**
 * Sohbet dalı: (kayıtlı sohbet varsa) yeni/devam seçimi → model seç → sohbet.
 * "Devam et" seçilirse önceki oturumun mesajları REST'ten yüklenip Chat'e tohumlanır
 * ve model önceki oturumunkiyle sabitlenir (aynı sessionId'ye REPLACE ile yazılır).
 */
export function ChatFlow(props: {
  client: DaemonClient;
  models: ModelInfo[];
  lastSession: HistorySessionSummary | null;
}): JSX.Element {
  // Devam yalnız önceki oturumun modeli hâlâ mevcutsa teklif edilir (v1 kapsamı).
  const resumeModel =
    props.lastSession !== null
      ? (props.models.find(
          (m) => m.provider === props.lastSession?.provider && m.id === props.lastSession?.model,
        ) ?? null)
      : null;
  const canResume = props.lastSession !== null && resumeModel !== null;

  type Stage =
    | { kind: "resume-choice" }
    | { kind: "loading" }
    | { kind: "model-choice" }
    | { kind: "ready"; model: ModelInfo; sessionId?: string; history?: HistoryEntry[] };

  const [stage, setStage] = useState<Stage>(
    canResume ? { kind: "resume-choice" } : { kind: "model-choice" },
  );
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "resume-choice" && props.lastSession !== null && resumeModel !== null) {
    const session = props.lastSession;
    const model = resumeModel;
    return (
      <ResumePicker
        lastSession={session}
        onPick={(choice) => {
          if (choice === "new") {
            setStage({ kind: "model-choice" });
            return;
          }
          setStage({ kind: "loading" });
          props.client
            .sessionDetail(session.sessionId)
            .then((detail) => {
              if (detail === null) {
                setStage({ kind: "model-choice" });
                return;
              }
              // Yalnız kullanıcı/asistan turları geçmişe girer (system = daemon'ın talimatı).
              const history: HistoryEntry[] = [];
              for (const message of detail.messages) {
                if (message.role === "user" || message.role === "assistant") {
                  history.push({ role: message.role, content: message.content });
                }
              }
              setStage({ kind: "ready", model, sessionId: detail.session.sessionId, history });
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setStage({ kind: "model-choice" });
            });
        }}
      />
    );
  }

  if (stage.kind === "loading") {
    return <Text dimColor>önceki sohbet yükleniyor…</Text>;
  }

  if (stage.kind === "model-choice") {
    return (
      <Box flexDirection="column">
        {error !== null && <Text color="red">⚠ {error}</Text>}
        <ModelPicker models={props.models} onPick={(model) => setStage({ kind: "ready", model })} />
      </Box>
    );
  }

  if (stage.kind === "ready") {
    return (
      <Chat
        client={props.client}
        model={stage.model}
        initialSessionId={stage.sessionId}
        initialHistory={stage.history}
      />
    );
  }
  // Ulaşılmaz: resume-choice yalnız lastSession+resumeModel varken başlangıç durumudur.
  return <Text dimColor>yükleniyor…</Text>;
}

/** `symphony` (argümansız): karşılama → mod seçici → sohbet YA DA agent akışı. */
export function App(props: {
  client: DaemonClient;
  models: ModelInfo[];
  agents: AgentSummary[];
  providers: ProviderHealth[];
  totals: Usage;
  cwd: string;
  lastSession: HistorySessionSummary | null;
}): JSX.Element {
  const [mode, setMode] = useState<TuiMode | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome providers={props.providers} totals={props.totals} />
      {mode === null && <ModePicker onPick={setMode} />}
      {mode === "chat" && (
        <ChatFlow client={props.client} models={props.models} lastSession={props.lastSession} />
      )}
      {mode === "agent" &&
        (agent === null ? (
          <AgentPicker agents={props.agents} onPick={setAgent} />
        ) : (
          <AgentRun
            client={props.client}
            agentId={agent.id}
            cwd={props.cwd}
            models={props.models}
            onExit={() => {
              setAgent(null);
              setMode(null);
            }}
          />
        ))}
    </Box>
  );
}

export async function runTui(): Promise<void> {
  const client = await connectToDaemon();
  const [{ models }, { agents }, usage, sessions] = await Promise.all([
    client.request("models.list", {}),
    client.request("agents.list", {}),
    client.request("usage.query", {}),
    // Geçmiş yoksa/başarısızsa sessizce devam et — "devam et" seçeneği gizlenir.
    client.listSessions(1).catch(() => [] as HistorySessionSummary[]),
  ]);
  if (models.length === 0) {
    console.error("Hiç model yok — önce bir sağlayıcı yapılandır (bkz. symphony status).");
    client.close();
    process.exitCode = 1;
    return;
  }
  const instance = render(
    <App
      client={client}
      models={models}
      agents={agents}
      providers={client.snapshot?.providers ?? []}
      totals={usage.totals}
      cwd={process.cwd()}
      lastSession={sessions[0] ?? null}
    />,
  );
  await instance.waitUntilExit();
  client.close();
}
