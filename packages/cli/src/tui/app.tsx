import { Box, render } from "ink";
import { useState, type JSX } from "react";
import type {
  AgentSummary,
  HistorySessionDetailResponse,
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
import { SessionPicker, type ChatStart } from "./session-picker.js";
import { Welcome } from "./welcome.js";

/** `symphony` (argümansız): karşılama → mod seçici → sohbet YA DA agent akışı. */
export function App(props: {
  client: DaemonClient;
  models: ModelInfo[];
  agents: AgentSummary[];
  providers: ProviderHealth[];
  totals: Usage;
  cwd: string;
  /** Son kayıtlı sohbet (REST'ten; yoksa null → devam seçeneği hiç gösterilmez). */
  lastSession: HistorySessionDetailResponse | null;
}): JSX.Element {
  const [mode, setMode] = useState<TuiMode | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  // Kayıtlı sohbet yoksa seçim adımı atlanır: bugünkü davranış (yeni sohbet) korunur.
  const [chatStart, setChatStart] = useState<ChatStart | null>(
    props.lastSession === null ? "new" : null,
  );

  const resume = chatStart === "resume" && props.lastSession !== null ? props.lastSession : null;
  const initialHistory = resume?.messages.flatMap((message): HistoryEntry[] =>
    message.role === "system" ? [] : [{ role: message.role, content: message.content }],
  );

  const pickStart = (choice: ChatStart): void => {
    setChatStart(choice);
    if (choice === "resume" && props.lastSession !== null) {
      const { session } = props.lastSession;
      // Aynı modelle sürdür; model artık listede yoksa seçici açık kalır (yeni modelle devam).
      const previous = props.models.find(
        (m) => m.provider === session.provider && m.id === session.model,
      );
      if (previous !== undefined) setModel(previous);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome providers={props.providers} totals={props.totals} />
      {mode === null && <ModePicker onPick={setMode} />}
      {mode === "chat" &&
        (chatStart === null && props.lastSession !== null ? (
          <SessionPicker last={props.lastSession.session} onPick={pickStart} />
        ) : model === null ? (
          <ModelPicker models={props.models} onPick={setModel} />
        ) : (
          <Chat
            client={props.client}
            model={model}
            initialSessionId={resume?.session.sessionId}
            initialHistory={initialHistory}
          />
        ))}
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
  const [{ models }, { agents }, usage, lastSession] = await Promise.all([
    client.request("models.list", {}),
    client.request("agents.list", {}),
    client.request("usage.query", {}),
    // Geçmiş okunamazsa (eski daemon vb.) TUI açılışı engellenmez — devam seçeneği gizlenir.
    client.fetchLatestSession().catch(() => null),
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
      lastSession={lastSession}
    />,
  );
  await instance.waitUntilExit();
  client.close();
}
