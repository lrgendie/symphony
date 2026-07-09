import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { HistorySessionSummary } from "@symphony/shared";

export type ChatStart = "resume" | "new";

/**
 * Sohbet başlangıç seçici: son kayıtlı sohbete devam ya da yeni sohbet.
 * Yalnız kayıtlı bir sohbet VARSA gösterilir (yoksa App doğrudan yeni sohbete geçer).
 * ↑/↓ + Enter — mode-picker ile aynı desen.
 */
export function SessionPicker(props: {
  last: HistorySessionSummary;
  onPick: (choice: ChatStart) => void;
}): JSX.Element {
  const options: Array<{ choice: ChatStart; label: string; hint: string }> = [
    {
      choice: "resume",
      label: "Önceki sohbete devam et",
      hint: `«${props.last.title}» · ${props.last.provider}/${props.last.model} · ${props.last.messageCount} mesaj`,
    },
    { choice: "new", label: "Yeni sohbet", hint: "boş geçmişle başla" },
  ];
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    if (key.downArrow) setIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    if (key.return) {
      const option = options[index];
      if (option !== undefined) props.onPick(option.choice);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Sohbet (↑/↓ + Enter):</Text>
      {options.map((option, i) => {
        const selected = i === index;
        return (
          <Text key={option.choice} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {option.label} <Text dimColor>({option.hint})</Text>
          </Text>
        );
      })}
    </Box>
  );
}
