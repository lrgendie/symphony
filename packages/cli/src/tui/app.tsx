import { Box, render } from "ink";
import { useState, type JSX } from "react";
import type { ModelInfo, ProviderHealth, Usage } from "@symphony/shared";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { Chat } from "./chat.js";
import { ModelPicker } from "./model-picker.js";
import { Welcome } from "./welcome.js";

/** `symphony` (argümansız): karşılama → model seçici → sohbet. */
export function App(props: {
  client: DaemonClient;
  models: ModelInfo[];
  providers: ProviderHealth[];
  totals: Usage;
}): JSX.Element {
  const [model, setModel] = useState<ModelInfo | null>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome providers={props.providers} totals={props.totals} />
      {model === null ? (
        <ModelPicker models={props.models} onPick={setModel} />
      ) : (
        <Chat client={props.client} model={model} />
      )}
    </Box>
  );
}

export async function runTui(): Promise<void> {
  const client = await connectToDaemon();
  const [{ models }, usage] = await Promise.all([
    client.request("models.list", {}),
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
      providers={client.snapshot?.providers ?? []}
      totals={usage.totals}
    />,
  );
  await instance.waitUntilExit();
  client.close();
}
