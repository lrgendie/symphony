import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { AgentSummary } from "@symphony/shared";

/** Agent seçici: ↑/↓ gezinme, Enter seçim — model-picker ile aynı desen. */
export function AgentPicker(props: {
  agents: AgentSummary[];
  onPick: (agent: AgentSummary) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : props.agents.length - 1));
    if (key.downArrow) setIndex((i) => (i < props.agents.length - 1 ? i + 1 : 0));
    if (key.return) {
      const agent = props.agents[index];
      if (agent !== undefined) props.onPick(agent);
    }
  });

  if (props.agents.length === 0) {
    return <Text color="red">Kayıtlı agent yok (~/.symphony/agents/*.md).</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold>Hangi agent? (↑/↓ + Enter):</Text>
      {props.agents.map((agent, i) => {
        const selected = i === index;
        return (
          <Text key={agent.id} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {agent.id} <Text dimColor>— {agent.description}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
