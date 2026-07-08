/**
 * Sinaps atım sistemi — SAF (React/Three.js YOK); rastgelelik enjekte edilir (rng) →
 * deterministik birim test. Atım bir kenar üzerinde t∈[0,1] ilerler (dir: +1 a→b, -1 b→a).
 * İki sürekli tür: "synapse" (iç ağ + bağlar + derin kafes — LLM/ajan aktivitesi) ve
 * "energy" (bakır iskelet: dış küp + köprüler — GPU yükü). "converge" salvosu (görev
 * bitti / kritik an) ÜÇ KADEMELİ şelaledir: köprüler İÇERİ → (gecikmeli) bağlar DERİNE →
 * (daha gecikmeli) spoke'lar MERKEZE; çekirdeğe varış coreHits olarak raporlanır
 * (çekirdek patlamasını TesseractScene enerjiye çevirir).
 * TASARIM.md §2 — her atımın anlamı var; süs değil.
 */

import type { TesseractEdge } from "./geometry";

export type PulseKind = "synapse" | "energy" | "converge";

export interface Pulse {
  /** Kenar id'si (topology.edges dizini). */
  edge: number;
  /** +1 = a→b, -1 = b→a. Converge daima +1 (kenarlar merkeze doğru sıralı, geometry.ts). */
  dir: 1 | -1;
  /** Yol parametresi; NEGATİF başlangıç = gecikme (henüz görünmez), ≥1 = emekli. */
  t: number;
  /** İlerleme hızı (t birimi/sn). */
  speed: number;
  kind: PulseKind;
}

export interface SpawnRates {
  /** atım/sn — iç sinaps ağı (inner + link + deep kenarları). */
  synapse: number;
  /** atım/sn — bakır iskelet (outer + bridge kenarları). */
  energy: number;
}

/** Rastgele doğan atımların üst sınırı (converge salvosu HARD_CAP'e dek taşabilir). */
export const MAX_PULSES = 240;
/** Mutlak tavan — render arabelleği bu kadar atıma göre ayrılır. */
export const HARD_CAP = 320;

const SYNAPSE_SPEED_MIN = 1.1;
const SYNAPSE_SPEED_MAX = 2.4;
const ENERGY_SPEED_MIN = 0.4;
const ENERGY_SPEED_MAX = 0.95;
const CONVERGE_BRIDGE_SPEED = 2.2;
const CONVERGE_LINK_SPEED = 2.6;
const CONVERGE_SPOKE_SPEED = 3.0;
/** Kademeler önceki dalganın varışını beklesin diye negatif t (gecikme) ile başlar. */
const CONVERGE_LINK_START_T = -0.5;
const CONVERGE_SPOKE_START_T = -1.0;

/** [0,1) döndüren rastgelelik kaynağı (testte deterministik verilir). */
export type Rng = () => number;

export interface PulseSystem {
  readonly pulses: Pulse[];
  /** Doğum havuzları (kenar id listeleri) — kind → hangi kenarlarda doğabilir. */
  readonly synapseEdges: readonly number[];
  readonly energyEdges: readonly number[];
  readonly bridgeEdges: readonly number[];
  readonly linkEdges: readonly number[];
  readonly spokeEdges: readonly number[];
  /** Spoke kenarı hızlı üyelik testi (coreHits sayımı). */
  readonly spokeSet: ReadonlySet<number>;
  /** Oran-birikimli doğum sayaçları (rate·dt birikir; ≥1 olunca doğum). */
  readonly spawnAcc: { synapse: number; energy: number };
}

export function createPulseSystem(edges: readonly TesseractEdge[]): PulseSystem {
  const synapseEdges: number[] = [];
  const energyEdges: number[] = [];
  const bridgeEdges: number[] = [];
  const linkEdges: number[] = [];
  const spokeEdges: number[] = [];
  for (const e of edges) {
    if (e.kind === "inner" || e.kind === "link" || e.kind === "deep") synapseEdges.push(e.id);
    if (e.kind === "outer" || e.kind === "bridge") energyEdges.push(e.id);
    if (e.kind === "bridge") bridgeEdges.push(e.id);
    if (e.kind === "link") linkEdges.push(e.id);
    if (e.kind === "spoke") spokeEdges.push(e.id);
  }
  return {
    pulses: [],
    synapseEdges,
    energyEdges,
    bridgeEdges,
    linkEdges,
    spokeEdges,
    spokeSet: new Set(spokeEdges),
    spawnAcc: { synapse: 0, energy: 0 },
  };
}

function spawnRandom(
  sys: PulseSystem,
  pool: readonly number[],
  kind: PulseKind,
  speedMin: number,
  speedMax: number,
  rng: Rng,
): void {
  if (pool.length === 0 || sys.pulses.length >= MAX_PULSES) return;
  const edge = pool[Math.floor(rng() * pool.length) % pool.length] ?? 0;
  const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  sys.pulses.push({ edge, dir, t: 0, speed: speedMin + rng() * (speedMax - speedMin), kind });
}

/**
 * Converge salvosu — ÜÇ KADEMELİ şelale: TÜM köprüler içeri (t=0), TÜM bağlar derine
 * (gecikmeli), TÜM spoke'lar merkeze (daha gecikmeli); hepsi dir=+1 (kenarlar merkeze sıralı).
 * Sistem doygunsa (tavan aşılacaksa) salvo atlanır — görsel zaten doymuş demektir.
 */
export function fireConverge(sys: PulseSystem): void {
  const salvoSize = sys.bridgeEdges.length + sys.linkEdges.length + sys.spokeEdges.length;
  if (sys.pulses.length + salvoSize > HARD_CAP) return;
  for (const edge of sys.bridgeEdges) {
    sys.pulses.push({ edge, dir: 1, t: 0, speed: CONVERGE_BRIDGE_SPEED, kind: "converge" });
  }
  for (const edge of sys.linkEdges) {
    sys.pulses.push({
      edge,
      dir: 1,
      t: CONVERGE_LINK_START_T,
      speed: CONVERGE_LINK_SPEED,
      kind: "converge",
    });
  }
  for (const edge of sys.spokeEdges) {
    sys.pulses.push({
      edge,
      dir: 1,
      t: CONVERGE_SPOKE_START_T,
      speed: CONVERGE_SPOKE_SPEED,
      kind: "converge",
    });
  }
}

export interface AdvanceResult {
  /** Bu adımda çekirdeğe VARAN converge atımı sayısı (çekirdek patlaması sürücüsü). */
  coreHits: number;
}

/**
 * dt saniye ilerletir: ÖNCE hareket + emeklilik (t≥1, swap-pop), SONRA oran-birikimli doğum
 * (rate·dt) — yeni doğan atım t=0'da kalır, bir sonraki adımda yürür (aynı adımda doğup
 * emekli olamaz). Spoke üzerindeki converge atımı 1'e varınca coreHits sayılır.
 */
export function advancePulses(
  sys: PulseSystem,
  dt: number,
  rates: SpawnRates,
  rng: Rng,
): AdvanceResult {
  let coreHits = 0;
  // Geriden ileri yürü: emekliyi son elemanla değiş-tokuş edip pop'la (GC'siz, sıra önemsiz).
  for (let i = sys.pulses.length - 1; i >= 0; i--) {
    const p = sys.pulses[i];
    if (p === undefined) continue;
    p.t += p.speed * dt;
    if (p.t >= 1) {
      if (p.kind === "converge" && sys.spokeSet.has(p.edge)) coreHits += 1;
      const last = sys.pulses.pop();
      if (last !== undefined && i < sys.pulses.length) sys.pulses[i] = last;
    }
  }

  sys.spawnAcc.synapse += Math.max(0, rates.synapse) * dt;
  sys.spawnAcc.energy += Math.max(0, rates.energy) * dt;
  while (sys.spawnAcc.synapse >= 1) {
    spawnRandom(sys, sys.synapseEdges, "synapse", SYNAPSE_SPEED_MIN, SYNAPSE_SPEED_MAX, rng);
    sys.spawnAcc.synapse -= 1;
  }
  while (sys.spawnAcc.energy >= 1) {
    spawnRandom(sys, sys.energyEdges, "energy", ENERGY_SPEED_MIN, ENERGY_SPEED_MAX, rng);
    sys.spawnAcc.energy -= 1;
  }
  return { coreHits };
}
