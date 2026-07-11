import { describe, expect, it } from "vitest";
import { detectRecurring, MIN_RECURRENCE, type DetectInput } from "./detect.js";

describe("detectRecurring (ADR-018 Karar 1) — SAF, deterministik", () => {
  it("eşik altındaki (count < minRecurrence) kodlar elenir", () => {
    const rows: DetectInput[] = [{ code: "A", count: MIN_RECURRENCE - 1 }];
    expect(detectRecurring(rows, [])).toEqual([]);
  });

  it("eşiği TAM karşılayan kod (count === minRecurrence) aday olur", () => {
    const rows: DetectInput[] = [{ code: "A", count: MIN_RECURRENCE }];
    expect(detectRecurring(rows, [])).toEqual([{ code: "A", count: MIN_RECURRENCE }]);
  });

  it("hâlâ açık/uygulanmış önerisi olan kodlar (excluded) elenir", () => {
    const rows: DetectInput[] = [
      { code: "A", count: 10 },
      { code: "B", count: 10 },
    ];
    expect(detectRecurring(rows, ["A"])).toEqual([{ code: "B", count: 10 }]);
  });

  it("kalan adaylar SAYIYA göre AZALAN sıralanır", () => {
    const rows: DetectInput[] = [
      { code: "az", count: 3 },
      { code: "cok", count: 20 },
      { code: "orta", count: 8 },
    ];
    expect(detectRecurring(rows, []).map((r) => r.code)).toEqual(["cok", "orta", "az"]);
  });

  it("özel minRecurrence parametresi eşiği geçersiz kılar", () => {
    const rows: DetectInput[] = [{ code: "A", count: 5 }];
    expect(detectRecurring(rows, [], 6)).toEqual([]);
    expect(detectRecurring(rows, [], 5)).toEqual([{ code: "A", count: 5 }]);
  });

  it("boş girdi → boş liste", () => {
    expect(detectRecurring([], [])).toEqual([]);
  });
});
