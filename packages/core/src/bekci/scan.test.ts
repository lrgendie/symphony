import { describe, expect, it } from "vitest";
import { BEKCI_DEBOUNCE_MS, findMatches, shouldRecordBekciMatch } from "./scan.js";

/** ADR-018 Karar 7 (Faz 8, Dilim D6) — SAF: dosya sistemine dokunmaz. */

describe("findMatches — SAF, deterministik desen (error|exception|traceback|fatal, harf duyarsız)", () => {
  it("eşleşen satırı ve ÇEVRESİNİ (öncesi/sonrası) kesit olarak döner", () => {
    const lines = ["giriş", "işlem başladı", "Error: bağlantı koptu", "temizlik", "bitti"];
    const matches = findMatches(lines, 1);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe("işlem başladı\nError: bağlantı koptu\ntemizlik");
  });

  it("harf duyarsız eşleşir (FATAL, exception, Traceback)", () => {
    expect(findMatches(["FATAL: çöktü"])).toHaveLength(1);
    expect(findMatches(["bir exception fırladı"])).toHaveLength(1);
    expect(findMatches(["Traceback (most recent call last):"])).toHaveLength(1);
  });

  it("eşleşme yoksa boş dizi", () => {
    expect(findMatches(["her şey normal", "sorun yok"])).toEqual([]);
  });

  it("boş dizide çökmez", () => {
    expect(findMatches([])).toEqual([]);
  });

  it("dosyanın BAŞI/SONUNDAKİ eşleşmede kesit dizinin sınırlarını AŞMAZ", () => {
    const lines = ["Error: ilk satır", "ikinci", "üçüncü"];
    const matches = findMatches(lines, 5); // radius dizi boyundan büyük
    expect(matches[0]).toBe("Error: ilk satır\nikinci\nüçüncü");
  });

  it("birden fazla eşleşme birden fazla kesit üretir", () => {
    const lines = ["a", "Error: bir", "b", "Exception: iki", "c"];
    expect(findMatches(lines, 0)).toEqual(["Error: bir", "Exception: iki"]);
  });

  it("kelime içinde geçen ama desenle eşleşmeyen satırlar YAKALANMAZ (sözcük sınırı yok ama kelime tam gerekir)", () => {
    // "terror" "error" içerir — desen alt-dize eşleşmesi yapar, bu BİLİNÇLİ bir v1 basitliği
    // (yanlış negatif > yanlış pozitif riski göze alınmış: ADR-018 Karar 7 "yalnız izleriz").
    expect(findMatches(["terror filmi izliyoruz"])).toHaveLength(1);
  });
});

describe("shouldRecordBekciMatch — SAF debounce kararı (5dk)", () => {
  it("hiç yazılmamışsa (null) her zaman true", () => {
    expect(shouldRecordBekciMatch(null, Date.now())).toBe(true);
  });

  it("debounce PENCERESİ İÇİNDE false", () => {
    const now = 1_000_000;
    expect(shouldRecordBekciMatch(now - 1000, now)).toBe(false);
    expect(shouldRecordBekciMatch(now - (BEKCI_DEBOUNCE_MS - 1), now)).toBe(false);
  });

  it("debounce PENCERESİ TAM DOLUNCA/AŞILINCA true", () => {
    const now = 1_000_000;
    expect(shouldRecordBekciMatch(now - BEKCI_DEBOUNCE_MS, now)).toBe(true);
    expect(shouldRecordBekciMatch(now - BEKCI_DEBOUNCE_MS - 1, now)).toBe(true);
  });
});
