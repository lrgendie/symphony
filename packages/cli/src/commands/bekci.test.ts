import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-018 Karar 7 (Faz 8, Dilim D6) — `trust.ts`/D4 ile AYNI CLI test deseni. `repoPath`
 * doğrulaması için GERÇEK git (canlı prova bulgusu, 2026-07-11): `repoPath` bir repo KÖKÜ
 * değilse, D2'nin `git worktree add`i sessizce bir ATA dizinin `.git`ini bulup ORAYA açar —
 * kullanıcının alakasız bir repo'suna (ör. ev dizini) yama dalı sızabilirdi. Bu yüzden
 * `bekci ekle` artık kayıt anında GERÇEK bir repo kökü şartı koşar.
 */

let bekciFile = "";
vi.mock("@lrgendie/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lrgendie/core")>();
  return {
    ...actual, // readBekciRegistry/writeBekciRegistry/withBekciProject GERÇEK kalır
    getSymphonyPaths: () => ({ home: "/home", bekciFile }),
  };
});

import { readBekciRegistry } from "@lrgendie/core";
import { bekciEkleCommand, bekciListeCommand } from "./bekci.js";

let dir: string;
let repo: string;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "symphony-bekci-cli-"));
  bekciFile = join(dir, "bekci.json");
  repo = join(dir, "repo");
  mkdirSync(repo);
  execSync("git init", { cwd: repo });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe("bekciEkleCommand", () => {
  it("repo yolu YOKSA reddeder — kayıt dosyasına yazmaz", async () => {
    await expect(
      bekciEkleCommand("x", join(dir, "olmayan-repo"), join(dir, "log.txt"), {}),
    ).rejects.toThrow(/repo yolu yok/);
    expect(readBekciRegistry(bekciFile).projeler).toEqual([]);
  });

  it("dizin VAR ama git repo KÖKÜ DEĞİLSE reddeder — kayıt dosyasına yazmaz (canlı bulgu)", async () => {
    const gitDisiKlasor = join(dir, "duz-klasor");
    mkdirSync(gitDisiKlasor);
    await expect(
      bekciEkleCommand("x", gitDisiKlasor, join(dir, "log.txt"), {}),
    ).rejects.toThrow(/git repo KÖKÜ değil/);
    expect(readBekciRegistry(bekciFile).projeler).toEqual([]);
  });

  it("git repo İÇİNDEKİ (ama kökü OLMAYAN) bir alt klasör de reddedilir — ata repo'ya sızma önlenir", async () => {
    const altKlasor = join(repo, "alt-klasor");
    mkdirSync(altKlasor);
    await expect(bekciEkleCommand("x", altKlasor, join(dir, "log.txt"), {})).rejects.toThrow(
      /git repo KÖKÜ değil/,
    );
  });

  it("geçerli repo KÖKÜ ile KAYDEDER — logFile henüz VAR OLMASA bile (proje hiç çalışmamış olabilir)", async () => {
    await bekciEkleCommand("proje-a", repo, join(dir, "henuz-olmayan-log.txt"), {});
    const { projeler } = readBekciRegistry(bekciFile);
    expect(projeler).toHaveLength(1);
    expect(projeler[0]?.ad).toBe("proje-a");
    expect(projeler[0]?.testCommand).toBeUndefined();
  });

  it("--test verilirse testCommand kaydedilir", async () => {
    await bekciEkleCommand("proje-a", repo, join(dir, "l.txt"), { test: "npm test" });
    expect(readBekciRegistry(bekciFile).projeler[0]?.testCommand).toBe("npm test");
  });

  it("AYNI ad tekrar eklenirse GÜNCELLER (çoğaltmaz)", async () => {
    await bekciEkleCommand("proje-a", repo, join(dir, "l1.txt"), {});
    await bekciEkleCommand("proje-a", repo, join(dir, "l2.txt"), { test: "pytest" });
    const { projeler } = readBekciRegistry(bekciFile);
    expect(projeler).toHaveLength(1);
    expect(projeler[0]?.testCommand).toBe("pytest");
  });

  it("yollar MUTLAK hale getirilir (göreli yol verilse bile)", async () => {
    await bekciEkleCommand("proje-a", ".", "log.txt", {}); // "." = gerçek repo kökü (bu monorepo)
    const { projeler } = readBekciRegistry(bekciFile);
    expect(projeler[0]?.repoPath).not.toBe(".");
    expect(projeler[0]?.logFile).not.toBe("log.txt");
  });
});

describe("bekciListeCommand", () => {
  it("kayıt yoksa çökmez, bilgilendirir", () => {
    expect(() => bekciListeCommand()).not.toThrow();
  });

  it("kayıtlı projeleri basar", async () => {
    await bekciEkleCommand("proje-a", repo, join(dir, "l.txt"), { test: "npm test" });
    bekciListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("proje-a");
    expect(output).toContain("npm test");
  });

  it("testCommand tanımsızsa UYARI gösterir (dürüst sınır)", async () => {
    await bekciEkleCommand("proje-b", repo, join(dir, "l.txt"), {});
    bekciListeCommand();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("TANIMSIZ");
  });
});
