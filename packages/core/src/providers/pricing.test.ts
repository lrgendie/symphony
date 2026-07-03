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
});
