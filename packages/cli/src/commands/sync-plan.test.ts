import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { buildGitignoreContent, planLocalBackup, SYNC_WHITELIST } from "./sync-plan.js";

describe("buildGitignoreContent (ADR-017 Karar 3) — SAF", () => {
  it("* ile başlar (her şey yoksayılır varsayılan olarak)", () => {
    expect(buildGitignoreContent().split("\n")[0]).toBe("*");
  });

  it("düz dosyalar (config.json/providers.json/mcp-servers.json) TEK negatifle eklenir", () => {
    const content = buildGitignoreContent();
    expect(content).toContain("!config.json\n");
    expect(content).toContain("!providers.json\n");
    expect(content).toContain("!mcp-servers.json\n");
  });

  it("dizinler (agents/memory) İKİ negatifle eklenir — kendisi + içeriği recursive", () => {
    const content = buildGitignoreContent();
    expect(content).toContain("!agents/\n!agents/**\n");
    expect(content).toContain("!memory/\n!memory/**\n");
  });

  it("daemon.token/data/logs/desktop.pid/reports beyaz listede YOK (negatiflenmez)", () => {
    const content = buildGitignoreContent();
    for (const forbidden of ["daemon.token", "data", "logs", "desktop.pid", "reports"]) {
      expect(content).not.toContain(`!${forbidden}`);
    }
  });
});

describe("planLocalBackup — SAF", () => {
  it("her var olan girdiyi <ad>.bak hedefine eşler", () => {
    const plan = planLocalBackup("/home/.symphony", ["config.json", "agents"]);
    expect(plan).toEqual([
      { from: join("/home/.symphony", "config.json"), to: join("/home/.symphony", "config.json.bak") },
      { from: join("/home/.symphony", "agents"), to: join("/home/.symphony", "agents.bak") },
    ]);
  });

  it("boş liste → boş plan", () => {
    expect(planLocalBackup("/home/.symphony", [])).toEqual([]);
  });
});

describe("SYNC_WHITELIST", () => {
  it("beklenen 5 girdiyi TAM olarak içerir (fazla/eksik yok)", () => {
    expect(SYNC_WHITELIST).toEqual(["config.json", "providers.json", "agents", "memory", "mcp-servers.json"]);
  });
});
