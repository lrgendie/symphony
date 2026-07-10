import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config.js";
import { getSymphonyPaths } from "./paths.js";

const testHome = join(tmpdir(), `symphony-config-test-${Date.now()}`);

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe("config", () => {
  it("dosya yoksa varsayılanlar döner ve ilk config yazılır", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    const config = loadConfig(paths);
    expect(config.daemon.port).toBe(7770);
    expect(config.defaults.provider).toBe("anthropic");
    expect(config.desktop.autoLaunch).toBe(true); // Faz 4: varsayılan açık
    expect(config.limits.maxOutputTokens).toBe(8192); // kaçak üretim sigortası
    expect(existsSync(paths.configFile)).toBe(true);
  });

  it("limits.maxOutputTokens dosyadan ezilir; geçersiz değer (0) reddedilir", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    writeFileSync(paths.configFile, JSON.stringify({ limits: { maxOutputTokens: 16384 } }));
    expect(loadConfig(paths).limits.maxOutputTokens).toBe(16384);

    // Sigortayı fiilen kapatan bir değer sessizce kabul edilmemeli.
    writeFileSync(paths.configFile, JSON.stringify({ limits: { maxOutputTokens: 0 } }));
    expect(() => loadConfig(paths)).toThrow();
  });

  it("desktop.autoLaunch dosyada false ise ezilir", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    writeFileSync(paths.configFile, JSON.stringify({ desktop: { autoLaunch: false } }));
    expect(loadConfig(paths).desktop.autoLaunch).toBe(false);
  });

  it("desktop.appPath vars. tanımsız; dosyadan okunursa aynen döner (ADR-017, Dilim F3)", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    expect(loadConfig(paths).desktop.appPath).toBeUndefined();

    writeFileSync(
      paths.configFile,
      JSON.stringify({ desktop: { appPath: "C:\\Program Files\\Symphony\\Symphony.exe" } }),
    );
    expect(loadConfig(paths).desktop.appPath).toBe("C:\\Program Files\\Symphony\\Symphony.exe");
  });

  it("dosyadaki değerler varsayılanları ezer, bilinmeyen alanlar atılır", () => {
    mkdirSync(testHome, { recursive: true });
    const paths = getSymphonyPaths(testHome);
    writeFileSync(paths.configFile, JSON.stringify({ daemon: { port: 9999 }, sürpriz: 1 }));
    const config = loadConfig(paths);
    expect(config.daemon.port).toBe(9999);
    expect(config.defaults.model).toBe("claude-opus-4-8");
    expect("sürpriz" in config).toBe(false);
  });
});
