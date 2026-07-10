import { describe, expect, it } from "vitest";
import { buildContextMap, type ContextMapRunInput, type ContextMapSessionInput } from "./build.js";

function run(overrides: Partial<ContextMapRunInput> = {}): ContextMapRunInput {
  return {
    id: "run-1",
    cwd: "C:\\proj\\symphony",
    task: "test görevi",
    provider: "ollama",
    model: "qwen3:8b",
    at: 1_000,
    ...overrides,
  };
}

function session(overrides: Partial<ContextMapSessionInput> = {}): ContextMapSessionInput {
  return {
    id: "sess-1",
    title: "test sohbeti",
    provider: "anthropic",
    model: "claude-sonnet-5",
    at: 1_000,
    ...overrides,
  };
}

describe("buildContextMap (ADR-016 Karar 6) — SAF, deterministik", () => {
  it("boş girdide boş graf döner", () => {
    expect(buildContextMap({ runs: [], sessions: [] })).toEqual({ nodes: [], edges: [] });
  });

  it("bir koşu → run düğümü + türetilmiş proje düğümü + run→proje kenarı", () => {
    const graph = buildContextMap({ runs: [run()], sessions: [] });
    expect(graph.nodes).toEqual([
      {
        id: "run-1",
        kind: "run",
        label: "test görevi",
        at: 1_000,
        meta: { provider: "ollama", model: "qwen3:8b", cwd: "C:\\proj\\symphony" },
      },
      {
        id: "project:C:\\proj\\symphony",
        kind: "project",
        label: "symphony",
        at: 1_000,
        meta: { cwd: "C:\\proj\\symphony" },
      },
    ]);
    expect(graph.edges).toEqual([
      { from: "run-1", to: "project:C:\\proj\\symphony", kind: "project" },
    ]);
  });

  it("bir sohbet → session düğümü (proje/kenar YOK, sohbetin cwd'si yok)", () => {
    const graph = buildContextMap({ runs: [], sessions: [session()] });
    expect(graph.nodes).toEqual([
      {
        id: "sess-1",
        kind: "session",
        label: "test sohbeti",
        at: 1_000,
        meta: { provider: "anthropic", model: "claude-sonnet-5" },
      },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("aynı cwd'li iki koşu TEK proje düğümüne düşer, proje 'at'i en yeni koşudan", () => {
    const graph = buildContextMap({
      runs: [run({ id: "r1", at: 1_000 }), run({ id: "r2", at: 5_000 })],
      sessions: [],
    });
    const projectNodes = graph.nodes.filter((n) => n.kind === "project");
    expect(projectNodes).toHaveLength(1);
    expect(projectNodes[0]).toMatchObject({ at: 5_000 });
    // İki ayrı run→proje kenarı — proje kenar SAYISI koşu sayısına eşit.
    expect(graph.edges.filter((e) => e.kind === "project")).toHaveLength(2);
  });

  it("cwd boşsa proje etiketi 'diğer' (ui'nin basename kuralıyla AYNI, ADR-015 Karar 1)", () => {
    const graph = buildContextMap({ runs: [run({ cwd: "" })], sessions: [] });
    expect(graph.nodes.find((n) => n.kind === "project")).toMatchObject({
      label: "diğer",
      meta: { cwd: "" },
    });
  });

  it("aynı takvim gününde ardışık öğeler zayıf zincirle bağlanır (same_day)", () => {
    const dayStart = Date.UTC(2026, 6, 10, 0, 0, 0);
    const graph = buildContextMap({
      runs: [
        run({ id: "r1", cwd: "/a", at: dayStart }),
        run({ id: "r2", cwd: "/a", at: dayStart + 1_000 }),
      ],
      sessions: [session({ id: "s1", at: dayStart + 2_000 })],
    });
    expect(graph.edges.filter((e) => e.kind === "same_day")).toEqual([
      { from: "r1", to: "r2", kind: "same_day" },
      { from: "r2", to: "s1", kind: "same_day" },
    ]);
  });

  it("farklı takvim günündeki komşular ARASINDA same_day kenarı YOK", () => {
    const day1 = Date.UTC(2026, 6, 10, 23, 0, 0);
    const day2 = Date.UTC(2026, 6, 11, 1, 0, 0);
    const graph = buildContextMap({
      runs: [run({ id: "r1", at: day1 }), run({ id: "r2", at: day2 })],
      sessions: [],
    });
    expect(graph.edges.filter((e) => e.kind === "same_day")).toEqual([]);
  });

  it("limit: sessions+runs birleşiminden en-yeni N tutulur, eskiler + onlara özgü projeler DÜŞER", () => {
    const graph = buildContextMap({
      runs: [run({ id: "eski", cwd: "/old", at: 1_000 }), run({ id: "yeni", cwd: "/new", at: 9_000 })],
      sessions: [],
      limit: 1,
    });
    expect(graph.nodes.map((n) => n.id)).toEqual(["yeni", "project:/new"]);
  });

  it("model bağı kenar DEĞİL — yalnız düğüm meta'sında (görsel kanal, çöp graf önlenir)", () => {
    const graph = buildContextMap({ runs: [run()], sessions: [session()] });
    expect(graph.edges.every((e) => e.kind === "project" || e.kind === "same_day")).toBe(true);
    expect(graph.nodes.some((n) => "model" in n.meta)).toBe(true);
  });
});
