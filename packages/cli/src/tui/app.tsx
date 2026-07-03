import { Box, Text, render } from "ink";
import { useState, type JSX } from "react";
import type { ModelInfo } from "@symphony/shared";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { Chat } from "./chat.js";
import { ModelPicker } from "./model-picker.js";

/** `symphony` (argümansız): model seçici → sohbet. Claude Code akışının aynısı. */
export function App(props: { client: DaemonClient; models: ModelInfo[] }): JSX.Element {
  const [model, setModel] = useState<ModelInfo | null>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>🎼 Symphony</Text>
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
  const { models } = await client.request("models.list", {});
  if (models.length === 0) {
    console.error("Hiç model yok — önce bir sağlayıcı yapılandır (bkz. symphony status).");
    client.close();
    process.exitCode = 1;
    return;
  }
  const instance = render(<App client={client} models={models} />);
  await instance.waitUntilExit();
  client.close();
}
