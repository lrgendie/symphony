import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ADR-018 Karar 8 (Faz 8, Dilim D7) — `symphony agent-oneri uygula` GERÇEK dosyaya yazar
 * (`applyAgentModelPin` mock'lanmadı); yalnız daemon bağlantısı (rapor çekme) mock'lanır.
 */

const getReportMock = vi.fn();
const closeMock = vi.fn();
vi.mock("../client/daemon-client.js", () => ({
  connectToDaemon: async () => ({ getReport: getReportMock, close: closeMock }),
}));

let agentsDir = "";
vi.mock("@lrgendie/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lrgendie/core")>();
  return {
    ...actual, // applyAgentModelPin/agentDefinitionFilePath GERÇEK kalır
    getSymphonyPaths: () => ({ home: "/home", agentsDir }),
  };
});

const questionMock = vi.fn(async () => "e");
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question: questionMock, close: vi.fn() }),
}));

import { agentOneriUygulaCommand } from "./agent-suggestion.js";

const SUGGESTION = {
  agentId: "coder",
  suggestedProvider: "anthropic",
  suggestedModel: "claude-sonnet-5",
  suggestedRuns: 8,
  suggestedSuccessRate: 0.9,
  runnerUpProvider: "ollama",
  runnerUpModel: "qwen3:8b",
  runnerUpSuccessRate: 0.3,
  reason: "'coder' agent'ı anthropic/claude-sonnet-5 ile son 8 koşuda %90 başarılı.",
};

let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  dir = mkdtempSync(join(tmpdir(), "symphony-agent-oneri-cli-"));
  agentsDir = dir;
  writeFileSync(
    join(dir, "coder.md"),
    "---\nname: coder\ndescription: kod agent'ı\ntemperature: 0\n---\nSistem promptu.\n",
    "utf8",
  );
  getReportMock.mockImplementation(async () => ({ agentSuggestions: [SUGGESTION] }));
  questionMock.mockImplementation(async () => "e");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("agentOneriUygulaCommand", () => {
  it("eşleşen öneri yoksa reddeder — dosyaya DOKUNMAZ", async () => {
    await expect(agentOneriUygulaCommand("hic-olmayan-agent")).rejects.toThrow(/açık bir öneri yok/);
    expect(readFileSync(join(dir, "coder.md"), "utf8")).not.toContain("provider:");
  });

  it("onaylanırsa dosyaya GERÇEKTEN yazar — yalnız provider/model satırları, gövde korunur", async () => {
    await agentOneriUygulaCommand("coder");
    const written = readFileSync(join(dir, "coder.md"), "utf8");
    expect(written).toContain("provider: anthropic");
    expect(written).toContain("model: claude-sonnet-5");
    expect(written).toContain("Sistem promptu.");
    expect(written).toContain("temperature: 0"); // diğer alanlar dokunulmadı
  });

  it("onaylanmazsa dosya DEĞİŞMEZ", async () => {
    questionMock.mockImplementation(async () => "h");
    await agentOneriUygulaCommand("coder");
    const content = readFileSync(join(dir, "coder.md"), "utf8");
    expect(content).not.toContain("provider:");
  });

  it("rapor daemon'dan TEK SEFER çekilir, bağlantı kapatılır", async () => {
    await agentOneriUygulaCommand("coder");
    expect(getReportMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
