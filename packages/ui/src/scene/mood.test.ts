import { describe, expect, it } from "vitest";
import { deriveMood, ERROR_FLASH_MS, MOOD_STYLE, type MoodInput } from "./mood.js";

const base: MoodInput = {
  connected: true,
  runStates: [],
  pendingCount: 0,
  lastErrorAt: null,
  now: 10_000,
};

describe("deriveMood (yaşayan küre durum→mood)", () => {
  it("bağlantı yoksa her şeyin önünde offline", () => {
    expect(deriveMood({ ...base, connected: false, runStates: ["executing_tool"], pendingCount: 3 })).toBe("offline");
  });

  it("yeni hata (flaş penceresi içinde) izin/çalışma önünde error", () => {
    expect(
      deriveMood({ ...base, lastErrorAt: 9_000, now: 10_000, pendingCount: 2, runStates: ["executing_tool"] }),
    ).toBe("error");
  });

  it("hata flaşı süresi dolunca alttaki duruma döner", () => {
    const justExpired = { ...base, lastErrorAt: 10_000, now: 10_000 + ERROR_FLASH_MS + 1, pendingCount: 1 };
    expect(deriveMood(justExpired)).toBe("awaiting");
  });

  it("izin bekliyor, çalışma/düşünme önünde awaiting", () => {
    expect(deriveMood({ ...base, pendingCount: 1, runStates: ["executing_tool"] })).toBe("awaiting");
  });

  it("araç çalışıyorsa executing (düşünme önünde)", () => {
    expect(deriveMood({ ...base, runStates: ["thinking", "executing_tool"] })).toBe("executing");
  });

  it("thinking/queued varsa thinking", () => {
    expect(deriveMood({ ...base, runStates: ["queued"] })).toBe("thinking");
    expect(deriveMood({ ...base, runStates: ["thinking"] })).toBe("thinking");
  });

  it("hiçbir şey yoksa idle", () => {
    expect(deriveMood(base)).toBe("idle");
  });

  it("her mood'un bir stili (renk + etiket) var", () => {
    for (const mood of ["offline", "error", "awaiting", "executing", "thinking", "idle"] as const) {
      expect(MOOD_STYLE[mood].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(MOOD_STYLE[mood].label.length).toBeGreaterThan(0);
    }
  });
});
