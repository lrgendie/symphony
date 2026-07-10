import { describe, expect, it } from "vitest";
import {
  advanceSatellites,
  createSatelliteSystem,
  mapSatelliteMood,
  MAX_SATELLITES,
  syncSatellites,
  type SatelliteInput,
} from "./satellites.js";

/** Sabit dizi döndüren deterministik rng (döngüsel) — pulses.test.ts ile AYNI desen. */
function seqRng(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

function input(overrides: Partial<SatelliteInput> = {}): SatelliteInput {
  return { runId: "r1", isChild: false, state: "thinking", ...overrides };
}

describe("mapSatelliteMood", () => {
  it("protokol state'lerini doğru mood'a çevirir", () => {
    expect(mapSatelliteMood("queued")).toBe("thinking");
    expect(mapSatelliteMood("thinking")).toBe("thinking");
    expect(mapSatelliteMood("executing_tool")).toBe("executing");
    expect(mapSatelliteMood("awaiting_permission")).toBe("awaiting");
    expect(mapSatelliteMood("awaiting_user")).toBe("awaiting");
    expect(mapSatelliteMood("failed")).toBe("failed");
    expect(mapSatelliteMood("completed")).toBe("done");
    expect(mapSatelliteMood("cancelled")).toBe("done");
  });
});

describe("syncSatellites", () => {
  it("yeni koşu → yeni uydu (spawnT=0, dieT=null, sabit açı tohumu)", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input({ runId: "r1" })], seqRng([0.25]));
    const entry = sys.entries.get("r1");
    expect(entry).toMatchObject({ kind: "top", spawnT: 0, dieT: null, mood: "thinking" });
    expect(entry?.angleSeed).toBeCloseTo(0.25 * Math.PI * 2);
  });

  it("isChild=true → kind='child'", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input({ runId: "c1", isChild: true })], seqRng([0]));
    expect(sys.entries.get("c1")?.kind).toBe("child");
  });

  it("hâlâ aktif koşunun angleSeed'i KORUNUR, mood güncellenir", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input({ state: "thinking" })], seqRng([0.4]));
    const seed = sys.entries.get("r1")?.angleSeed;
    syncSatellites(sys, [input({ state: "executing_tool" })], seqRng([0.9])); // yeni rng, KULLANILMAMALI
    expect(sys.entries.get("r1")?.angleSeed).toBe(seed);
    expect(sys.entries.get("r1")?.mood).toBe("executing");
  });

  it("aktif listeden düşen koşu ANINDA silinmez — dieT=0 ile ölüm animasyonuna girer", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input()], seqRng([0.1]));
    syncSatellites(sys, [], seqRng([0.1]));
    expect(sys.entries.has("r1")).toBe(true);
    expect(sys.entries.get("r1")?.dieT).toBe(0);
  });

  it("ölüm animasyonu SIRASINDA koşu yeniden görülürse dirilir (dieT=null)", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input()], seqRng([0.1]));
    syncSatellites(sys, [], seqRng([0.1]));
    expect(sys.entries.get("r1")?.dieT).toBe(0);
    syncSatellites(sys, [input()], seqRng([0.1]));
    expect(sys.entries.get("r1")?.dieT).toBeNull();
  });

  it(`kapasiteyi (${MAX_SATELLITES}) aşan koşular sessizce dışarıda bırakılır`, () => {
    const sys = createSatelliteSystem();
    const many = Array.from({ length: MAX_SATELLITES + 3 }, (_, i) => input({ runId: `r${i}` }));
    syncSatellites(sys, many, seqRng([0.5]));
    expect(sys.entries.size).toBe(MAX_SATELLITES);
    expect(sys.entries.has(`r${MAX_SATELLITES}`)).toBe(false); // sıra dışı kalan
  });
});

describe("advanceSatellites", () => {
  it("spawnT zamanla 1'e yükselir ve orada durur", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input()], seqRng([0]));
    advanceSatellites(sys, 0.1);
    const midway = sys.entries.get("r1")?.spawnT ?? 0;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(1);
    advanceSatellites(sys, 10); // tavana fazlasıyla yeter
    expect(sys.entries.get("r1")?.spawnT).toBe(1);
  });

  it("ölmekte olan uydu DIE_DURATION sonunda sistemden silinir, despawned raporlanır", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input()], seqRng([0]));
    syncSatellites(sys, [], seqRng([0])); // dieT=0
    const mid = advanceSatellites(sys, 0.1);
    expect(mid.despawned).toBe(0);
    expect(sys.entries.has("r1")).toBe(true);
    const end = advanceSatellites(sys, 10); // tavana fazlasıyla yeter
    expect(end.despawned).toBe(1);
    expect(sys.entries.has("r1")).toBe(false);
  });

  it("canlı (dieT=null) uydular advanceSatellites'ten etkilenmez, silinmez", () => {
    const sys = createSatelliteSystem();
    syncSatellites(sys, [input()], seqRng([0]));
    advanceSatellites(sys, 100);
    expect(sys.entries.has("r1")).toBe(true);
    expect(sys.entries.get("r1")?.dieT).toBeNull();
  });
});
