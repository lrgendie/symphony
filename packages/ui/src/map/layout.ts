import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { ContextMapEdge, ContextMapNode, ContextMapResponse } from "@lrgendie/shared";

/**
 * Bağlam haritası yerleşimi (ADR-016 Karar 6, Dilim Z5, TASARIM.md §3 + ADR-019 Karar 5, Dilim
 * H5): d3-force YALNIZ kuvvet-yönlü 2D konum hesaplar (simülasyon) — render kendi SVG'imizdir,
 * tesseract sahnesine bindirilmez (ayrı görünüm kararı). `layoutContextMap` SAF kalır: React/DOM
 * yok, aynı girdi + boyut HEP aynı yerleşimi üretir (başlangıç konumları DETERMİNİSTİK — indekse
 * göre çember üstünde). `startLiveLayout` (H5, "sürekli hafif drift") AYNI fizik kurallarını
 * paylaşır ama DURMAZ — bu artık SAF değildir (canlı zamanlayıcı), `TesseractScene.tsx`/
 * `LivingScene.tsx` ile AYNI "ince, test edilmeyen canlı kabuk" kategorisinde.
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

/** Hafta düğümlerinin alt kenara sabitlenme payları (ADR-019 Karar 4: "haritanın kenarına yerleşsin"). */
const WEEK_MARGIN_X = 60;
const WEEK_MARGIN_Y = 30;

/**
 * Sürekli hafif drift alpha hedefi (ADR-019 Karar 5, Dilim H5) — ASLA 0 değil: simülasyon hiç
 * tam soğumaz, düğümler komşu kuvvetlerle (charge/collide/link) yumuşakça salınmaya devam eder.
 * d3'ün varsayılan `velocityDecay` (0.4) ile dengelenmiş, görünür ama abartısız bir titreşim
 * üretecek şekilde seçildi (TASARIM §5: "her animasyonun anlamı var" — burada anlam "harita
 * canlı" hissi, performansı boğan bir süs değil).
 */
export const DRIFT_ALPHA_TARGET = 0.02;

/** Ortak kuvvet kurulumu — `layoutContextMap` (tek seferlik) ve `startLiveLayout` (sürekli, H5)
 * AYNI fiziği paylaşır; iki ayrı gerçek YOK, yalnız simülasyonun DURDURULMA biçimi farklı. */
function buildSimulation(graph: ContextMapResponse, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;
  const count = graph.nodes.length;

  // Hafta düğümleri simülasyona GİRMEZ (ADR-019 Karar 4): alt kenara kronolojik sırayla `fx/fy`
  // ile sabitlenir. `id = "week:YYYY-Www"` olduğu için düz string sıralaması kronolojiktir.
  const weekNodes = graph.nodes
    .filter((n) => n.kind === "week")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const weekIndex = new Map(weekNodes.map((n, i) => [n.id, i]));
  const bottomY = height - WEEK_MARGIN_Y;

  const simNodes: SimNode[] = graph.nodes.map((node, i) => {
    if (node.kind === "week") {
      const wi = weekIndex.get(node.id) ?? 0;
      const wc = weekNodes.length;
      const x =
        wc <= 1 ? cx : WEEK_MARGIN_X + (wi / (wc - 1)) * (width - 2 * WEEK_MARGIN_X);
      // fx/fy set edilince d3-force düğümü SABİT tutar (kuvvetler konumunu değiştirmez).
      return { ...node, x, y: bottomY, fx: x, fy: bottomY };
    }
    const angle = count > 0 ? (i / count) * Math.PI * 2 : 0;
    return { ...node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const links: SimLink[] = graph.edges
    .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(70),
    )
    .force("charge", forceManyBody().strength(-140))
    .force("center", forceCenter(cx, cy))
    .force("collide", forceCollide(20));

  return { simulation, simNodes, nodeById, cx, cy };
}

function toLayoutResult(
  graph: ContextMapResponse,
  simNodes: SimNode[],
  nodeById: Map<string, SimNode>,
  cx: number,
  cy: number,
): LayoutResult {
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

export function layoutContextMap(
  graph: ContextMapResponse,
  width: number,
  height: number,
): LayoutResult {
  const { simulation, simNodes, nodeById, cx, cy } = buildSimulation(graph, width, height);
  simulation.stop().tick(TICKS);
  return toLayoutResult(graph, simNodes, nodeById, cx, cy);
}

/**
 * CANLI yerleşim (ADR-019 Karar 5, Dilim H5, "yaşayan 2D"): `layoutContextMap`in AYNI fizik
 * kurallarıyla başlar ama DURMAZ — `alphaTarget` düşük tutulur, d3'ün kendi zamanlayıcısı
 * (rAF tabanlı) her tikte `onTick`i çağırır. `prefers-reduced-motion` tercih edildiğinde bu
 * fonksiyon HİÇ ÇAĞRILMAMALI — geri dönüş kararı `ContextMap.tsx`'e ait (bu fonksiyon kendisi
 * bir geri dönüş yolu içermez, yalnız mekanizmadır). Dönen fonksiyon simülasyonu durdurur
 * (unmount / yeniden-çekiş temizliği — `simulation.stop()` d3'ün iç zamanlayıcısını keser).
 */
export function startLiveLayout(
  graph: ContextMapResponse,
  width: number,
  height: number,
  onTick: (result: LayoutResult) => void,
): () => void {
  const { simulation, simNodes, nodeById, cx, cy } = buildSimulation(graph, width, height);
  simulation.on("tick", () => onTick(toLayoutResult(graph, simNodes, nodeById, cx, cy)));
  simulation.alphaTarget(DRIFT_ALPHA_TARGET).restart();
  return () => simulation.stop();
}
