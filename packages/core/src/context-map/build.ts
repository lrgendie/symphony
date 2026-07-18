import { basename } from "node:path";
import type { ContextMapResponse } from "@symphony/shared";
import { isoWeekLabel } from "../report/markdown.js";

/**
 * Bağlam haritası (ADR-016 Karar 6, Dilim Z4 + ADR-019 Karar 2/3/4, Dilim H2): SAF — SQLite'a
 * dokunmaz, girdisi daemon'un ÇOKTAN çektiği en-yeni `limit` oturum + koşu satırları VE kürasyon
 * (`map_nodes`/`map_edges`) satırlarıdır. Düğümler: session/run (ham veri) + türetilmiş proje
 * (ADR-015 Karar 1 basename kuralı) + AÇIK öğelerden türetilen model/agent düğümleri (Karar 3 —
 * yalnız açık öğelere bağlanır, hub şişmesi önlenir) + katlanmış haftalar için `week:<label>`
 * düğümü (Karar 4) + kalıcı kürasyon düğümleri (context/group, Karar 1). Kenarlar: run→proje,
 * run→model, run→agent, session→model, aynı-gün zayıf zincir (yalnız AÇIK öğeler arasında),
 * kronolojik hafta zinciri, kürasyon pin/link/member kenarları.
 */

export interface ContextMapRunInput {
  id: string;
  cwd: string;
  task: string;
  provider: string;
  model: string;
  agentId: string;
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

/** Kürasyon düğümü (ADR-019 Karar 1) — `store.listMapNodes()`in dar kesiti. */
export interface ContextMapCurationNodeInput {
  id: string;
  kind: "context" | "group";
  title: string;
  createdAt: number;
  refKind: "session" | "run" | null;
  refId: string | null;
}

/** Kürasyon kenarı (ADR-019 Karar 1) — `store.listMapEdges()`in dar kesiti. */
export interface ContextMapCurationEdgeInput {
  fromId: string;
  toId: string;
  kind: "link" | "member";
}

export interface ContextMapBuildInput {
  runs: ContextMapRunInput[];
  sessions: ContextMapSessionInput[];
  /** Vars. 500 (ADR-016 Karar 6) — sessions+runs birleşiminden en-yeni N tutulur. */
  limit?: number;
  /** Kürasyon düğümleri (ADR-019 Karar 1/2) — daemon `store.listMapNodes()`ten çeker. */
  mapNodes?: ContextMapCurationNodeInput[];
  /** Kürasyon kenarları — daemon `store.listMapEdges()`ten çeker. */
  mapEdges?: ContextMapCurationEdgeInput[];
  /** epoch ms — "şimdi" (enjekte, test fake-clock). Vars. `Date.now()`. */
  now?: number;
  /** Verilirse o ISO haftası AÇIK döner (drill-down). Vars. içinde bulunulan hafta. */
  week?: string;
  /** true ise hiçbir öğe katlanmaz (geri dönüş anahtarı, ADR-019 "Geri dönüş koşulları"). */
  flat?: boolean;
}

const DEFAULT_LIMIT = 500;

type Item =
  | { kind: "run"; input: ContextMapRunInput }
  | { kind: "session"; input: ContextMapSessionInput };

function projectNodeId(cwd: string): string {
  return `project:${cwd}`;
}
function modelNodeId(provider: string, model: string): string {
  return `model:${provider}/${model}`;
}
function agentNodeId(agentId: string): string {
  return `agent:${agentId}`;
}
function weekNodeId(label: string): string {
  return `week:${label}`;
}

/** SQLite'ın `usageQuery` gün gruplamasıyla (strftime unixepoch, UTC) AYNI takvim günü tanımı. */
function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export function buildContextMap(input: ContextMapBuildInput): ContextMapResponse {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const now = input.now ?? Date.now();
  const mapNodes = input.mapNodes ?? [];
  const mapEdges = input.mapEdges ?? [];
  const flat = input.flat === true;
  const openWeek = input.week ?? isoWeekLabel(now);

  const allItems: Item[] = [
    ...input.runs.map((run): Item => ({ kind: "run", input: run })),
    ...input.sessions.map((session): Item => ({ kind: "session", input: session })),
  ].sort((a, b) => b.input.at - a.input.at);

  // Sabitlenmiş öğe = bir `context` kürasyon düğümünün ref'lediği session/run — ASLA katlanmaz
  // (ADR-019 Karar 4, istisna a: insan emeği hep görünür).
  const pinnedIds = new Set(
    mapNodes.filter((n) => n.kind === "context" && n.refId !== null).map((n) => n.refId as string),
  );

  // Y6: `limit` en-yeni N'i tutar ama bir pin ÇOK eskiyse kesitin dışında kalıp "yetim" (grafiksiz)
  // hâle gelebilirdi — sabitlenmiş öğe kesit dışında kalsa bile GERİ EKLENİR (ADR-019 Karar 4).
  const withinLimit = allItems.slice(0, limit);
  const withinLimitIds = new Set(withinLimit.map((i) => i.input.id));
  const pinnedButCut = allItems.filter(
    (i) => pinnedIds.has(i.input.id) && !withinLimitIds.has(i.input.id),
  );
  const items = [...withinLimit, ...pinnedButCut];

  const isOpen = (item: Item): boolean =>
    flat || pinnedIds.has(item.input.id) || isoWeekLabel(item.input.at) === openWeek;

  const openItems = items.filter(isOpen);
  const foldedItems = items.filter((item) => !isOpen(item));

  const nodes: ContextMapResponse["nodes"] = [];
  const edges: ContextMapResponse["edges"] = [];
  const projectLatestAt = new Map<string, number>();
  const modelLatestAt = new Map<string, { provider: string; model: string; at: number }>();
  const agentLatestAt = new Map<string, number>();

  for (const item of openItems) {
    if (item.kind === "session") {
      const session = item.input;
      nodes.push({
        id: session.id,
        kind: "session",
        label: session.title,
        at: session.at,
        meta: { provider: session.provider, model: session.model },
      });
      const mId = modelNodeId(session.provider, session.model);
      edges.push({ from: session.id, to: mId, kind: "model" });
      const known = modelLatestAt.get(mId);
      if (known === undefined || session.at > known.at) {
        modelLatestAt.set(mId, { provider: session.provider, model: session.model, at: session.at });
      }
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
    const mId = modelNodeId(run.provider, run.model);
    edges.push({ from: run.id, to: mId, kind: "model" });
    edges.push({ from: run.id, to: agentNodeId(run.agentId), kind: "agent" });

    const knownProject = projectLatestAt.get(run.cwd);
    if (knownProject === undefined || run.at > knownProject) projectLatestAt.set(run.cwd, run.at);
    const knownModel = modelLatestAt.get(mId);
    if (knownModel === undefined || run.at > knownModel.at) {
      modelLatestAt.set(mId, { provider: run.provider, model: run.model, at: run.at });
    }
    const knownAgent = agentLatestAt.get(run.agentId);
    if (knownAgent === undefined || run.at > knownAgent) agentLatestAt.set(run.agentId, run.at);
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
  for (const [mId, info] of modelLatestAt) {
    nodes.push({
      id: mId,
      kind: "model",
      label: `${info.provider}/${info.model}`,
      at: info.at,
      meta: {
        provider: info.provider,
        model: info.model,
        origin: info.provider === "ollama" ? "local" : "api",
      },
    });
  }
  for (const [agentId, at] of agentLatestAt) {
    nodes.push({ id: agentNodeId(agentId), kind: "agent", label: agentId, at, meta: { agentId } });
  }

  // Aynı-gün komşuluğu: proje/model/agent düğümleri HARİÇ, yalnız AÇIK öğeler arasında —
  // zamanda ARTAN sırayla ardışık öğeler aynı takvim gününe düşüyorsa zayıf kenar.
  const chronological = [...openItems].sort((a, b) => a.input.at - b.input.at);
  for (let i = 1; i < chronological.length; i++) {
    const prev = chronological[i - 1];
    const curr = chronological[i];
    if (prev !== undefined && curr !== undefined && dayKey(prev.input.at) === dayKey(curr.input.at)) {
      edges.push({ from: prev.input.id, to: curr.input.id, kind: "same_day" });
    }
  }

  // Haftalık katlanma (ADR-019 Karar 4): AÇIK olmayan öğeler tek tek girmez, hafta başına TEK
  // düğüm (meta: oturum/koşu sayısı, kullanılan modeller) + kronolojik `week` kenar zinciri.
  const weekGroups = new Map<
    string,
    { sessionCount: number; runCount: number; models: Set<string>; at: number }
  >();
  for (const item of foldedItems) {
    const label = isoWeekLabel(item.input.at);
    const group = weekGroups.get(label) ?? {
      sessionCount: 0,
      runCount: 0,
      models: new Set<string>(),
      at: item.input.at,
    };
    if (item.kind === "session") group.sessionCount += 1;
    else group.runCount += 1;
    group.models.add(`${item.input.provider}/${item.input.model}`);
    group.at = Math.max(group.at, item.input.at);
    weekGroups.set(label, group);
  }
  const weekLabels = [...weekGroups.keys()].sort();
  for (const label of weekLabels) {
    const group = weekGroups.get(label);
    if (group === undefined) continue;
    nodes.push({
      id: weekNodeId(label),
      kind: "week",
      label,
      at: group.at,
      meta: {
        sessionCount: group.sessionCount,
        runCount: group.runCount,
        models: [...group.models].sort(),
      },
    });
  }
  for (let i = 1; i < weekLabels.length; i++) {
    const prevLabel = weekLabels[i - 1];
    const currLabel = weekLabels[i];
    if (prevLabel !== undefined && currLabel !== undefined) {
      edges.push({ from: weekNodeId(prevLabel), to: weekNodeId(currLabel), kind: "week" });
    }
  }

  // Kürasyon bindirmesi (ADR-019 Karar 1/2): context/group düğümleri BİREBİR eklenir — tarihsizdir,
  // katlanmadan HER ZAMAN görünür. Ref'li context'ten ref'lediği öğeye "pin" kenarı çizilir.
  for (const mapNode of mapNodes) {
    nodes.push({
      id: mapNode.id,
      kind: mapNode.kind,
      label: mapNode.title,
      at: mapNode.createdAt,
      meta: mapNode.refKind !== null ? { refKind: mapNode.refKind, refId: mapNode.refId } : {},
    });
    if (mapNode.kind === "context" && mapNode.refId !== null) {
      edges.push({ from: mapNode.id, to: mapNode.refId, kind: "pin" });
    }
  }
  for (const mapEdge of mapEdges) {
    edges.push({ from: mapEdge.fromId, to: mapEdge.toId, kind: mapEdge.kind });
  }

  // Görünüm güvenliği (veri bütünlüğü DEĞİL): bir ucu grafta yer almayan kenar (ör. katlanmış bir
  // öğeye context ref'i OLMADAN doğrudan üyelik) SVG'de kırık çizgi olarak görünmesin diye düşer.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const safeEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodes, edges: safeEdges };
}
