import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { ContextMapEdge, ContextMapNode, ContextMapResponse } from "@symphony/shared";

/**
 * Bağlam haritası yerleşimi (ADR-016 Karar 6, Dilim Z5, TASARIM.md §3): d3-force YALNIZ
 * kuvvet-yönlü 2D konum hesaplar (simülasyon) — render kendi SVG'imizdir, tesseract sahnesine
 * bindirilmez (ayrı görünüm kararı). SAF: React/DOM yok, aynı girdi + boyut HEP aynı yerleşimi
 * üretir — başlangıç konumları DETERMİNİSTİK (indekse göre çember üstünde), d3'ün rastgelelik
 * ayrıntılarına bağımlı değil.
 */

export interface LayoutNode {
  id: string;
  kind: ContextMapNode["kind"];
  label: string;
  at: number;
  meta: Record<string, unknown>;
  x: number;
  y: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  kind: ContextMapEdge["kind"];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

interface SimNode extends SimulationNodeDatum, ContextMapNode {}
interface SimLink {
  source: string;
  target: string;
}

/** d3-force'un "doğal" tik sayısıyla AYNI (⌈log(alphaMin)/log(1-alphaDecay)⌉, varsayılan 300). */
const TICKS = 300;

export function layoutContextMap(
  graph: ContextMapResponse,
  width: number,
  height: number,
): LayoutResult {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;
  const count = graph.nodes.length;

  const simNodes: SimNode[] = graph.nodes.map((node, i) => {
    const angle = count > 0 ? (i / count) * Math.PI * 2 : 0;
    return { ...node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const links: SimLink[] = graph.edges
    .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));

  forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(70),
    )
    .force("charge", forceManyBody().strength(-140))
    .force("center", forceCenter(cx, cy))
    .force("collide", forceCollide(20))
    .stop()
    .tick(TICKS);

  const nodes: LayoutNode[] = simNodes.map((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.label,
    at: n.at,
    meta: n.meta,
    x: n.x ?? cx,
    y: n.y ?? cy,
  }));

  const edges: LayoutEdge[] = graph.edges.flatMap((e) => {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (from === undefined || to === undefined) return [];
    return [
      { from: e.from, to: e.to, kind: e.kind, x1: from.x ?? cx, y1: from.y ?? cy, x2: to.x ?? cx, y2: to.y ?? cy },
    ];
  });

  return { nodes, edges };
}
