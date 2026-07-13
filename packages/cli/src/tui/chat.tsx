import { randomUUID } from "node:crypto";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useRef, useState, type JSX } from "react";
import type { ChatMessage, ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";

export interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
  /** Asistan cevabının maliyet satırı (chat.completed'dan). */
  usage?: Usage;
}

/** `/harita [başlık]` — tam eşleşme (`/haritalamaya` gibi kelimeleri tetiklemez). */
const HARITA_COMMAND = /^\/harita(?:\s+(.+))?$/;

/**
 * Streaming sohbet ekranı: delta'lar canlı akar, Esc koşan cevabı iptal eder.
 * `initialSessionId`/`initialHistory` verilirse önceki sohbete DEVAM edilir: aynı
 * sessionId'ye yazılır (daemon REPLACE semantiği → çiftleme yok) ve model önceki
 * bağlamı görür. Verilmezse yeni UUID + boş geçmişle temiz başlar.
 */
export function Chat(props: {
  client: DaemonClient;
  model: ModelInfo;
  initialSessionId?: string;
  initialHistory?: HistoryEntry[];
}): JSX.Element {
  const [history, setHistory] = useState<HistoryEntry[]>(props.initialHistory ?? []);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // /harita onay/hata satırı (ADR-019 Karar 6, Dilim H4) — chat geçmişine KARIŞMAZ (modele
  // gönderilen `messages` yalnız `history`den türer), bir sonraki girişte temizlenir.
  const [mapNote, setMapNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Sabit oturum kimliği: turlar tek sohbet olarak SQLite geçmişine yazılır (PROTOKOL §3).
  // Devam modunda önceki oturumun kimliğiyle tohumlanır → aynı sohbete eklenir.
  const sessionIdRef = useRef(props.initialSessionId ?? randomUUID());

  useInput((_input, key) => {
    if (key.escape) abortRef.current?.abort();
  });

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || streaming !== null) return;
    setDraft("");
    setError(null);
    setMapNote(null);

    // "Bunu bağlam haritasına ekleyelim" anı (ADR-019 Karar 6): modele GÖNDERİLMEZ, aktif
    // oturumu map.pin ile sabitler. İlk mesaj hiç gönderilmediyse (oturum SQLite'a henüz
    // yazılmadı) daemon REF_UNKNOWN ile reddeder — burada özel bir kontrol GEREKMEZ, hata
    // aynı `error` satırında görünür.
    const haritaMatch = HARITA_COMMAND.exec(trimmed);
    if (haritaMatch !== null) {
      const title = haritaMatch[1]?.trim();
      void props.client
        .request("map.pin", {
          ref: { kind: "session", id: sessionIdRef.current },
          ...(title !== undefined && title.length > 0 ? { title } : {}),
        })
        .then(() => {
          setMapNote(
            title !== undefined && title.length > 0
              ? `✓ Haritaya sabitlendi: "${title}"`
              : "✓ Haritaya sabitlendi.",
          );
        })
        .catch((err: unknown) => {
          setError(`Haritaya sabitlenemedi: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

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
        {
          sessionId: sessionIdRef.current,
          provider: props.model.provider,
          model: props.model.id,
          messages,
        },
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
        {props.model.provider}/{props.model.id} — Esc: cevabı iptal, Ctrl+C: çıkış ·
        /harita: haritaya sabitle
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
      {mapNote !== null && <Text color="cyan">{mapNote}</Text>}
      {streaming === null && (
        <Box marginTop={1}>
          <Text color="cyan">{"> "}</Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={submit} />
        </Box>
      )}
    </Box>
  );
}
