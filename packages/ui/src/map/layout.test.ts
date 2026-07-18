import { describe, expect, it } from "vitest";
import type { ContextMapResponse } from "@lrgendie/shared";
import { layoutContextMap } from "./layout";

function graph(overrides: Partial<ContextMapResponse> = {}): ContextMapResponse {
  return {
    nodes: [
      { id: "s1", kind: "session", label: "sohbet", at: 1_000, meta: {} },
      { id: "r1", kind: "run", label: "koşu", at: 2_000, meta: { cwd: "/a" } },
      { id: "p1", kind: "project", label: "a", at: 2_000, meta: { cwd: "/a" } },
    ],
    edges: [{ from: "r1", to: "p1", kind: "project" }],
    ...overrides,
  };
}

describe("layoutContextMap (ADR-016 Karar 6, Dilim Z5) — SAF, deterministik", () => {
  it("boş graf → boş yerleşim", () => {
    expect(layoutContextMap({ nodes: [], edges: [] }, 800, 600)).toEqual({ nodes: [], edges: [] });
  });

  it("her düğüm için sonlu x/y üretir; id/kind/label/at/meta DEĞİŞMEZ aktarılır", () => {
    const result = layoutContextMap(graph(), 800, 600);
    expect(result.nodes).toHaveLength(3);
    for (const n of result.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    const run = result.nodes.find((n) => n.id === "r1");
    expect(run).toMatchObject({ kind: "run", label: "koşu", at: 2_000, meta: { cwd: "/a" } });
  });

  it("kenar uçlarının x1/y1/x2/y2'si İLGİLİ düğümlerin konumuyla eşleşir", () => {
    const result = layoutContextMap(graph(), 800, 600);
    const p1 = result.nodes.find((n) => n.id === "p1");
    const r1 = result.nodes.find((n) => n.id === "r1");
    expect(result.edges).toEqual([
      { from: "r1", to: "p1", kind: "project", x1: r1?.x, y1: r1?.y, x2: p1?.x, y2: p1?.y },
    ]);
  });

  it("eksik uçlu (var olmayan düğüme giden) kenar SESSİZCE elenir, çökmez", () => {
    const result = layoutContextMap(
      graph({ edges: [{ from: "r1", to: "hayalet", kind: "project" }] }),
      800,
      600,
    );
    expect(result.edges).toEqual([]);
    expect(result.nodes).toHaveLength(3); // düğümler yine üretilir
  });

  it("deterministik: AYNI girdi + boyut İKİ AYRI çağrıda BİREBİR aynı yerleşimi üretir", () => {
    const a = layoutContextMap(graph(), 800, 600);
    const b = layoutContextMap(graph(), 800, 600);
    expect(a).toEqual(b);
  });

  it("tek düğüm merkeze yakın konumlanır (çember açısı 0, i/count tanımsız kalmaz)", () => {
    const result = layoutContextMap(
      { nodes: [{ id: "only", kind: "project", label: "tek", at: 0, meta: {} }], edges: [] },
      800,
      600,
    );
    expect(result.nodes).toHaveLength(1);
    expect(Number.isFinite(result.nodes[0]?.x)).toBe(true);
  });

  // ADR-019 Karar 4, Dilim H3: hafta düğümleri simülasyona GİRMEZ, alt kenara kronolojik sabitlenir.
  it("hafta düğümleri alt kenara (y ≈ height - margin) sabitlenir", () => {
    const height = 600;
    const result = layoutContextMap(
      {
        nodes: [
          { id: "week:2026-W27", kind: "week", label: "2026-W27", at: 1_000, meta: {} },
          { id: "week:2026-W28", kind: "week", label: "2026-W28", at: 2_000, meta: {} },
          { id: "r1", kind: "run", label: "koşu", at: 3_000, meta: {} },
        ],
        edges: [{ from: "week:2026-W27", to: "week:2026-W28", kind: "week" }],
      },
      800,
      height,
    );
    const w27 = result.nodes.find((n) => n.id === "week:2026-W27");
    const w28 = result.nodes.find((n) => n.id === "week:2026-W28");
    // İkisi de alt kenarda (margin 30) — simülasyon onları merkeze çekMEDİ.
    expect(w27?.y).toBe(height - 30);
    expect(w28?.y).toBe(height - 30);
  });

  it("hafta düğümleri kronolojik (soldan sağa) sıralanır — eski hafta solda", () => {
    const result = layoutContextMap(
      {
        nodes: [
          // Bilinçle ters sırada verildi — yerleşim yine kronolojik dizmeli (id string sırası).
          { id: "week:2026-W28", kind: "week", label: "2026-W28", at: 2_000, meta: {} },
          { id: "week:2026-W27", kind: "week", label: "2026-W27", at: 1_000, meta: {} },
        ],
        edges: [],
      },
      800,
      600,
    );
    const w27 = result.nodes.find((n) => n.id === "week:2026-W27");
    const w28 = result.nodes.find((n) => n.id === "week:2026-W28");
    // Eski hafta (W27) solda, yeni hafta (W28) sağda.
    expect(w27?.x).toBeLessThan(w28?.x ?? Infinity);
  });

  it("tek hafta düğümü ortaya (width/2) sabitlenir — sıfıra bölme yok", () => {
    const result = layoutContextMap(
      { nodes: [{ id: "week:2026-W27", kind: "week", label: "2026-W27", at: 1_000, meta: {} }], edges: [] },
      800,
      600,
    );
    expect(result.nodes[0]?.x).toBe(400);
  });
});
