import { Box, render } from "ink";
import { useState, type JSX } from "react";
import type { AgentSummary, ModelInfo, ProviderHealth, Usage } from "@symphony/shared";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { AgentPicker } from "./agent-picker.js";
import { AgentRun } from "./agent-run.js";
import { Chat } from "./chat.js";
import { ModelPicker } from "./model-picker.js";
import { ModePicker, type TuiMode } from "./mode-picker.js";
import { Welcome } from "./welcome.js";

/** `symphony` (argümansız): karşılama → mod seçici → sohbet YA DA agent akışı. */
export function App(props: {
  client: DaemonClient;
  models: ModelInfo[];
  agents: AgentSummary[];
  providers: ProviderHealth[];
  totals: Usage;
  cwd: string;
}): JSX.Element {
  const [mode, setMode] = useState<TuiMode | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [agent, setAgent] = useState<AgentSummary | null>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome providers={props.providers} totals={props.totals} />
      {mode === null && <ModePicker onPick={setMode} />}
      {mode === "chat" &&
        (model === null ? (
          <ModelPicker models={props.models} onPick={setModel} />
        ) : (
          <Chat client={props.client} model={model} />
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
  const [{ models }, { agents }, usage] = await Promise.all([
    client.request("models.list", {}),
    client.request("agents.list", {}),
    client.request("usage.query", {}),
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
    />,
  );
  await instance.waitUntilExit();
  client.close();
}
