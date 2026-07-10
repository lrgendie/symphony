import { Box, Text, render } from "ink";
import { useState, type JSX } from "react";
import type {
  AgentSummary,
  HistorySessionSummary,
  ModelInfo,
  ProviderHealth,
  Usage,
} from "@symphony/shared";
import { getSymphonyPaths, loadProfile } from "@symphony/core";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { AgentRun } from "./agent-run.js";
import { Chat, type HistoryEntry } from "./chat.js";
import { ModelPicker } from "./model-picker.js";
import { PersonaPicker, type Persona } from "./persona-picker.js";
import { ResumePicker } from "./resume-picker.js";
import { Welcome } from "./welcome.js";

/**
 * Sohbet dalı: (kayıtlı sohbet varsa) yeni/devam seçimi → model seç → sohbet.
 * "Devam et" seçilirse önceki oturumun mesajları REST'ten yüklenip Chat'e tohumlanır
 * ve model önceki oturumunkiyle sabitlenir (aynı sessionId'ye REPLACE ile yazılır).
 */
export function ChatFlow(props: {
  client: DaemonClient;
  models: ModelInfo[];
  lastSession: HistorySessionSummary | null;
}): JSX.Element {
  // Devam yalnız önceki oturumun modeli hâlâ mevcutsa teklif edilir (v1 kapsamı).
  const resumeModel =
    props.lastSession !== null
      ? (props.models.find(
          (m) => m.provider === props.lastSession?.provider && m.id === props.lastSession?.model,
        ) ?? null)
      : null;
  const canResume = props.lastSession !== null && resumeModel !== null;

  type Stage =
    | { kind: "resume-choice" }
    | { kind: "loading" }
    | { kind: "model-choice" }
    | { kind: "ready"; model: ModelInfo; sessionId?: string; history?: HistoryEntry[] };

  const [stage, setStage] = useState<Stage>(
    canResume ? { kind: "resume-choice" } : { kind: "model-choice" },
  );
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "resume-choice" && props.lastSession !== null && resumeModel !== null) {
    const session = props.lastSession;
    const model = resumeModel;
    return (
      <ResumePicker
        lastSession={session}
        onPick={(choice) => {
          if (choice === "new") {
            setStage({ kind: "model-choice" });
            return;
          }
          setStage({ kind: "loading" });
          props.client
            .sessionDetail(session.sessionId)
            .then((detail) => {
              if (detail === null) {
                setStage({ kind: "model-choice" });
                return;
              }
              // Yalnız kullanıcı/asistan turları geçmişe girer (system = daemon'ın talimatı).
              const history: HistoryEntry[] = [];
              for (const message of detail.messages) {
                if (message.role === "user" || message.role === "assistant") {
                  history.push({ role: message.role, content: message.content });
                }
              }
              setStage({ kind: "ready", model, sessionId: detail.session.sessionId, history });
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setStage({ kind: "model-choice" });
            });
        }}
      />
    );
  }

  if (stage.kind === "loading") {
    return <Text dimColor>önceki sohbet yükleniyor…</Text>;
  }

  if (stage.kind === "model-choice") {
    return (
      <Box flexDirection="column">
        {error !== null && <Text color="red">⚠ {error}</Text>}
        <ModelPicker models={props.models} onPick={(model) => setStage({ kind: "ready", model })} />
      </Box>
    );
  }

  if (stage.kind === "ready") {
    return (
      <Chat
        client={props.client}
        model={stage.model}
        initialSessionId={stage.sessionId}
        initialHistory={stage.history}
      />
    );
  }
  // Ulaşılmaz: resume-choice yalnız lastSession+resumeModel varken başlangıç durumudur.
  return <Text dimColor>yükleniyor…</Text>;
}

/**
 * Agent personası dalı (Dilim 2.3c): (kayıtlı konuşma varsa) yeni/devam seçimi → AgentRun.
 * "Devam et" seçilirse önceki konuşmanın mesajları REST'ten yüklenip AgentRun'a tohumlanır;
 * agent.start `sessionId` ile AYNI oturuma yazılır (2.3b kalıcılığı üzerine oturur). ChatFlow'un
 * agent karşılığı — aynı ResumePicker deseni, tek fark: konuşma araçlı bir agent koşusudur.
 */
export function AgentFlow(props: {
  client: DaemonClient;
  agentId: string;
  cwd: string;
  models: ModelInfo[];
  lastSession: HistorySessionSummary | null;
  onExit: () => void;
}): JSX.Element {
  const resumeModel =
    props.lastSession !== null
      ? (props.models.find(
          (m) => m.provider === props.lastSession?.provider && m.id === props.lastSession?.model,
        ) ?? null)
      : null;
  const canResume = props.lastSession !== null && resumeModel !== null;

  type Stage =
    | { kind: "resume-choice" }
    | { kind: "loading" }
    | { kind: "run"; sessionId?: string; seed?: string[]; fixedModel?: ModelInfo };

  const [stage, setStage] = useState<Stage>(canResume ? { kind: "resume-choice" } : { kind: "run" });
  const [error, setError] = useState<string | null>(null);

  if (stage.kind === "resume-choice" && props.lastSession !== null && resumeModel !== null) {
    const session = props.lastSession;
    const model = resumeModel;
    return (
      <ResumePicker
        lastSession={session}
        onPick={(choice) => {
          if (choice === "new") {
            setStage({ kind: "run" });
            return;
          }
          setStage({ kind: "loading" });
          props.client
            .sessionDetail(session.sessionId)
            .then((detail) => {
              if (detail === null) {
                setStage({ kind: "run" });
                return;
              }
              // Ekrana tohum: kullanıcı `> `, asistan `🤖 ` (submitSay ile aynı biçim).
              const seed = detail.messages
                .filter((m) => m.role === "user" || m.role === "assistant")
                .map((m) => (m.role === "user" ? `> ${m.content}` : `🤖 ${m.content}`));
              setStage({ kind: "run", sessionId: detail.session.sessionId, seed, fixedModel: model });
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
              setStage({ kind: "run" });
            });
        }}
      />
    );
  }

  if (stage.kind === "loading") {
    return <Text dimColor>önceki konuşma yükleniyor…</Text>;
  }

  if (stage.kind === "run") {
    return (
      <Box flexDirection="column">
        {error !== null && <Text color="red">⚠ {error}</Text>}
        <AgentRun
          client={props.client}
          agentId={props.agentId}
          cwd={props.cwd}
          models={props.models}
          onExit={props.onExit}
          initialSessionId={stage.sessionId}
          seedExchange={stage.seed}
          fixedModel={stage.fixedModel}
        />
      </Box>
    );
  }
  // Ulaşılmaz: resume-choice yalnız lastSession+resumeModel varken başlangıç durumudur.
  return <Text dimColor>yükleniyor…</Text>;
}

/**
 * `symphony` (argümansız): karşılama → persona seçici → konuşma.
 * Birleşik giriş (ADR-012, Dilim 2.3): tek "kiminle konuşmak istersin?" adımı — Sohbet
 * (araçsız, geçmiş korunur) YA DA bir agent personası (asistan/coder, araçlar izin kapısında).
 */
export function App(props: {
  client: DaemonClient;
  models: ModelInfo[];
  agents: AgentSummary[];
  providers: ProviderHealth[];
  totals: Usage;
  cwd: string;
  lastSession: HistorySessionSummary | null;
  /** Enjekte edilen profil karakter sayısı (ADR-013); null → satır gösterilmez. */
  memoryChars: number | null;
}): JSX.Element {
  const [persona, setPersona] = useState<Persona | null>(null);

  return (
    <Box flexDirection="column" padding={1}>
      <Welcome providers={props.providers} totals={props.totals} memoryChars={props.memoryChars} />
      {persona === null && <PersonaPicker agents={props.agents} onPick={setPersona} />}
      {persona?.kind === "chat" && (
        <ChatFlow client={props.client} models={props.models} lastSession={props.lastSession} />
      )}
      {persona?.kind === "agent" && (
        <AgentFlow
          client={props.client}
          agentId={persona.agent.id}
          cwd={props.cwd}
          models={props.models}
          lastSession={props.lastSession}
          // Konuşma bitince Esc → persona seçimine dön (TUI kapanmaz).
          onExit={() => setPersona(null)}
        />
      )}
    </Box>
  );
}

export async function runTui(): Promise<void> {
  const client = await connectToDaemon();
  const [{ models }, { agents }, usage, sessions] = await Promise.all([
    client.request("models.list", {}),
    client.request("agents.list", {}),
    client.request("usage.query", {}),
    // Geçmiş yoksa/başarısızsa sessizce devam et — "devam et" seçeneği gizlenir.
    client.listSessions(1).catch(() => [] as HistorySessionSummary[]),
  ]);
  if (models.length === 0) {
    console.error("Hiç model yok — önce bir sağlayıcı yapılandır (bkz. symphony status).");
    client.close();
    process.exitCode = 1;
    return;
  }
  // Aynı kural motorun enjeksiyon kontrolüyle: dosya yok/boş/yalnız iskelet → null (satır gizlenir).
  const profile = loadProfile(getSymphonyPaths().profileFile);
  const instance = render(
    <App
      client={client}
      models={models}
      agents={agents}
      providers={client.snapshot?.providers ?? []}
      totals={usage.totals}
      cwd={process.cwd()}
      lastSession={sessions[0] ?? null}
      memoryChars={profile?.text.length ?? null}
    />,
  );
  await instance.waitUntilExit();
  client.close();
}
