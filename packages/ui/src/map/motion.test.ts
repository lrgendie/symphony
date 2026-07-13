import { describe, expect, it } from "vitest";
import {
  dashOffset,
  fadeOpacity,
  isRecentEdge,
  RECENT_EDGE_WINDOW_MS,
  springScale,
} from "./motion";

describe("springScale (ADR-019 Karar 5, Dilim H5) — SAF", () => {
  it("ageMs<=0 → 0 (henüz doğmadı)", () => {
    expect(springScale(0)).toBe(0);
    expect(springScale(-100)).toBe(0);
  });

  it("ageMs>=durationMs → tam 1 (doğum bitti, kalıcı boyut)", () => {
    expect(springScale(500)).toBe(1);
    expect(springScale(999)).toBe(1);
  });

  it("ortada hafif SIÇRAMA (overshoot >1) var — sönümlü yay eğrisi", () => {
    expect(springScale(50)).toBeCloseTo(0.5771, 3);
    expect(springScale(100)).toBeCloseTo(0.9436, 3);
    expect(springScale(150)).toBeCloseTo(1.0796, 3); // sıçrama zirvesi civarı
    expect(springScale(200)).toBeCloseTo(1.0843, 3);
    expect(springScale(400)).toBeCloseTo(0.994, 3); // yerine oturuyor
  });

  it("özel süre (durationMs) verilirse ona göre ölçeklenir", () => {
    expect(springScale(0, 1000)).toBe(0);
    expect(springScale(1000, 1000)).toBe(1);
    expect(springScale(500, 1000)).toBeCloseTo(springScale(250, 500), 6); // t oranı AYNI
  });
});

describe("fadeOpacity (Dilim H5) — SAF", () => {
  it("elapsedMs<=0 → 1 (tam görünür)", () => {
    expect(fadeOpacity(0)).toBe(1);
    expect(fadeOpacity(-10)).toBe(1);
  });

  it("elapsedMs>=durationMs → 0 (tamamen kaybolmuş)", () => {
    expect(fadeOpacity(600)).toBe(0);
    expect(fadeOpacity(1000)).toBe(0);
  });

  it("doğrusal azalır", () => {
    expect(fadeOpacity(300)).toBeCloseTo(0.5, 6);
    expect(fadeOpacity(150, 600)).toBeCloseTo(0.75, 6);
  });
});

describe("isRecentEdge (Dilim H5) — SAF", () => {
  const now = 1_000_000_000;

  it("her iki uç da eski ise false", () => {
    expect(isRecentEdge(now - 2 * RECENT_EDGE_WINDOW_MS, now - 2 * RECENT_EDGE_WINDOW_MS, now)).toBe(
      false,
    );
  });

  it("bir ucu 24 saat İÇİNDEYSE true (diğer uç eski olsa bile)", () => {
    expect(isRecentEdge(now - 2 * RECENT_EDGE_WINDOW_MS, now - 1_000, now)).toBe(true);
    expect(isRecentEdge(now - 1_000, now - 2 * RECENT_EDGE_WINDOW_MS, now)).toBe(true);
  });

  it("tam pencere sınırında (fark === windowMs) DIŞARIDA sayılır (< kesin küçük)", () => {
    expect(isRecentEdge(now - RECENT_EDGE_WINDOW_MS, now - RECENT_EDGE_WINDOW_MS, now)).toBe(false);
  });

  it("gelecekteki bir 'at' de (saat kayması) yeni sayılır — negatif fark reddedilmez", () => {
    expect(isRecentEdge(now + 1_000, now - 2 * RECENT_EDGE_WINDOW_MS, now)).toBe(true);
  });
});

describe("dashOffset (Dilim H5) — SAF", () => {
  it("zamanla tek yönde (negatife doğru) sürekli büyür", () => {
    const a = dashOffset(0);
    const b = dashOffset(1000);
    expect(a).toBeCloseTo(0, 6); // -0 üretebilir (matematiksel olarak 0'a eşit)
    expect(b).toBeLessThan(a);
  });

  it("hız parametresiyle orantılıdır", () => {
    expect(dashOffset(1000, 10)).toBeCloseTo(-10, 6);
    expect(dashOffset(2000, 10)).toBeCloseTo(-20, 6);
  });
});
