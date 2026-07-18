import { describe, expect, it } from "vitest";
import {
  buildContextMap,
  type ContextMapCurationEdgeInput,
  type ContextMapCurationNodeInput,
  type ContextMapRunInput,
  type ContextMapSessionInput,
} from "./build.js";

function run(overrides: Partial<ContextMapRunInput> = {}): ContextMapRunInput {
  return {
    id: "run-1",
    cwd: "C:\\proj\\symphony",
    task: "test görevi",
    provider: "ollama",
    model: "qwen3:8b",
    agentId: "asistan",
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

// `flat: true` — bu describe'daki testler öğe-düzeyi graf kurulumunu (haftalık katlamadan
// BAĞIMSIZ) sınar; katlama ayrı describe'da (aşağıda) test edilir.
describe("buildContextMap (ADR-016 Karar 6 + ADR-019 Karar 2/3) — SAF, deterministik", () => {
  it("boş girdide boş graf döner", () => {
    expect(buildContextMap({ runs: [], sessions: [], flat: true })).toEqual({ nodes: [], edges: [] });
  });

  it("bir koşu → run + proje + model + agent düğümü + ÜÇLÜ KENAR (run→proje, run→model, run→agent)", () => {
    const graph = buildContextMap({ runs: [run()], sessions: [], flat: true });
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
      {
        id: "model:ollama/qwen3:8b",
        kind: "model",
        label: "ollama/qwen3:8b",
        at: 1_000,
        meta: { provider: "ollama", model: "qwen3:8b", origin: "local" },
      },
      {
        id: "agent:asistan",
        kind: "agent",
        label: "asistan",
        at: 1_000,
        meta: { agentId: "asistan" },
      },
    ]);
    expect(graph.edges).toEqual([
      { from: "run-1", to: "project:C:\\proj\\symphony", kind: "project" },
      { from: "run-1", to: "model:ollama/qwen3:8b", kind: "model" },
      { from: "run-1", to: "agent:asistan", kind: "agent" },
    ]);
  });

  it("bir sohbet → session + model düğümü (proje/agent YOK) + session→model kenarı", () => {
    const graph = buildContextMap({ runs: [], sessions: [session()], flat: true });
    expect(graph.nodes).toEqual([
      {
        id: "sess-1",
        kind: "session",
        label: "test sohbeti",
        at: 1_000,
        meta: { provider: "anthropic", model: "claude-sonnet-5" },
      },
      {
        id: "model:anthropic/claude-sonnet-5",
        kind: "model",
        label: "anthropic/claude-sonnet-5",
        at: 1_000,
        meta: { provider: "anthropic", model: "claude-sonnet-5", origin: "api" },
      },
    ]);
    expect(graph.edges).toEqual([{ from: "sess-1", to: "model:anthropic/claude-sonnet-5", kind: "model" }]);
  });

  it("model kökeni: ollama → local, diğer sağlayıcılar → api", () => {
    const graph = buildContextMap({
      runs: [run({ id: "r1", provider: "ollama", model: "qwen3:8b" })],
      sessions: [session({ id: "s1", provider: "anthropic", model: "claude-sonnet-5" })],
      flat: true,
    });
    const modelNodes = graph.nodes.filter((n) => n.kind === "model");
    expect(modelNodes.find((n) => n.id === "model:ollama/qwen3:8b")?.meta).toMatchObject({
      origin: "local",
    });
    expect(modelNodes.find((n) => n.id === "model:anthropic/claude-sonnet-5")?.meta).toMatchObject({
      origin: "api",
    });
  });

  it("aynı model/agent için tekrar eden koşular TEK düğüme düşer, 'at' en yeni koşudan", () => {
    const graph = buildContextMap({
      runs: [run({ id: "r1", at: 1_000 }), run({ id: "r2", at: 5_000 })],
      sessions: [],
      flat: true,
    });
    const modelNodes = graph.nodes.filter((n) => n.kind === "model");
    const agentNodes = graph.nodes.filter((n) => n.kind === "agent");
    expect(modelNodes).toHaveLength(1);
    expect(modelNodes[0]).toMatchObject({ at: 5_000 });
    expect(agentNodes).toHaveLength(1);
    expect(agentNodes[0]).toMatchObject({ at: 5_000 });
    expect(graph.edges.filter((e) => e.kind === "model")).toHaveLength(2);
    expect(graph.edges.filter((e) => e.kind === "agent")).toHaveLength(2);
  });

  it("aynı cwd'li iki koşu TEK proje düğümüne düşer, proje 'at'i en yeni koşudan", () => {
    const graph = buildContextMap({
      runs: [run({ id: "r1", at: 1_000 }), run({ id: "r2", at: 5_000 })],
      sessions: [],
      flat: true,
    });
    const projectNodes = graph.nodes.filter((n) => n.kind === "project");
    expect(projectNodes).toHaveLength(1);
    expect(projectNodes[0]).toMatchObject({ at: 5_000 });
    expect(graph.edges.filter((e) => e.kind === "project")).toHaveLength(2);
  });

  it("cwd boşsa proje etiketi 'diğer' (ui'nin basename kuralıyla AYNI, ADR-015 Karar 1)", () => {
    const graph = buildContextMap({ runs: [run({ cwd: "" })], sessions: [], flat: true });
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
      flat: true,
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
      flat: true,
    });
    expect(graph.edges.filter((e) => e.kind === "same_day")).toEqual([]);
  });

  it("limit: sessions+runs birleşiminden en-yeni N tutulur, eskiler + onlara özgü türetilmiş düğümler DÜŞER", () => {
    const graph = buildContextMap({
      runs: [run({ id: "eski", cwd: "/old", at: 1_000 }), run({ id: "yeni", cwd: "/new", at: 9_000 })],
      sessions: [],
      limit: 1,
      flat: true,
    });
    expect(graph.nodes.map((n) => n.id)).toEqual([
      "yeni",
      "project:/new",
      "model:ollama/qwen3:8b",
      "agent:asistan",
    ]);
  });

  it("Y6: sabitlenmiş (pin) bir öğe limit kesitinden ESKİ olsa bile 'yetim' kalmaz, geri eklenir", () => {
    const mapNodes: ContextMapCurationNodeInput[] = [
      { id: "ctx-1", kind: "context", title: "önemli eski koşu", createdAt: 1_000, refKind: "run", refId: "eski" },
    ];
    const graph = buildContextMap({
      runs: [run({ id: "eski", cwd: "/old", at: 1_000 }), run({ id: "yeni", cwd: "/new", at: 9_000 })],
      sessions: [],
      limit: 1, // yalnız "yeni" normalde kesitte kalır
      mapNodes,
      flat: true,
    });
    expect(graph.nodes.some((n) => n.id === "eski")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "yeni")).toBe(true);
    // pin kenarı da grafiksiz KALMAZ — "eski" düğümü gerçekten var.
    expect(graph.edges).toContainEqual({ from: "ctx-1", to: "eski", kind: "pin" });
  });

  it("model VE agent bağı artık KENAR (ADR-016 Karar 6'nın reddi ADR-019 Karar 3'te REVİZE edildi)", () => {
    const graph = buildContextMap({ runs: [run()], sessions: [session()], flat: true });
    expect(graph.edges.some((e) => e.kind === "model")).toBe(true);
    expect(graph.edges.some((e) => e.kind === "agent")).toBe(true);
  });
});

describe("buildContextMap — haftalık katlanma (ADR-019 Karar 4)", () => {
  const thisWeek = Date.UTC(2026, 6, 13, 12, 0, 0); // Pzt — "içinde bulunulan hafta" (2026-W29)
  const lastWeek = Date.UTC(2026, 6, 6, 12, 0, 0); // bir hafta önce (2026-W28)
  const twoWeeksAgo = Date.UTC(2026, 5, 29, 12, 0, 0); // iki hafta önce (2026-W27)

  it("mevcut haftanın DIŞINDAKİ ve sabitlenmemiş bir koşu grafa GİRMEZ, week: düğümüne katlanır", () => {
    const graph = buildContextMap({
      runs: [run({ id: "eski-run", at: lastWeek })],
      sessions: [],
      now: thisWeek,
    });
    expect(graph.nodes.some((n) => n.id === "eski-run")).toBe(false);
    const weekNode = graph.nodes.find((n) => n.kind === "week");
    expect(weekNode).toBeDefined();
    expect(weekNode?.meta).toMatchObject({ runCount: 1, sessionCount: 0, models: ["ollama/qwen3:8b"] });
  });

  it("mevcut haftadaki bir koşu AÇIK kalır (katlanmaz, week düğümü doğmaz)", () => {
    const graph = buildContextMap({
      runs: [run({ id: "guncel-run", at: thisWeek })],
      sessions: [],
      now: thisWeek,
    });
    expect(graph.nodes.some((n) => n.id === "guncel-run")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "week")).toBe(false);
  });

  it("sabitlenmiş (bir context düğümünün ref'lediği) eski öğe KATLANMAZ + pin kenarı çizilir", () => {
    const mapNodes: ContextMapCurationNodeInput[] = [
      {
        id: "ctx-1",
        kind: "context",
        title: "önemli koşu",
        createdAt: lastWeek,
        refKind: "run",
        refId: "eski-run",
      },
    ];
    const graph = buildContextMap({
      runs: [run({ id: "eski-run", at: lastWeek })],
      sessions: [],
      now: thisWeek,
      mapNodes,
    });
    expect(graph.nodes.some((n) => n.id === "eski-run")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "week")).toBe(false);
    expect(graph.edges).toContainEqual({ from: "ctx-1", to: "eski-run", kind: "pin" });
  });

  it("iki farklı katlanmış hafta kronolojik `week` kenarıyla zincirlenir", () => {
    const graph = buildContextMap({
      runs: [run({ id: "r1", at: twoWeeksAgo }), run({ id: "r2", at: lastWeek })],
      sessions: [],
      now: thisWeek,
    });
    const weekNodeIds = graph.nodes
      .filter((n) => n.kind === "week")
      .map((n) => n.id)
      .sort();
    expect(weekNodeIds).toHaveLength(2);
    const weekEdges = graph.edges.filter((e) => e.kind === "week");
    expect(weekEdges).toEqual([{ from: weekNodeIds[0], to: weekNodeIds[1], kind: "week" }]);
  });

  it("`week` parametresi verilirse o haftanın öğeleri AÇIK döner (drill-down)", () => {
    const graph = buildContextMap({
      runs: [run({ id: "eski-run", at: lastWeek })],
      sessions: [],
      now: thisWeek,
      week: "2026-W28",
    });
    expect(graph.nodes.some((n) => n.id === "eski-run")).toBe(true);
  });

  it("`flat:true` hiçbir şeyi katlamaz", () => {
    const graph = buildContextMap({
      runs: [run({ id: "eski-run", at: lastWeek })],
      sessions: [],
      now: thisWeek,
      flat: true,
    });
    expect(graph.nodes.some((n) => n.id === "eski-run")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "week")).toBe(false);
  });
});

describe("buildContextMap — kürasyon bindirmesi (ADR-019 Karar 1/2)", () => {
  it("context/group kürasyon düğümleri BİREBİR eklenir", () => {
    const mapNodes: ContextMapCurationNodeInput[] = [
      { id: "ctx-1", kind: "context", title: "serbest not", createdAt: 2_000, refKind: null, refId: null },
      { id: "grp-1", kind: "group", title: "grup", createdAt: 3_000, refKind: null, refId: null },
    ];
    const graph = buildContextMap({ runs: [], sessions: [], mapNodes, flat: true });
    expect(graph.nodes).toContainEqual({ id: "ctx-1", kind: "context", label: "serbest not", at: 2_000, meta: {} });
    expect(graph.nodes).toContainEqual({ id: "grp-1", kind: "group", label: "grup", at: 3_000, meta: {} });
  });

  it("link/member kürasyon kenarları BİREBİR eklenir", () => {
    const mapNodes: ContextMapCurationNodeInput[] = [
      { id: "ctx-1", kind: "context", title: "not-1", createdAt: 1_000, refKind: null, refId: null },
      { id: "grp-1", kind: "group", title: "grup", createdAt: 1_000, refKind: null, refId: null },
    ];
    const mapEdges: ContextMapCurationEdgeInput[] = [{ fromId: "ctx-1", toId: "grp-1", kind: "member" }];
    const graph = buildContextMap({ runs: [], sessions: [], mapNodes, mapEdges, flat: true });
    expect(graph.edges).toContainEqual({ from: "ctx-1", to: "grp-1", kind: "member" });
  });

  it("bir ucu grafta yer almayan kürasyon kenarı (context ref'i OLMADAN katlanmış bir öğeye üyelik) sessizce DÜŞER", () => {
    const thisWeek = Date.UTC(2026, 6, 13, 12, 0, 0);
    const lastWeek = Date.UTC(2026, 6, 6, 12, 0, 0);
    const mapNodes: ContextMapCurationNodeInput[] = [
      { id: "grp-1", kind: "group", title: "grup", createdAt: 1_000, refKind: null, refId: null },
    ];
    // "eski-run" katlanmış (context ref'i yok) — grup üyeliği dangling kenar üretmemeli.
    const mapEdges: ContextMapCurationEdgeInput[] = [{ fromId: "eski-run", toId: "grp-1", kind: "member" }];
    const graph = buildContextMap({
      runs: [run({ id: "eski-run", at: lastWeek })],
      sessions: [],
      now: thisWeek,
      mapNodes,
      mapEdges,
    });
    expect(graph.edges.some((e) => e.kind === "member")).toBe(false);
  });
});
