import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useEffect, useRef, useState, type JSX } from "react";
import type { ModelInfo, PendingPermission, Usage } from "@lrgendie/shared";
import type { DaemonClient } from "../client/daemon-client.js";

interface ToolLogEntry {
  kind: "started" | "completed";
  tool: string;
  summary: string;
  ok?: boolean;
}

interface RunOutcome {
  kind: "completed" | "failed" | "cancelled";
  result?: string;
  usage?: Usage;
  errorCode?: string;
  errorMessage?: string;
}

type ModelChoice = ModelInfo | "router";

/** `/harita [başlık]` — tam eşleşme (`/haritalamaya` gibi kelimeleri tetiklemez). */
const HARITA_COMMAND = /^\/harita(?:\s+(.+))?$/;

/**
 * TUI agent modu (ROADMAP Faz 3): çalışma dizini onayı → model seçimi → görev girişi →
 * agent.start → izin kutusu (tek tuş e/d/h) + renkli diff + canlı araç günlüğü →
 * sonuç/hata. `symphony agent <ad> <görev>` (cli/src/commands/agent.ts) ile AYNI
 * olaylara abone olur — yalnız sunum katmanı Ink.
 *
 * Dilim 2.2 (ADR-012): koşu KONUŞMALI başlatılır — görev bitince kapanmaz, awaiting_user'da
 * devam girişi gösterilir (agent.say, aynı runId/bağlam/MCP). Esc koşuyu bitirir (cancel).
 *
 * Çalışma dizini ve model ADIM OLARAK sorulur (varsayılan: bulunduğun dizin / router
 * seçimi) — sessizce "neredeysen orası" almak kullanıcıyı şaşırtabiliyor: yanlış dizinde
 * başlatılan bir koşu, agent'ın alakasız/devasa bir ağaçta (ör. ev dizini) gezinip
 * konudan sapmasına yol açabilir (2026-07-05, gerçek kullanıcı testinde görüldü).
 */
export function AgentRun(props: {
  client: DaemonClient;
  agentId: string;
  cwd: string;
  models: ModelInfo[];
  /** Koşu bitince Esc → ana menü (App mode/agent'ı sıfırlar). TUI kapanmaz. */
  onExit: () => void;
  /** Resume (Dilim 2.3c): verilirse agent.start bu oturuma DEVAM eder (geçmiş daemon'da tohumlanır). */
  initialSessionId?: string;
  /** Resume: önceki konuşmanın ekrana tohumlanan satırları (`> ` kullanıcı, `🤖 ` asistan). */
  seedExchange?: string[];
  /** Resume: model önceki oturumunkiyle sabitlenir → model seçici atlanır. */
  fixedModel?: ModelInfo;
  /**
   * Agent tanımının pinlediği model (varsa, ör. D7 `agent-oneri`nin yazdığı pin) — model
   * seçicide yalnız BAŞLANGIÇ imleci bunu gösterir; liste TAM kalır, kullanıcı istediği an
   * başka bir model seçebilir (`fixedModel`den FARKLI: o seçiciyi TAMAMEN atlar, bu atlamaz).
   */
  pinnedProvider?: string;
  pinnedModel?: string;
}): JSX.Element {
  const [cwd, setCwd] = useState<string | null>(null);
  const [cwdDraft, setCwdDraft] = useState(props.cwd);
  const [modelChoice, setModelChoice] = useState<ModelChoice | null>(props.fixedModel ?? null);
  const [task, setTask] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [log, setLog] = useState<ToolLogEntry[]>([]);
  const [pending, setPending] = useState<PendingPermission | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  // Geri bildirim (ADR-016 Karar 4, Dilim Z2): koşu bitince tek tuşluk OPSİYONEL işaretleme.
  const [feedbackSent, setFeedbackSent] = useState<"good" | "bad" | null>(null);
  const [streaming, setStreaming] = useState("");
  const [startError, setStartError] = useState<string | null>(null);
  // Konuşmalı koşu (ADR-012, dilim 2.2): tur bitince awaiting_user → devam girişi.
  const [awaiting, setAwaiting] = useState(false);
  const [sayDraft, setSayDraft] = useState("");
  // /harita onay/hata satırı (ADR-019 Karar 6, Dilim H4) — döküme KARIŞMAZ, sonraki turda temizlenir.
  const [mapNote, setMapNote] = useState<string | null>(null);
  /** Biten turların dökümü (agent cevabı + kullanıcı devamı) — ekranda kalır. Resume'da tohumlanır. */
  const [exchange, setExchange] = useState<string[]>(props.seedExchange ?? []);
  // Resume oturumu (rapor2 §3.1): prop SABİTTİR ama koşu bitip "yeni görev" ile sıfırlanınca
  // eski oturuma sessizce devam ETMEMELİ — bu yüzden state'e alınıp reset'te undefined'a düşürülür.
  const [sessionId, setSessionId] = useState<string | undefined>(props.initialSessionId);
  const runIdRef = useRef<string | null>(null);
  // Faz 5 (ADR-014): şef `run_agent` ile çocuk koşular başlatabilir — runId → agentId izlenir
  // ki çocuğun araç aktivitesi/izin isteği de bu ekranda görünsün ve cevaplanabilsin.
  const childAgentIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (task === null || cwd === null) return;
    childAgentIdsRef.current = new Map();
    const mine = (id: string): boolean => runIdRef.current !== null && id === runIdRef.current;
    const mineOrChild = (id: string): boolean => mine(id) || childAgentIdsRef.current.has(id);

    const offs = [
      props.client.on("agent.run.started", (payload) => {
        if (payload.parentRunId === undefined || !mineOrChild(payload.parentRunId)) return;
        childAgentIdsRef.current.set(payload.runId, payload.agentId);
        setLog((l) => [
          ...l,
          { kind: "started", tool: "run_agent", summary: `↳ [${payload.agentId}] başladı` },
        ]);
      }),
      props.client.on("agent.run.state", (payload) => {
        // Yalnız KENDİ koşumuzun durumu ekranın thinking/awaiting/outcome'unu sürer —
        // çocuğun kendi durum geçişleri ayrı bir akış (v1 kapsamı, log'daki tool olayları yeter).
        if (!mine(payload.runId)) return;
        setThinking(payload.state === "thinking");
        setAwaiting(payload.state === "awaiting_user");
        if (payload.state === "cancelled") setOutcome({ kind: "cancelled" });
      }),
      // Akışlı asistan metni (ADR-012): tur boyunca birikir, araç başlayınca sıfırlanır.
      // Yalnız KENDİ koşumuz — çocuğun metni karışırsa ekran anlaşılmaz olur.
      props.client.on("agent.delta", (payload) => {
        if (!mine(payload.runId)) return;
        setStreaming((s) => s + payload.text);
      }),
      props.client.on("agent.tool.started", (payload) => {
        if (!mineOrChild(payload.runId)) return;
        const childId = childAgentIdsRef.current.get(payload.runId);
        if (childId === undefined) setStreaming(""); // yalnız KENDİ aracımız streaming'i keser
        setLog((l) => [
          ...l,
          {
            kind: "started",
            tool: payload.tool,
            summary: childId !== undefined ? `↳ [${childId}] ${payload.argsSummary}` : payload.argsSummary,
          },
        ]);
      }),
      props.client.on("agent.tool.completed", (payload) => {
        if (!mineOrChild(payload.runId)) return;
        const childId = childAgentIdsRef.current.get(payload.runId);
        setLog((l) => [
          ...l,
          {
            kind: "completed",
            tool: payload.tool,
            summary: childId !== undefined ? `↳ [${childId}] ${payload.resultSummary}` : payload.resultSummary,
            ok: payload.ok,
          },
        ]);
      }),
      props.client.on("agent.tool.requested", (payload) => {
        // Çocuğun İZİN İSTEĞİ de burada gösterilir/cevaplanabilir (requestId global — SPEC §5).
        if (!mineOrChild(payload.runId)) return;
        setPending(payload);
      }),
      props.client.on("agent.run.completed", (payload) => {
        if (!mineOrChild(payload.runId)) return;
        if (payload.runId !== runIdRef.current) {
          // Çocuk koşusu bitti — şef devam ediyor, TÜM koşuyu bitirme.
          const childId = childAgentIdsRef.current.get(payload.runId);
          setLog((l) => [
            ...l,
            { kind: "completed", tool: "run_agent", summary: `↳ [${childId ?? "?"}] tamamlandı`, ok: true },
          ]);
          return;
        }
        setPending(null);
        setOutcome({ kind: "completed", result: payload.result, usage: payload.usage });
      }),
      props.client.on("agent.run.failed", (payload) => {
        if (!mineOrChild(payload.runId)) return;
        if (payload.runId !== runIdRef.current) {
          const childId = childAgentIdsRef.current.get(payload.runId);
          setLog((l) => [
            ...l,
            {
              kind: "completed",
              tool: "run_agent",
              summary: `↳ [${childId ?? "?"}] başarısız: ${payload.error.code}`,
              ok: false,
            },
          ]);
          return;
        }
        setPending(null);
        setOutcome({ kind: "failed", errorCode: payload.error.code, errorMessage: payload.error.message });
      }),
    ];

    const modelFields =
      modelChoice !== null && modelChoice !== "router"
        ? { provider: modelChoice.provider, model: modelChoice.id }
        : {};
    props.client
      // conversational (ADR-012): görev bitince koşu kapanmaz, awaiting_user'da devam beklenir.
      // sessionId (2.3c): verilirse önceki konuşmaya devam (daemon geçmişi bağlama tohumlar).
      // "Yeni görev" (resetForNewTask) sonrası bu state undefined'a düşer — yeni oturum üretilir.
      .request("agent.start", {
        agentId: props.agentId,
        task,
        cwd,
        conversational: true,
        ...modelFields,
        ...(sessionId !== undefined ? { sessionId } : {}),
      })
      .then((ok) => {
        runIdRef.current = ok.runId;
        setRunId(ok.runId);
      })
      .catch((error: unknown) => {
        setStartError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      for (const off of offs) off();
    };
  }, [task, cwd]);

  /**
   * Aynı agent/dizin/model ile yeni görev: koşu durumunu sıfırla, görev girişine dön.
   * sessionId de undefined'a düşer (rapor2 §3.1) — "yeni görev" GERÇEKTEN yeni oturum
   * üretir; aksi hâlde ekran boşken model resume edilen eski geçmişi görmeye devam ederdi.
   *
   * `clearModel` (kullanıcı isteği): koşu BAŞARISIZ olunca "yeni görev" model seçiciyi de
   * yeniden göstermeli — aynı (belki kötü seçilmiş) modelle sessizce tekrar denemek yerine,
   * kullanıcı bilinçli bir seçim yapabilsin.
   */
  const resetForNewTask = (options?: { clearModel?: boolean }): void => {
    runIdRef.current = null;
    setRunId(null);
    setTask(null);
    setTaskDraft("");
    setLog([]);
    setPending(null);
    setThinking(false);
    setOutcome(null);
    setStreaming("");
    setStartError(null);
    setAwaiting(false);
    setSayDraft("");
    setExchange([]);
    setSessionId(undefined);
    setFeedbackSent(null);
    if (options?.clearModel === true) setModelChoice(null);
  };

  /** awaiting_user'daki koşuya sonraki kullanıcı turunu gönderir (agent.say, aynı runId). */
  const submitSay = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || runId === null) return;
    setSayDraft("");
    setMapNote(null);

    // "Bunu bağlam haritasına ekleyelim" anı (ADR-019 Karar 6): modele GÖNDERİLMEZ, aktif koşuyu
    // (agent→koşu→model üçlüsündeki "koşu") map.pin ile sabitler — sessionId DEĞİL runId (agent
    // koşuları `agent_runs` tablosunda; başlık koşunun görevinden türer).
    const haritaMatch = HARITA_COMMAND.exec(trimmed);
    if (haritaMatch !== null) {
      const title = haritaMatch[1]?.trim();
      void props.client
        .request("map.pin", {
          ref: { kind: "run", id: runId },
          ...(title !== undefined && title.length > 0 ? { title } : {}),
        })
        .then(() => {
          setMapNote(
            title !== undefined && title.length > 0
              ? `✓ Haritaya sabitlendi: "${title}"`
              : "✓ Haritaya sabitlendi.",
          );
        })
        .catch((error: unknown) => {
          setMapNote(null);
          setStartError(
            `Haritaya sabitlenemedi: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      return;
    }
    // Biten turu döküme taşı; yeni turun delta'ları temiz akar.
    setExchange((e) => [...e, ...(streaming.length > 0 ? [`🤖 ${streaming}`] : []), `> ${trimmed}`]);
    setStreaming("");
    setAwaiting(false);
    void props.client.request("agent.say", { runId, text: trimmed }).catch((error: unknown) => {
      setStartError(error instanceof Error ? error.message : String(error));
    });
  };

  useInput((input, key) => {
    if (pending !== null) {
      const canAlways = pending.riskClass !== "destructive";
      const answer = input.toLowerCase();
      const decision =
        answer === "e"
          ? "allow"
          : canAlways && answer === "b"
            ? "allow_for_run"
            : canAlways && answer === "d"
              ? "always_allow"
              : answer === "h"
                ? "deny"
                : null;
      if (decision === null) return;
      // .catch ŞART: yakalanmamış promise reddi Node 24'te tüm süreci çökertir.
      void props.client
        .request("permission.respond", { requestId: pending.requestId, decision })
        .catch((error: unknown) => {
          setStartError(error instanceof Error ? error.message : String(error));
        });
      setPending(null);
      return;
    }
    // Koşu bitti: Enter → yeni görev, Esc → ana menü. Süreç KAPANMAZ (tek-seferlik değil).
    // BAŞARISIZLIKTA (kullanıcı isteği): "yeni görev" model seçiciyi de yeniden gösterir —
    // aynı modelle sessizce tekrar denemek yerine bilinçli bir seçim istenir.
    if (outcome !== null) {
      if (key.return) resetForNewTask({ clearModel: outcome.kind === "failed" });
      else if (key.escape) props.onExit();
      // Geri bildirim (ADR-016 Karar 4): g/k tek seferlik, akışı ASLA bloklamaz — hata
      // sessizce yutulur (öneri süsü gibi, koşunun sonucu zaten kesinleşmiş).
      else if (feedbackSent === null && runId !== null && (input === "g" || input === "k")) {
        const verdict = input === "g" ? "good" : "bad";
        setFeedbackSent(verdict);
        void props.client
          .request("feedback.submit", { subject: "run", id: runId, verdict })
          .catch(() => undefined);
      }
      return;
    }
    if (key.escape && runId !== null) {
      void props.client.request("agent.cancel", { runId }).catch(() => undefined);
    }
  });

  if (cwd === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{props.agentId}</Text>
        <Text dimColor>Çalışma dizini (Enter: olduğu gibi kabul et):</Text>
        <Box>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={cwdDraft}
            onChange={setCwdDraft}
            onSubmit={(value) => {
              const trimmed = value.trim();
              setCwd(trimmed.length > 0 ? trimmed : props.cwd);
            }}
          />
        </Box>
      </Box>
    );
  }

  if (modelChoice === null) {
    const preferred =
      props.pinnedProvider !== undefined && props.pinnedModel !== undefined
        ? { provider: props.pinnedProvider, model: props.pinnedModel }
        : undefined;
    return <AgentModelPicker models={props.models} onPick={setModelChoice} preferred={preferred} />;
  }

  if (task === null) {
    return (
      <Box flexDirection="column">
        <Text bold>{props.agentId}</Text>
        <Text dimColor>{cwd}</Text>
        <Text dimColor>Görev nedir?</Text>
        <Box>
          <Text color="cyan">{"> "}</Text>
          <TextInput
            value={taskDraft}
            onChange={setTaskDraft}
            onSubmit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length > 0) setTask(trimmed);
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>
        🤖 {props.agentId} · {cwd}
        {modelChoice !== "router" ? ` · ${modelChoice.provider}/${modelChoice.id}` : " · router seçti"}
        {runId !== null ? ` · koşu ${runId.slice(0, 8)}` : ""} — Esc: iptal
      </Text>
      {startError !== null && <Text color="red">⚠ {startError}</Text>}
      {exchange.map((line, i) => (
        <Text key={`x${i}`} dimColor={line.startsWith(">")} color={line.startsWith(">") ? "cyan" : undefined}>
          {line}
        </Text>
      ))}
      {log.map((entry, i) => (
        <Text key={i} color={entry.kind === "completed" ? (entry.ok === true ? "green" : "red") : "cyan"}>
          {entry.kind === "started" ? "▶ " : entry.ok === true ? "✔ " : "✘ "}
          {entry.summary}
        </Text>
      ))}
      {streaming.length > 0 && outcome === null && <Text color="green">{streaming}</Text>}
      {thinking && streaming.length === 0 && pending === null && outcome === null && (
        <Text dimColor>· düşünüyor…</Text>
      )}
      {pending !== null && (
        <PermissionBox permission={pending} agentLabel={childAgentIdsRef.current.get(pending.runId)} />
      )}
      {awaiting && pending === null && outcome === null && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>↵ devam yaz (aynı koşu sürer) · Esc: koşuyu bitir · /harita: haritaya sabitle</Text>
          <Box>
            <Text color="cyan">{"> "}</Text>
            <TextInput value={sayDraft} onChange={setSayDraft} onSubmit={submitSay} />
          </Box>
          {mapNote !== null && <Text color="cyan">{mapNote}</Text>}
        </Box>
      )}
      {outcome !== null && (
        <>
          <Outcome outcome={outcome} />
          {runId !== null && (
            <Text dimColor>
              {feedbackSent === null
                ? "bu koşu iyi miydi? (g/k, geç: başka tuş)"
                : `✓ geri bildirim kaydedildi (${feedbackSent === "good" ? "iyi" : "kötü"})`}
            </Text>
          )}
          <Text dimColor>
            ↵ Enter: {outcome.kind === "failed" ? "model seç + yeni görev" : "yeni görev"} · Esc: ana menü
          </Text>
        </>
      )}
    </Box>
  );
}

/**
 * Model seçici + "router seçsin" seçeneği (model-picker.tsx ile aynı ↑/↓+Enter deseni).
 *
 * `preferred` (agent tanımının pinlediği model, D7 `agent-oneri`nin ürettiği pin dahil):
 * yalnız İMLECİN başlangıç konumunu belirler — liste TAM kalır, kullanıcı istediği an
 * ↑/↓ ile başka bir modele geçebilir (kullanıcı isteği: "varsayılan gözüksün, diğerleri
 * listeli olsun, değiştirmek istersem başında seçeyim").
 */
function AgentModelPicker(props: {
  models: ModelInfo[];
  onPick: (choice: ModelChoice) => void;
  preferred?: { provider: string; model: string };
}): JSX.Element {
  const options: ModelChoice[] = ["router", ...props.models];
  const preferredIndex =
    props.preferred !== undefined
      ? options.findIndex(
          (o) => o !== "router" && o.provider === props.preferred?.provider && o.id === props.preferred?.model,
        )
      : -1;
  const [index, setIndex] = useState(preferredIndex >= 0 ? preferredIndex : 0);

  useInput((_input, key) => {
    if (key.upArrow) setIndex((i) => (i > 0 ? i - 1 : options.length - 1));
    if (key.downArrow) setIndex((i) => (i < options.length - 1 ? i + 1 : 0));
    if (key.return) {
      const choice = options[index];
      if (choice !== undefined) props.onPick(choice);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Hangi model? (↑/↓ + Enter):</Text>
      {options.map((choice, i) => {
        const selected = i === index;
        const isPreferred = i === preferredIndex;
        const label =
          choice === "router" ? (
            <>
              Router seçsin <Text dimColor>(önerilen — göreve göre otomatik seçer)</Text>
            </>
          ) : (
            <>
              {choice.provider}/{choice.id} <Text dimColor>[{choice.local ? "yerel" : "bulut"}]</Text>
              {isPreferred && <Text dimColor> (varsayılan)</Text>}
            </>
          );
        return (
          <Text key={choice === "router" ? "router" : `${choice.provider}/${choice.id}`} color={selected ? "cyan" : undefined}>
            {selected ? "❯ " : "  "}
            {label}
          </Text>
        );
      })}
    </Box>
  );
}

function PermissionBox(props: { permission: PendingPermission; agentLabel?: string }): JSX.Element {
  const canAlways = props.permission.riskClass !== "destructive";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>
        🔐 izin isteği{props.agentLabel !== undefined ? ` [${props.agentLabel}]` : ""}: {props.permission.tool}{" "}
        <Text dimColor>[risk: {props.permission.riskClass}]</Text>
      </Text>
      <Text dimColor>{JSON.stringify(props.permission.args)}</Text>
      {props.permission.diff !== undefined && <DiffView diff={props.permission.diff} />}
      <Text>
        {canAlways
          ? "[e]vet   [b]u koşu boyunca   [d]aima izin ver   [h]ayır"
          : "[e]vet   [h]ayır"}
      </Text>
    </Box>
  );
}

function DiffView(props: { diff: string }): JSX.Element {
  return (
    <Box flexDirection="column">
      {props.diff.split("\n").map((line, i) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        return (
          <Text key={i} color={added ? "green" : removed ? "red" : undefined} dimColor={!added && !removed}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function Outcome(props: { outcome: RunOutcome }): JSX.Element {
  if (props.outcome.kind === "completed") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="green" bold>
          ✔ koşu tamamlandı
        </Text>
        <Text>{props.outcome.result}</Text>
        {props.outcome.usage !== undefined && (
          <Text dimColor>
            {props.outcome.usage.inputTokens}+{props.outcome.usage.outputTokens} token · $
            {props.outcome.usage.costUsd.toFixed(4)}
          </Text>
        )}
      </Box>
    );
  }
  if (props.outcome.kind === "cancelled") {
    return <Text color="yellow">⚠ koşu iptal edildi</Text>;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="red" bold>
        ✘ koşu başarısız: {props.outcome.errorCode}
      </Text>
      <Text color="red">{props.outcome.errorMessage}</Text>
    </Box>
  );
}
