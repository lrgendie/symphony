import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";

export type TuiMode = "chat" | "agent";

const OPTIONS: Array<{ mode: TuiMode; label: string; hint: string }> = [
  { mode: "chat", label: "Sohbet", hint: "model seç, konuş" },
  { mode: "agent", label: "Agent", hint: "görev ver, izinle dosya/komut çalıştırsın" },
];

/** Açılış mod seçici: ↑/↓ gezinme, Enter seçim — model-picker ile aynı desen. */
export function ModePicker(props: { onPick: (mode: TuiMode) => void }): JSX.Element {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : OPTIONS.length - 1));
    if (key.downArrow) setIndex((i) => (i < OPTIONS.length - 1 ? i + 1 : 0));
    if (key.return) {
      const option = OPTIONS[index];
      if (option !== undefined) props.onPick(option.mode);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Ne yapmak istersin? (↑/↓ + Enter):</Text>
      {OPTIONS.map((option, i) => {
        const selected = i === index;
        return (
          <Text key={option.mode} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {option.label} <Text dimColor>({option.hint})</Text>
          </Text>
        );
      })}
    </Box>
  );
}
