import { describe, expect, it } from "vitest";
import {
  BASE_SCALE,
  buildTesseract,
  DEEP_SCALE,
  PROJECT_K,
  projectNodes,
} from "./geometry.js";

/**
 * Tesseract topolojisi ve 4B projeksiyonu saf matematik — burada DOM/WebGL olmadan doğrulanır.
 * TesseractScene yalnız bu çıktıyı matrislere/attribute'lara kopyalar (görsel doğrulama kullanıcıya).
 */

describe("buildTesseract topolojisi (üç kademeli küp)", () => {
  const topo = buildTesseract();

  it("25 düğüm: 8 dış + 8 iç + 8 derin + 1 çekirdek (id = dizin)", () => {
    expect(topo.nodes).toHaveLength(25);
    expect(topo.nodes.filter((n) => n.layer === "outer")).toHaveLength(8);
    expect(topo.nodes.filter((n) => n.layer === "inner")).toHaveLength(8);
    expect(topo.nodes.filter((n) => n.layer === "deep")).toHaveLength(8);
    expect(topo.nodes.filter((n) => n.layer === "core")).toHaveLength(1);
    for (const [i, n] of topo.nodes.entries()) expect(n.id).toBe(i);
  });

  it("60 kenar: 12 dış + 12 iç + 12 derin + 8 köprü + 8 bağ + 8 spoke", () => {
    expect(topo.edges).toHaveLength(60);
    expect(topo.edges.filter((e) => e.kind === "outer")).toHaveLength(12);
    expect(topo.edges.filter((e) => e.kind === "inner")).toHaveLength(12);
    expect(topo.edges.filter((e) => e.kind === "deep")).toHaveLength(12);
    expect(topo.edges.filter((e) => e.kind === "bridge")).toHaveLength(8);
    expect(topo.edges.filter((e) => e.kind === "link")).toHaveLength(8);
    expect(topo.edges.filter((e) => e.kind === "spoke")).toHaveLength(8);
  });

  it("dış/iç küp kenarları tam BİR eksende ayrışan köşeleri bağlar", () => {
    for (const e of topo.edges.filter((x) => x.kind === "outer" || x.kind === "inner")) {
      const a = topo.nodes[e.a]?.base4;
      const b = topo.nodes[e.b]?.base4;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined || a === null || b === null) continue;
      const diffs = [0, 1, 2].filter((i) => a[i] !== b[i]).length;
      expect(diffs).toBe(1);
      expect(a[3]).toBe(b[3]); // aynı küpte (w eşit)
    }
  });

  it("derin küp kenarları da tek-bit komşuluğu izler (çapa bitleri üzerinden)", () => {
    for (const e of topo.edges.filter((x) => x.kind === "deep")) {
      expect(topo.nodes[e.a]?.layer).toBe("deep");
      expect(topo.nodes[e.b]?.layer).toBe("deep");
      const xor = (e.a - 16) ^ (e.b - 16);
      expect([1, 2, 4]).toContain(xor); // tek bit farkı
    }
  });

  it("akış zinciri merkeze-doğru sıralı: köprü dış→iç, bağ iç→derin, spoke derin→çekirdek", () => {
    for (const e of topo.edges.filter((x) => x.kind === "bridge")) {
      const a = topo.nodes[e.a];
      const b = topo.nodes[e.b];
      expect(a?.layer).toBe("outer");
      expect(b?.layer).toBe("inner");
      expect(a?.base4?.slice(0, 3)).toEqual(b?.base4?.slice(0, 3)); // köşe-eşleşmeli
    }
    for (const e of topo.edges.filter((x) => x.kind === "link")) {
      expect(topo.nodes[e.a]?.layer).toBe("inner");
      expect(topo.nodes[e.b]?.layer).toBe("deep");
      expect(topo.nodes[e.b]?.anchor).toBe(e.a); // derin köşe, bağlandığı iç köşeyi izler
    }
    const spokes = topo.edges.filter((x) => x.kind === "spoke");
    expect(new Set(spokes.map((e) => e.a)).size).toBe(8);
    for (const e of spokes) {
      expect(topo.nodes[e.a]?.layer).toBe("deep");
      expect(topo.nodes[e.b]?.layer).toBe("core");
    }
  });
});

describe("projectNodes 4B projeksiyonu", () => {
  const topo = buildTesseract();
  const out = new Float32Array(topo.nodes.length * 3);

  it("hiper-açı 0: dış küp 1.5×, iç küp 0.75× ölçekte; çekirdek origin'de", () => {
    projectNodes(topo, 0, 1, out);
    const outerF = (PROJECT_K / (PROJECT_K - 1)) * BASE_SCALE; // 1.5 × ölçek
    const innerF = (PROJECT_K / (PROJECT_K + 1)) * BASE_SCALE; // 0.75 × ölçek
    for (const n of topo.nodes) {
      const o = n.id * 3;
      if (n.layer === "outer" || n.layer === "inner") {
        const f = n.layer === "outer" ? outerF : innerF;
        expect(Math.abs(out[o] ?? 0)).toBeCloseTo(f, 5);
        expect(Math.abs(out[o + 1] ?? 0)).toBeCloseTo(f, 5);
        expect(Math.abs(out[o + 2] ?? 0)).toBeCloseTo(f, 5);
      }
    }
    const core = topo.nodes[24];
    expect(core?.layer).toBe("core");
    expect(out[72]).toBe(0);
    expect(out[73]).toBe(0);
    expect(out[74]).toBe(0);
  });

  it("derin köşe = iç köşe × DEEP_SCALE (hiper-dönüş ve şişme altında da)", () => {
    projectNodes(topo, 0.2, 1.1, out);
    for (const n of topo.nodes.filter((x) => x.layer === "deep")) {
      if (n.anchor === null) continue;
      const o = n.id * 3;
      const ao = n.anchor * 3;
      expect(out[o]).toBeCloseTo((out[ao] ?? 0) * DEEP_SCALE, 5);
      expect(out[o + 1]).toBeCloseTo((out[ao + 1] ?? 0) * DEEP_SCALE, 5);
      expect(out[o + 2]).toBeCloseTo((out[ao + 2] ?? 0) * DEEP_SCALE, 5);
    }
  });

  it("innerSwell yalnız iç+derin katmanı şişirir; dış küp değişmez", () => {
    const plain = new Float32Array(out.length);
    const swollen = new Float32Array(out.length);
    projectNodes(topo, 0, 1, plain);
    projectNodes(topo, 0, 1.2, swollen);
    for (const n of topo.nodes) {
      const o = n.id * 3;
      if (n.layer === "outer") {
        expect(swollen[o]).toBeCloseTo(plain[o] ?? 0, 6);
      } else if (n.layer === "inner" || n.layer === "deep") {
        expect(Math.abs(swollen[o] ?? 0)).toBeCloseTo(Math.abs(plain[o] ?? 0) * 1.2, 5);
      }
    }
  });

  it("hiper-dönüş altında tüm pozisyonlar sonlu kalır (salınım aralığı ±0.38 rad)", () => {
    for (const angle of [-0.38, -0.1, 0.1, 0.38]) {
      projectNodes(topo, angle, 1.15, out);
      for (const v of out) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
