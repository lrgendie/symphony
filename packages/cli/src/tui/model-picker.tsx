import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { ModelInfo } from "@symphony/shared";

/** Açılış model seçici: ↑/↓ gezinme, Enter seçim (ROADMAP Faz 2). */
export function ModelPicker(props: {
  models: ModelInfo[];
  onPick: (model: ModelInfo) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : props.models.length - 1));
    if (key.downArrow) setIndex((i) => (i < props.models.length - 1 ? i + 1 : 0));
    if (key.return) {
      const model = props.models[index];
      if (model !== undefined) props.onPick(model);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Model seç (↑/↓ + Enter):</Text>
      {props.models.map((model, i) => {
        const selected = i === index;
        const tag = model.local ? "yerel" : "bulut";
        const context =
          model.contextWindow !== undefined ? ` ${Math.round(model.contextWindow / 1000)}k` : "";
        return (
          <Text key={`${model.provider}/${model.id}`} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {model.provider}/{model.id}{" "}
            <Text dimColor>
              [{tag}
              {context}]
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}
