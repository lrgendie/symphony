import { describe, expect, it } from "vitest";
import type { GpuSample } from "@lrgendie/shared";
import { deriveGpuVitals, TEMP_ALERT_C, TEMP_MAX_C } from "./hardware-vitals.js";

const gpu = (over: Partial<GpuSample>): GpuSample => ({
  index: 0,
  name: "GPU",
  utilizationPct: 0,
  memUsedMb: 0,
  memTotalMb: 8192,
  temperatureC: null,
  ...over,
});

describe("deriveGpuVitals", () => {
  it("GPU yoksa null (fiziksel katman kapalı, küre yalnız mood ile sürülür)", () => {
    expect(deriveGpuVitals([])).toBeNull();
  });

  it("en yoğun GPU'yu birincil seçer; load ve memPct türetir", () => {
    const v = deriveGpuVitals([
      gpu({ index: 0, utilizationPct: 20, memUsedMb: 1000, memTotalMb: 8000 }),
      gpu({ index: 1, name: "busy", utilizationPct: 90, memUsedMb: 6000, memTotalMb: 8000 }),
    ]);
    expect(v?.name).toBe("busy");
    expect(v?.load).toBeCloseTo(0.9);
    expect(v?.memPct).toBeCloseTo(75);
  });

  it("boşta ılık GPU (util 0, ~50°C) heat=0 — renk soğuk kalır (turuncuya kaymaz)", () => {
    const v = deriveGpuVitals([gpu({ utilizationPct: 0, temperatureC: 50 })]);
    expect(v?.heat).toBe(0);
  });

  it("heat önce yükten gelir (util 0.7, ılık sıcaklık → 0.7)", () => {
    const v = deriveGpuVitals([gpu({ utilizationPct: 70, temperatureC: 55 })]);
    expect(v?.heat).toBeCloseTo(0.7);
  });

  it("termal uyarı: düşük yük ama kızgın GPU heat'i yükseltir (orta eşik → 0.5)", () => {
    const mid = TEMP_ALERT_C + (TEMP_MAX_C - TEMP_ALERT_C) / 2;
    const v = deriveGpuVitals([gpu({ utilizationPct: 0, temperatureC: mid })]);
    expect(v?.heat).toBeCloseTo(0.5);
  });

  it("heat 0..1'e sıkışır (aşırı sıcaklıkta 1)", () => {
    expect(deriveGpuVitals([gpu({ temperatureC: 200 })])?.heat).toBe(1);
  });
});
