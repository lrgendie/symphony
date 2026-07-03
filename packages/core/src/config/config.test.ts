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
    expect(existsSync(paths.configFile)).toBe(true);
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
