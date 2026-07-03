import { readFileSync } from "node:fs";
import chalk from "chalk";
import {
  HistorySessionDetailResponseSchema,
  HistorySessionsResponseSchema,
  type HistorySessionSummary,
} from "@symphony/shared";
import { getSymphonyPaths } from "@symphony/core";
import { ensureDaemonRunning } from "../client/daemon-client.js";

/**
 * `symphony history [oturum]` — kalıcı sohbet geçmişi. Geçmiş REST ile
 * sorgulanır (PROTOKOL §1.1); cevap shared şemalarıyla doğrulanır (kural 1).
 * Oturum argümanı id'nin benzersiz bir ÖN EKİ olabilir (kısa id kolaylığı).
 */

async function fetchHistory(path: string): Promise<unknown> {
  const { port } = await ensureDaemonRunning();
  const token = readFileSync(getSymphonyPaths().daemonTokenFile, "utf8").trim();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Geçmiş sorgusu başarısız (HTTP ${response.status})`);
  }
  return response.json();
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}

async function listSessions(): Promise<void> {
  const data = HistorySessionsResponseSchema.parse(await fetchHistory("/api/history/sessions"));
  if (data.sessions.length === 0) {
    console.log(chalk.dim("henüz kayıtlı sohbet yok — `symphony` ile bir sohbet başlat"));
    return;
  }
  console.log(chalk.bold(`🎼 Son sohbetler (${data.sessions.length})`));
  for (const session of data.sessions) {
    console.log(
      `  ${chalk.cyan(session.sessionId.slice(0, 8))} · ${session.provider}/${session.model}` +
        ` · ${session.messageCount} mesaj · ${chalk.dim(formatTime(session.updatedAt))}`,
    );
    if (session.title.length > 0) console.log(`           ${chalk.dim(`"${session.title}"`)}`);
  }
  console.log(chalk.dim("\nDöküm için: symphony history <oturum-id (ön ek yeter)>"));
}

async function resolveSession(prefix: string): Promise<HistorySessionSummary> {
  const data = HistorySessionsResponseSchema.parse(
    await fetchHistory("/api/history/sessions?limit=500"),
  );
  const matches = data.sessions.filter((s) => s.sessionId.startsWith(prefix));
  if (matches.length === 0) throw new Error(`'${prefix}' ile başlayan oturum yok`);
  const first = matches[0];
  if (matches.length > 1 || first === undefined) {
    throw new Error(
      `'${prefix}' birden çok oturuma uyuyor: ${matches.map((s) => s.sessionId.slice(0, 12)).join(", ")}`,
    );
  }
  return first;
}

async function showSession(prefix: string): Promise<void> {
  const session = await resolveSession(prefix);
  const data = HistorySessionDetailResponseSchema.parse(
    await fetchHistory(`/api/history/sessions/${session.sessionId}`),
  );
  console.log(
    chalk.bold(`🎼 ${data.session.provider}/${data.session.model}`) +
      chalk.dim(` · ${data.session.sessionId} · ${formatTime(data.session.updatedAt)}`),
  );
  for (const message of data.messages) {
    const label =
      message.role === "user"
        ? chalk.cyan.bold("sen")
        : message.role === "assistant"
          ? chalk.green.bold(data.session.model)
          : chalk.yellow.bold("system");
    console.log(`\n${label} ${chalk.dim(formatTime(message.at))}`);
    console.log(message.content);
  }
  console.log();
}

export async function historyCommand(sessionPrefix?: string): Promise<void> {
  if (sessionPrefix === undefined) await listSessions();
  else await showSession(sessionPrefix);
}
