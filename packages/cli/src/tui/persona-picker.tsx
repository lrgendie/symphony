import { Box, Text, useInput } from "ink";
import { useState, type JSX } from "react";
import type { AgentSummary } from "@lrgendie/shared";

/**
 * Birleşik giriş seçimi (ADR-012, Dilim 2.3): eski "Sohbet / Agent modu" ikilisi kalktı.
 * Artık tek soru — "kiminle konuşmak istersin?": saf Sohbet (araçsız, geçmiş korunur, önceki
 * sohbete devam edilebilir) YA DA kayıtlı bir agent personası (asistan = salt-okur, coder =
 * dosya/komut). Hepsi bir konuşmadır; fark, personanın yetenekleridir (araç varsa izin kapısı
 * arkasında). Bu, ModePicker+AgentPicker iki adımını tek adıma indirir.
 */
export type Persona = { kind: "chat" } | { kind: "agent"; agent: AgentSummary };

interface Row {
  key: string;
  label: string;
  hint: string;
  persona: Persona;
}

export function PersonaPicker(props: {
  agents: AgentSummary[];
  onPick: (persona: Persona) => void;
}): JSX.Element {
  const rows: Row[] = [
    {
      key: "chat",
      label: "Sohbet",
      hint: "sadece konuş — geçmişin kaydolur, önceki sohbete devam edebilirsin",
      persona: { kind: "chat" },
    },
    ...props.agents.map(
      (agent): Row => ({
        key: `agent:${agent.id}`,
        label: agent.id,
        hint: agent.description,
        persona: { kind: "agent", agent },
      }),
    ),
  ];
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : rows.length - 1));
    if (key.downArrow) setIndex((i) => (i < rows.length - 1 ? i + 1 : 0));
    if (key.return) {
      const row = rows[index];
      if (row !== undefined) props.onPick(row.persona);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Kiminle konuşmak istersin? (↑/↓ + Enter):</Text>
      {rows.map((row, i) => {
        const selected = i === index;
        return (
          <Text key={row.key} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {row.label} <Text dimColor>— {row.hint}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
