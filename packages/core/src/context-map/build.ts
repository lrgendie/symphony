import { basename } from "node:path";
import type { ContextMapResponse } from "@symphony/shared";

/**
 * Bağlam haritası (ADR-016 Karar 6, Dilim Z4): SAF — SQLite'a dokunmaz, girdisi daemon'un
 * ÇOKTAN çektiği en-yeni `limit` oturum + koşu satırlarıdır. Düğümler: session/run (ham veri)
 * + run.cwd'den türetilen sanal proje düğümleri (ADR-015 Karar 1 basename kuralı — `ui/store.ts
 * groupRunsByProject` ile AYNI fikir, ayrı katman). Kenarlar: run→proje (kind:"project") +
 * aynı takvim gününde ARDIŞIK öğeler arasında zayıf zincir (kind:"same_day" — tüm çiftler
 * DEĞİL, "compound" hissinin kaynağı). Model bağı kenar DEĞİL — düğüm meta'sında (görsel kanal,
 * ADR-016 Karar 6: her şeyin tek modele bağlandığı çöp graf önlenir).
 */

export interface ContextMapRunInput {
  id: string;
  cwd: string;
  task: string;
  provider: string;
  model: string;
  /** epoch ms — koşu başlangıcı */
  at: number;
}

export interface ContextMapSessionInput {
  id: string;
  title: string;
  provider: string;
  model: string;
  /** epoch ms — oturumun son güncellenme zamanı */
  at: number;
}

export interface ContextMapBuildInput {
  runs: ContextMapRunInput[];
  sessions: ContextMapSessionInput[];
  /** Vars. 500 (ADR-016 Karar 6) — sessions+runs birleşiminden en-yeni N tutulur. */
  limit?: number;
}

const DEFAULT_LIMIT = 500;

type Item =
  | { kind: "run"; input: ContextMapRunInput }
  | { kind: "session"; input: ContextMapSessionInput };

function projectNodeId(cwd: string): string {
  return `project:${cwd}`;
}

/** SQLite'ın `usageQuery` gün gruplamasıyla (strftime unixepoch, UTC) AYNI takvim günü tanımı. */
function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function buildContextMap(input: ContextMapBuildInput): ContextMapResponse {
  const limit = input.limit ?? DEFAULT_LIMIT;

  const items: Item[] = [
    ...input.runs.map((run): Item => ({ kind: "run", input: run })),
    ...input.sessions.map((session): Item => ({ kind: "session", input: session })),
  ]
    .sort((a, b) => b.input.at - a.input.at)
    .slice(0, limit);

  const nodes: ContextMapResponse["nodes"] = [];
  const edges: ContextMapResponse["edges"] = [];
  const projectLatestAt = new Map<string, number>();

  for (const item of items) {
    if (item.kind === "session") {
      nodes.push({
        id: item.input.id,
        kind: "session",
        label: item.input.title,
        at: item.input.at,
        meta: { provider: item.input.provider, model: item.input.model },
      });
      continue;
    }
    const run = item.input;
    nodes.push({
      id: run.id,
      kind: "run",
      label: run.task,
      at: run.at,
      meta: { provider: run.provider, model: run.model, cwd: run.cwd },
    });
    edges.push({ from: run.id, to: projectNodeId(run.cwd), kind: "project" });
    const known = projectLatestAt.get(run.cwd);
    if (known === undefined || run.at > known) projectLatestAt.set(run.cwd, run.at);
  }

  for (const [cwd, at] of projectLatestAt) {
    nodes.push({
      id: projectNodeId(cwd),
      kind: "project",
      label: cwd === "" ? "diğer" : basename(cwd),
      at,
      meta: { cwd },
    });
  }

  // Aynı-gün komşuluğu: proje düğümleri HARİÇ, zamanda ARTAN sırayla ardışık öğeler aynı
  // takvim gününe düşüyorsa zayıf kenar (tüm çiftler değil — bir zincir).
  const chronological = [...items].sort((a, b) => a.input.at - b.input.at);
  for (let i = 1; i < chronological.length; i++) {
    const prev = chronological[i - 1];
    const curr = chronological[i];
    if (prev !== undefined && curr !== undefined && dayKey(prev.input.at) === dayKey(curr.input.at)) {
      edges.push({ from: prev.input.id, to: curr.input.id, kind: "same_day" });
    }
  }

  return { nodes, edges };
}
