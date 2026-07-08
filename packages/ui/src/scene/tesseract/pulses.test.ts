import { describe, expect, it } from "vitest";
import { buildTesseract } from "./geometry.js";
import {
  advancePulses,
  createPulseSystem,
  fireConverge,
  HARD_CAP,
  MAX_PULSES,
  type PulseSystem,
} from "./pulses.js";

/**
 * Atım sistemi saf ve rng-enjekteli → deterministik test. Doğum oranı, ilerleme, emeklilik,
 * üç kademeli converge şelalesi ve çekirdek varış sayımı (coreHits) burada; render kopyası
 * TesseractScene'de.
 */

const EDGES = buildTesseract().edges;

function freshSystem(): PulseSystem {
  return createPulseSystem(EDGES);
}

/** Sabit dizi döndüren deterministik rng (döngüsel). */
function seqRng(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("createPulseSystem havuzları", () => {
  it("synapse = iç + bağ + derin (32); energy = dış + köprü (20); kademeler 8'er", () => {
    const sys = freshSystem();
    expect(sys.synapseEdges).toHaveLength(32);
    expect(sys.energyEdges).toHaveLength(20);
    expect(sys.bridgeEdges).toHaveLength(8);
    expect(sys.linkEdges).toHaveLength(8);
    expect(sys.spokeEdges).toHaveLength(8);
  });
});

describe("advancePulses", () => {
  it("oran 0 → hiç atım doğmaz", () => {
    const sys = freshSystem();
    advancePulses(sys, 1, { synapse: 0, energy: 0 }, seqRng([0.5]));
    expect(sys.pulses).toHaveLength(0);
  });

  it("oran birikimli doğum: 2 atım/sn × 1sn = 2 sinaps atımı, doğru havuzdan", () => {
    const sys = freshSystem();
    advancePulses(sys, 1, { synapse: 2, energy: 0 }, seqRng([0.1, 0.6, 0.9]));
    expect(sys.pulses).toHaveLength(2);
    for (const p of sys.pulses) {
      expect(p.kind).toBe("synapse");
      expect(sys.synapseEdges).toContain(p.edge);
    }
  });

  it("atım ilerler ve t≥1 olunca emekli olur", () => {
    const sys = freshSystem();
    // rng=0 → havuzun ilk kenarı, dir=+1 (0<0.5), hız = min (1.1). Doğum hareketten SONRA:
    // aynı adımda doğup emekli olamaz.
    advancePulses(sys, 1, { synapse: 1, energy: 0 }, seqRng([0]));
    expect(sys.pulses).toHaveLength(1);
    const before = sys.pulses[0]?.t ?? -1;
    advancePulses(sys, 0.1, { synapse: 0, energy: 0 }, seqRng([0]));
    expect(sys.pulses[0]?.t ?? 0).toBeGreaterThan(before);
    advancePulses(sys, 1, { synapse: 0, energy: 0 }, seqRng([0])); // 1.1·1 > 1 → emekli
    expect(sys.pulses).toHaveLength(0);
  });

  it("rastgele doğum MAX_PULSES tavanını aşamaz", () => {
    const sys = freshSystem();
    for (let i = 0; i < 30; i++) {
      advancePulses(sys, 1, { synapse: 200, energy: 200 }, seqRng([0.3, 0.7]));
    }
    expect(sys.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
  });
});

describe("fireConverge üç kademeli şelale", () => {
  it("24 atım: 8 köprü (t=0) + 8 bağ (gecikmeli) + 8 spoke (daha gecikmeli); hepsi merkeze (dir=+1)", () => {
    const sys = freshSystem();
    fireConverge(sys);
    expect(sys.pulses).toHaveLength(24);
    const bridges = sys.pulses.filter((p) => sys.bridgeEdges.includes(p.edge));
    const links = sys.pulses.filter((p) => sys.linkEdges.includes(p.edge));
    const spokes = sys.pulses.filter((p) => sys.spokeSet.has(p.edge));
    expect(bridges).toHaveLength(8);
    expect(links).toHaveLength(8);
    expect(spokes).toHaveLength(8);
    for (const p of bridges) expect(p.t).toBe(0);
    for (const p of links) expect(p.t).toBeLessThan(0);
    for (const p of spokes) {
      const linkT = links[0]?.t ?? 0;
      expect(p.t).toBeLessThan(linkT); // spoke, bağdan da geç başlar
    }
    for (const p of sys.pulses) {
      expect(p.kind).toBe("converge");
      expect(p.dir).toBe(1);
    }
  });

  it("tüm spoke atımları çekirdeğe varınca toplam 8 coreHit sayılır ve salvo tamamen emekli olur", () => {
    const sys = freshSystem();
    fireConverge(sys);
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      hits += advancePulses(sys, 0.05, { synapse: 0, energy: 0 }, seqRng([0.5])).coreHits;
    }
    expect(hits).toBe(8);
    expect(sys.pulses).toHaveLength(0);
  });

  it("köprü/bağ varışları coreHit SAYILMAZ (yalnız spoke → çekirdek)", () => {
    const sys = freshSystem();
    fireConverge(sys);
    // 0.5sn: köprüler (2.2·0.5=1.1) varıp emekli; bağlar (t=-0.5+1.3=0.8) ve
    // spoke'lar (t=-1.0+1.5=0.5) hâlâ yolda → hit yok.
    const r1 = advancePulses(sys, 0.5, { synapse: 0, energy: 0 }, seqRng([0.5]));
    expect(r1.coreHits).toBe(0);
    expect(sys.pulses.length).toBe(16);
  });

  it("sistem doygunsa salvo atlanır (HARD_CAP korunur)", () => {
    const sys = freshSystem();
    while (sys.pulses.length < HARD_CAP - 8) {
      sys.pulses.push({ edge: 0, dir: 1, t: 0, speed: 0.01, kind: "synapse" });
    }
    fireConverge(sys);
    expect(sys.pulses.length).toBe(HARD_CAP - 8); // 24'lük salvo sığmazdı → atlandı
  });
});
