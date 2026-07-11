import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bekciErrorCode,
  findBekciProject,
  readBekciRegistry,
  withBekciProject,
  withoutBekciProject,
  writeBekciRegistry,
  type BekciRegistry,
} from "./registry.js";

/** ADR-018 Karar 7 (Faz 8, Dilim D6) — `trust.json` (D4) ile AYNI desen: SAF oku/yaz. */

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "symphony-bekci-"));
  file = join(dir, "bekci.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readBekciRegistry/writeBekciRegistry — SAF roundtrip", () => {
  it("dosya yoksa boş liste döner (çökme yok)", () => {
    expect(readBekciRegistry(file)).toEqual({ projeler: [] });
  });

  it("yaz → oku roundtrip", () => {
    const data: BekciRegistry = {
      projeler: [{ ad: "proje-a", repoPath: "/repo/a", logFile: "/repo/a/log.txt" }],
    };
    writeBekciRegistry(file, data);
    expect(readBekciRegistry(file)).toEqual(data);
  });

  it("testCommand opsiyoneldir, verilirse korunur", () => {
    writeBekciRegistry(file, {
      projeler: [{ ad: "x", repoPath: "/r", logFile: "/r/l", testCommand: "npm test" }],
    });
    expect(readBekciRegistry(file).projeler[0]?.testCommand).toBe("npm test");
  });

  it("bozuk/eksik alanlı girdiler çökmeden ELENİR", () => {
    writeFileSync(
      file,
      JSON.stringify({
        projeler: [
          { ad: "gecerli", repoPath: "/r", logFile: "/r/l" },
          { ad: "eksik-repo" }, // repoPath/logFile yok
          "bozuk-string",
          { ad: 5, repoPath: "/r", logFile: "/r/l" }, // ad yanlış tip
        ],
      }),
      "utf8",
    );
    expect(readBekciRegistry(file).projeler).toEqual([{ ad: "gecerli", repoPath: "/r", logFile: "/r/l" }]);
  });

  it("projeler alanı dizi değilse boş listeye düşer", () => {
    writeFileSync(file, JSON.stringify({ projeler: "bozuk" }), "utf8");
    expect(readBekciRegistry(file)).toEqual({ projeler: [] });
  });

  it("SENTAKS düzeyinde bozuk JSON (B3, 2026-07-11 mimari tarama): çökmeden boş listeye düşer", () => {
    writeFileSync(file, "{ bu gecerli json degil", "utf8");
    expect(readBekciRegistry(file)).toEqual({ projeler: [] });
  });
});

describe("findBekciProject", () => {
  const registry: BekciRegistry = {
    projeler: [
      { ad: "a", repoPath: "/a", logFile: "/a/l" },
      { ad: "b", repoPath: "/b", logFile: "/b/l" },
    ],
  };

  it("bulunca projeyi döner", () => {
    expect(findBekciProject(registry, "b")).toEqual({ ad: "b", repoPath: "/b", logFile: "/b/l" });
  });

  it("yoksa null döner", () => {
    expect(findBekciProject(registry, "yok")).toBeNull();
  });
});

describe("withBekciProject — ekle/güncelle (upsert), alfabetik sıralı", () => {
  it("yeni projeyi ekler", () => {
    const registry = withBekciProject({ projeler: [] }, { ad: "x", repoPath: "/x", logFile: "/x/l" });
    expect(registry.projeler).toEqual([{ ad: "x", repoPath: "/x", logFile: "/x/l" }]);
  });

  it("AYNI ad tekrar eklenirse GÜNCELLER (çoğaltmaz)", () => {
    let registry = withBekciProject({ projeler: [] }, { ad: "x", repoPath: "/eski", logFile: "/l" });
    registry = withBekciProject(registry, { ad: "x", repoPath: "/yeni", logFile: "/l" });
    expect(registry.projeler).toEqual([{ ad: "x", repoPath: "/yeni", logFile: "/l" }]);
  });

  it("birden fazla proje alfabetik sıralanır", () => {
    let registry: BekciRegistry = { projeler: [] };
    registry = withBekciProject(registry, { ad: "zeta", repoPath: "/z", logFile: "/z/l" });
    registry = withBekciProject(registry, { ad: "alfa", repoPath: "/a", logFile: "/a/l" });
    expect(registry.projeler.map((p) => p.ad)).toEqual(["alfa", "zeta"]);
  });
});

describe("withoutBekciProject", () => {
  it("yalnız verileni çıkarır", () => {
    const registry: BekciRegistry = {
      projeler: [
        { ad: "a", repoPath: "/a", logFile: "/a/l" },
        { ad: "b", repoPath: "/b", logFile: "/b/l" },
      ],
    };
    expect(withoutBekciProject(registry, "a").projeler.map((p) => p.ad)).toEqual(["b"]);
  });
});

describe("bekciErrorCode — proje adı → BEKCI_<AD> kodu (D4/D5'in kategori ad-alanını PAYLAŞIR)", () => {
  it("büyük harfe çevirir, güvenli olmayan karakterleri _ yapar", () => {
    expect(bekciErrorCode("proje-a")).toBe("BEKCI_PROJE_A");
    expect(bekciErrorCode("Müşteri Portalı")).toMatch(/^BEKCI_/);
  });

  it("hiç güvenli karakter yoksa BILINMEYEN'e düşer (boş kod ÜRETİLMEZ)", () => {
    expect(bekciErrorCode("---")).toBe("BEKCI_BILINMEYEN");
  });

  it("aynı ad HER ZAMAN aynı kodu üretir (deterministik)", () => {
    expect(bekciErrorCode("proje-a")).toBe(bekciErrorCode("proje-a"));
  });
});
