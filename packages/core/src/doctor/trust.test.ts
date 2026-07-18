import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PatchSummary } from "@lrgendie/shared";
import {
  categoryRecord,
  categoryTouchedProtected,
  isTrusted,
  readTrust,
  withoutTrust,
  withTrust,
  writeTrust,
} from "./trust.js";

/** ADR-018 Karar 5 (Faz 8, Dilim D4) — güven merdiveni: sicil DEVREDEN türetilir, ayrı tablo YOK. */

function patch(overrides: Partial<PatchSummary> = {}): PatchSummary {
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    errorCode: "KOD_A",
    category: "KOD_A",
    branch: "doktor/kod-a",
    files: ["packages/core/src/router/router.ts"],
    testOk: true,
    testSummary: "geçti",
    state: "applied",
    resolvedAt: Date.now(),
    ...overrides,
  };
}

describe("readTrust/writeTrust — SAF roundtrip", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "symphony-trust-"));
    file = join(dir, "trust.json");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("dosya yoksa boş liste döner (çökme yok)", () => {
    expect(readTrust(file)).toEqual({ trusted: [] });
  });

  it("yaz → oku roundtrip", () => {
    writeTrust(file, { trusted: ["KOD_A", "KOD_B"] });
    expect(readTrust(file)).toEqual({ trusted: ["KOD_A", "KOD_B"] });
  });

  it("bozuk/eksik JSON alanları çökmeden boş listeye düşer", () => {
    // Elle bozuk içerik yaz (trusted alanı karışık tipte).
    writeFileSync(file, JSON.stringify({ trusted: [1, 2, "KOD_C"] }), "utf8");
    expect(readTrust(file)).toEqual({ trusted: ["KOD_C"] });
  });

  it("SENTAKS düzeyinde bozuk JSON (B3, 2026-07-11 mimari tarama): çökmeden boş listeye düşer", () => {
    // Yukarıdaki test yalnız YANLIŞ-ŞEKİLLİ ama GEÇERLİ JSON'u sınıyordu — JSON.parse'ın
    // GERÇEKTEN bozuk (sentaks hatalı) girdide fırlattığı durumu KAÇIRIYORDU.
    writeFileSync(file, "{ bu gecerli json degil", "utf8");
    expect(readTrust(file)).toEqual({ trusted: [] });
  });
});

describe("withTrust/withoutTrust/isTrusted — SAF", () => {
  it("withTrust ekler, tekrar eklemek çoğaltmaz, sıralı döner", () => {
    let trust = withTrust({ trusted: [] }, "KOD_B");
    trust = withTrust(trust, "KOD_A");
    trust = withTrust(trust, "KOD_A"); // tekrar
    expect(trust.trusted).toEqual(["KOD_A", "KOD_B"]);
  });

  it("withoutTrust yalnız verileni çıkarır", () => {
    const trust = withoutTrust({ trusted: ["KOD_A", "KOD_B"] }, "KOD_A");
    expect(trust.trusted).toEqual(["KOD_B"]);
  });

  it("isTrusted", () => {
    expect(isTrusted({ trusted: ["KOD_A"] }, "KOD_A")).toBe(true);
    expect(isTrusted({ trusted: ["KOD_A"] }, "KOD_B")).toBe(false);
  });
});

describe("categoryRecord — sicil PATCHES tablosundan türetilir (ayrı tablo YOK)", () => {
  it("applied SAĞLIKLI, reverted+failed UNHEALTHY sayılır", () => {
    const patches = [
      patch({ state: "applied" }),
      patch({ state: "applied" }),
      patch({ state: "reverted" }),
      patch({ state: "failed" }),
    ];
    expect(categoryRecord(patches, "KOD_A")).toEqual({
      category: "KOD_A",
      applied: 2,
      unhealthy: 2,
      total: 4,
    });
  });

  it("proposed/rejected sicile GİRMEZ (henüz/hiç kanıt üretmediler)", () => {
    const patches = [
      patch({ state: "applied" }),
      patch({ state: "proposed" }),
      patch({ state: "rejected" }),
    ];
    expect(categoryRecord(patches, "KOD_A")).toEqual({
      category: "KOD_A",
      applied: 1,
      unhealthy: 0,
      total: 1,
    });
  });

  it("başka kategorinin yamaları karışmaz", () => {
    const patches = [patch({ category: "KOD_A", state: "applied" }), patch({ category: "KOD_B", state: "reverted" })];
    expect(categoryRecord(patches, "KOD_A")).toEqual({
      category: "KOD_A",
      applied: 1,
      unhealthy: 0,
      total: 1,
    });
  });

  it("hiç kaydı olmayan kategori: total 0", () => {
    expect(categoryRecord([], "YOK")).toEqual({ category: "YOK", applied: 0, unhealthy: 0, total: 0 });
  });
});

describe("categoryTouchedProtected — DEĞİŞMEZLERİ blanket-trust'tan korur (ADR-018 Karar 4)", () => {
  it("kategorinin GEÇMİŞTE korumalı yola dokunan bir yaması varsa true", () => {
    const patches = [
      patch({ state: "applied", files: ["packages/core/src/router/router.ts"] }),
      patch({ state: "reverted", files: ["packages/core/src/agent/engine.ts"] }), // korumalı
    ];
    expect(categoryTouchedProtected(patches, "KOD_A")).toBe(true);
  });

  it("hiç korumalı yola dokunmadıysa false", () => {
    const patches = [patch({ files: ["packages/core/src/router/router.ts"] })];
    expect(categoryTouchedProtected(patches, "KOD_A")).toBe(false);
  });

  it("başka kategorinin korumalı dokunuşu BU kategoriyi etkilemez", () => {
    const patches = [patch({ category: "KOD_B", files: ["packages/core/src/agent/engine.ts"] })];
    expect(categoryTouchedProtected(patches, "KOD_A")).toBe(false);
  });
});
