import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureSymphonyHome, getSymphonyHome, getSymphonyPaths } from "./paths.js";

const testHome = join(tmpdir(), `symphony-test-${Date.now()}`);

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  delete process.env["SYMPHONY_HOME"];
});

describe("~/.symphony yapısı", () => {
  it("SYMPHONY_HOME ortam değişkeni ev dizinini geçersiz kılar", () => {
    process.env["SYMPHONY_HOME"] = testHome;
    expect(getSymphonyHome()).toBe(testHome);
  });

  it("tüm yollar home altında ve GEREKSINIMLER.md §4 ile uyumludur", () => {
    const paths = getSymphonyPaths(testHome);
    expect(paths.configFile).toBe(join(testHome, "config.json"));
    expect(paths.providersFile).toBe(join(testHome, "providers.json"));
    expect(paths.databaseFile).toBe(join(testHome, "data", "symphony.db"));
    expect(paths.daemonTokenFile).toBe(join(testHome, "daemon.token"));
    expect(paths.permissionsFile).toBe(join(testHome, "permissions.json"));
    expect(paths.mcpServersFile).toBe(join(testHome, "mcp-servers.json"));
  });

  it("ensureSymphonyHome dizin ağacını oluşturur (idempotent)", () => {
    const paths = ensureSymphonyHome(testHome);
    for (const dir of [
      paths.home,
      paths.agentsDir,
      paths.memoryDir,
      paths.dataDir,
      paths.logsDir,
    ]) {
      expect(existsSync(dir), dir).toBe(true);
    }
    // İkinci çağrı hata fırlatmamalı.
    expect(() => ensureSymphonyHome(testHome)).not.toThrow();
  });
});
