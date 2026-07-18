import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSymphonyPaths } from "@lrgendie/core";
import {
  candidateInstalledAppPaths,
  ensureDesktopRunning,
  findExistingPath,
  findRepoRoot,
} from "./desktop-launch.js";

/**
 * Faz 4: gerçek bir Tauri süreci başlatmak testte pratik değil (Rust/GUI ortamı gerektirir) —
 * yalnız SAF/kontrol edilebilir kısımlar test edilir: monorepo kökü bulma + "zaten çalışıyor"/
 * "kapalı" kısa-devreleri (gerçek spawn'a hiç gidilmeden doğrulanabilir).
 */

const testHome = join(tmpdir(), `symphony-desktop-launch-test-${Date.now()}`);

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe("findRepoRoot", () => {
  it("bu CLI'nin çalıştığı monorepo kökünü bulur (pnpm-workspace.yaml)", () => {
    const root = findRepoRoot();
    expect(root).not.toBeNull();
    expect(existsSync(join(root ?? "", "pnpm-workspace.yaml"))).toBe(true);
  });
});

describe("candidateInstalledAppPaths (ADR-017, Dilim F3) — SAF", () => {
  it("appPath verilmemişse yalnız bilinen kurulum dizinleri (LOCALAPPDATA + Program Files)", () => {
    const candidates = candidateInstalledAppPaths(undefined, { LOCALAPPDATA: "C:\\Users\\d\\AppData\\Local" });
    // app.exe: Cargo paketi "app" (yeniden adlandırılmadı) — canlı NSIS kurulumuyla doğrulandı.
    expect(candidates).toEqual([
      "C:\\Users\\d\\AppData\\Local\\Symphony\\app.exe",
      "C:\\Program Files\\Symphony\\app.exe",
    ]);
  });

  it("appPath verilmişse İLK aday odur (elle geçersiz kılma öncelikli)", () => {
    const candidates = candidateInstalledAppPaths("D:\\ozel\\Symphony.exe", { LOCALAPPDATA: "C:\\AL" });
    expect(candidates[0]).toBe("D:\\ozel\\Symphony.exe");
    expect(candidates).toHaveLength(3);
  });

  it("LOCALAPPDATA ortam değişkeni yoksa o aday sessizce atlanır (Program Files hâlâ var)", () => {
    const candidates = candidateInstalledAppPaths(undefined, {});
    expect(candidates).toEqual(["C:\\Program Files\\Symphony\\app.exe"]);
  });
});

describe("findExistingPath — SAF, exists enjekte edilir", () => {
  it("listedeki İLK var olan yolu döner", () => {
    const exists = (p: string): boolean => p === "b";
    expect(findExistingPath(["a", "b", "c"], exists)).toBe("b");
  });

  it("hiçbiri yoksa null döner", () => {
    expect(findExistingPath(["a", "b"], () => false)).toBeNull();
  });

  it("boş liste → null", () => {
    expect(findExistingPath([], () => true)).toBeNull();
  });
});

describe("ensureDesktopRunning (en iyi gayret, gerçek spawn'a gitmeyen kısa-devreler)", () => {
  it("desktop.autoLaunch:false ise PID dosyası hiç yazılmaz (spawn denenmez)", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    writeFileSync(paths.configFile, JSON.stringify({ desktop: { autoLaunch: false } }), "utf8");

    ensureDesktopRunning(testHome);

    expect(existsSync(paths.desktopPidFile)).toBe(false);
  });

  it("PID dosyasındaki süreç hâlâ CANLIYSA yeniden başlatmaz (PID dosyası değişmez)", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    // Kendi test sürecimizin PID'i her zaman canlıdır — gerçek bir "zaten açık" senaryosunu taklit eder.
    writeFileSync(paths.desktopPidFile, String(process.pid), "utf8");

    ensureDesktopRunning(testHome);

    // Değişmediyse (aynı PID) yeni bir süreç başlatılmamış demektir.
    expect(readFileSync(paths.desktopPidFile, "utf8").trim()).toBe(String(process.pid));
  });

  it("hata durumunda (ör. bozuk config) sessizce yutulur — fırlatmaz", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    writeFileSync(paths.configFile, "{ bozuk json", "utf8");

    expect(() => ensureDesktopRunning(testHome)).not.toThrow();
  });
});
