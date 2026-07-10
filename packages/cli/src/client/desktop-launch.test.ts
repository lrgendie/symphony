import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSymphonyPaths } from "@symphony/core";
import { ensureDesktopRunning, findRepoRoot } from "./desktop-launch.js";

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
