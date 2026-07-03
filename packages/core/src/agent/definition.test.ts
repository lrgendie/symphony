import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureDefaultAgent,
  listAgentDefinitions,
  loadAgentDefinition,
  parseAgentMarkdown,
} from "./definition.js";
import { AgentError } from "./errors.js";

const agentsDir = join(tmpdir(), `symphony-def-test-${Date.now()}`);

beforeAll(() => mkdirSync(agentsDir, { recursive: true }));
afterAll(() => rmSync(agentsDir, { recursive: true, force: true }));

describe("agent tanımları (SPEC-AGENT §1)", () => {
  it("frontmatter'ı ayrıştırır: skaler, dizi, sayı, satır sonu yorumu", () => {
    const def = parseAgentMarkdown(
      "coder",
      `---
name: coder
description: Kod yazan agent
model: claude-sonnet-5
provider: anthropic
temperature: 0   # varsayılan zaten 0
tools: [read_file, write_file]
maxSteps: 50
---
Sistem prompt'u burada.`,
    );
    expect(def.name).toBe("coder");
    expect(def.provider).toBe("anthropic");
    expect(def.temperature).toBe(0);
    expect(def.tools).toEqual(["read_file", "write_file"]);
    expect(def.maxSteps).toBe(50);
    expect(def.systemPrompt).toBe("Sistem prompt'u burada.");
  });

  it("varsayılanlar: temperature 0 (ADR-008), tüm araçlar, maxSteps 50", () => {
    const def = parseAgentMarkdown("mini", `---\nname: mini\n---\nPrompt.`);
    expect(def.temperature).toBe(0);
    expect(def.tools).toHaveLength(6);
    expect(def.maxSteps).toBe(50);
  });

  it("frontmatter yoksa / bilinmeyen araç varsa AGENT_DEFINITION_INVALID", () => {
    expect(() => parseAgentMarkdown("x", "sadece metin")).toThrowError(AgentError);
    expect(() =>
      parseAgentMarkdown("x", `---\nname: x\ntools: [format_disk]\n---\nP`),
    ).toThrowError(AgentError);
  });

  it("dosyadan yükler; olmayan agent AGENT_UNKNOWN", () => {
    writeFileSync(join(agentsDir, "test.md"), `---\nname: test\n---\nP`, "utf8");
    expect(loadAgentDefinition(agentsDir, "test").id).toBe("test");
    expect(() => loadAgentDefinition(agentsDir, "yok")).toThrowError(AgentError);
  });

  it("varsayılan coder tanımı bir kez yazılır ve geçerlidir", () => {
    ensureDefaultAgent(agentsDir);
    const first = readFileSync(join(agentsDir, "coder.md"), "utf8");
    ensureDefaultAgent(agentsDir); // ikinci çağrı üstüne yazmaz
    expect(readFileSync(join(agentsDir, "coder.md"), "utf8")).toBe(first);
    const coder = loadAgentDefinition(agentsDir, "coder");
    expect(coder.tools).toHaveLength(6);
    expect(coder.temperature).toBe(0);
  });

  it("liste bozuk tanımı atlar, geçerlileri sıralı verir", () => {
    writeFileSync(join(agentsDir, "bozuk.md"), "frontmatter yok", "utf8");
    const ids = listAgentDefinitions(agentsDir).map((d) => d.id);
    expect(ids).toContain("coder");
    expect(ids).toContain("test");
    expect(ids).not.toContain("bozuk");
  });
});
