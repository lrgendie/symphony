import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useRef, useState, type JSX } from "react";
import type { ChatMessage, ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  /** Asistan cevabının maliyet satırı (chat.completed'dan). */
  usage?: Usage;
}

/** Streaming sohbet ekranı: delta'lar canlı akar, Esc koşan cevabı iptal eder. */
export function Chat(props: { client: DaemonClient; model: ModelInfo }): JSX.Element {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useInput((_input, key) => {
    if (key.escape) abortRef.current?.abort();
  });

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || streaming !== null) return;
    setDraft("");
    setError(null);

    const nextHistory: HistoryEntry[] = [...history, { role: "user", content: trimmed }];
    setHistory(nextHistory);
    setStreaming("");

    const messages: ChatMessage[] = nextHistory.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }));
    const abort = new AbortController();
    abortRef.current = abort;

    let answer = "";
    props.client
      .chat(
        { provider: props.model.provider, model: props.model.id, messages },
        (delta) => {
          answer += delta;
          setStreaming(answer);
        },
        abort.signal,
      )
      .then((usage) => {
        setHistory((h) => [...h, { role: "assistant", content: answer, usage }]);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        if (answer.length > 0) {
          setHistory((h) => [...h, { role: "assistant", content: answer }]);
        }
      })
      .finally(() => {
        setStreaming(null);
        abortRef.current = null;
      });
  };

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {props.model.provider}/{props.model.id} — Esc: cevabı iptal, Ctrl+C: çıkış
      </Text>
      {history.map((entry, i) => (
        <Box key={i} flexDirection="column" marginTop={1}>
          <Text color={entry.role === "user" ? "cyan" : "green"} bold>
            {entry.role === "user" ? "sen" : props.model.id}
          </Text>
          <Text>{entry.content}</Text>
          {entry.usage !== undefined && (
            <Text dimColor>
              {entry.usage.inputTokens}+{entry.usage.outputTokens} token · $
              {entry.usage.costUsd.toFixed(4)}
            </Text>
          )}
        </Box>
      ))}
      {streaming !== null && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>
            {props.model.id} <Text dimColor>yazıyor…</Text>
          </Text>
          <Text>{streaming}</Text>
        </Box>
      )}
      {error !== null && <Text color="red">⚠ {error}</Text>}
      {streaming === null && (
        <Box marginTop={1}>
          <Text color="cyan">{"> "}</Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={submit} />
        </Box>
      )}
    </Box>
  );
}
