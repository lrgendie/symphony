import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { HistorySessionSummary } from "@lrgendie/shared";

export type ResumeChoice = "new" | "continue";

/**
 * Sohbet dalı açılışı: yeni sohbet mi, son sohbete devam mı (↑/↓ + Enter).
 * Yalnız kayıtlı bir sohbet varsa gösterilir — mode/model picker ile aynı desen.
 */
export function ResumePicker(props: {
  lastSession: HistorySessionSummary;
  onPick: (choice: ResumeChoice) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const { lastSession } = props;
  const titleHint = lastSession.title.length > 0 ? ` · "${lastSession.title}"` : "";
  const options: Array<{ choice: ResumeChoice; label: string; hint: string }> = [
    { choice: "new", label: "Yeni sohbet", hint: "temiz başla, model seç" },
    {
      choice: "continue",
      label: "Önceki sohbete devam et",
      hint: `${lastSession.provider}/${lastSession.model} · ${lastSession.messageCount} mesaj${titleHint}`,
    },
  ];

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
