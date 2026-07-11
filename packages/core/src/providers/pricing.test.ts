import { describe, expect, it } from "vitest";
import { computeCostUsd } from "./pricing.js";

describe("maliyet hesabı", () => {
  it("Opus 4.8: $5 giriş / $25 çıkış per MTok", () => {
    expect(computeCostUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBe(30);
    expect(computeCostUsd("claude-opus-4-8", 1000, 500)).toBeCloseTo(0.0175, 6);
  });

  it("bilinmeyen model (yerel) → 0", () => {
    expect(computeCostUsd("llama3.1:8b", 5000, 5000)).toBe(0);
  });

  describe("prompt cache (D2.5) — cache'lenen token'lar İNDİRİMLİ fiyatlanır", () => {
    // AI SDK'nın usage.inputTokens'ı cache okumasını/yazımını TAM sayıyla İÇERİR
    // (canlı ölçüm: input=10844 = uncached 2 + cache_read 10842).
    it("cache okuması girdinin %10'una fiyatlanır (ham sayıyla çarpmak defteri 10x şişirirdi)", () => {
      const cacheYok = computeCostUsd("claude-sonnet-5", 1_000_000, 0);
      const hepsiCacheten = computeCostUsd("claude-sonnet-5", 1_000_000, 0, {
        read: 1_000_000,
        creation: 0,
      });
      expect(cacheYok).toBe(3); // $3/MTok tam fiyat
      expect(hepsiCacheten).toBeCloseTo(0.3, 6); // %10
    });

    it("cache yazımı %125'e fiyatlanır (ilk tur cache kurma bedeli)", () => {
      expect(
        computeCostUsd("claude-sonnet-5", 1_000_000, 0, { read: 0, creation: 1_000_000 }),
      ).toBeCloseTo(3.75, 6);
    });

    it("karışık: uncached tam + cache okuma indirimli (gerçek agent turu)", () => {
      // 10.000 girdi: 2.000 yeni, 8.000 cache'ten.
      const cost = computeCostUsd("claude-sonnet-5", 10_000, 0, { read: 8_000, creation: 0 });
      const beklenen = (2_000 * 3 + 8_000 * 3 * 0.1) / 1_000_000;
      expect(cost).toBeCloseTo(beklenen, 9);
    });

    it("cache verilmezse davranış AYNEN eskisi gibi (geriye uyumlu)", () => {
      expect(computeCostUsd("claude-opus-4-8", 1000, 500)).toBeCloseTo(0.0175, 6);
    });

    it("bozuk veri: cache token'ları girdiden BÜYÜK olsa bile negatif maliyet üretmez", () => {
      const cost = computeCostUsd("claude-sonnet-5", 1_000, 0, { read: 999_999, creation: 999_999 });
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(cost).toBeLessThanOrEqual(computeCostUsd("claude-sonnet-5", 1_000, 0));
    });
  });
});
