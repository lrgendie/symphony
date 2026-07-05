import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { AgentSummary } from "@symphony/shared";
import { AgentPicker } from "./agent-picker.js";

const agents: AgentSummary[] = [
  { id: "coder", name: "coder", description: "kod agent'ı", tools: ["read_file"], mcpServers: [], maxSteps: 50 },
  { id: "mcp-tester", name: "mcp-tester", description: "test", tools: [], mcpServers: ["filesystem"], maxSteps: 10 },
];

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("AgentPicker", () => {
  it("kayıtlı agent'ları listeler", () => {
    const { lastFrame } = render(<AgentPicker agents={agents} onPick={() => undefined} />);
    expect(lastFrame()).toContain("coder");
    expect(lastFrame()).toContain("mcp-tester");
  });

  it("agent yoksa uyarı gösterir", () => {
    const { lastFrame } = render(<AgentPicker agents={[]} onPick={() => undefined} />);
    expect(lastFrame()).toContain("Kayıtlı agent yok");
  });

  it("↓ + Enter ikinci agent'ı seçer", async () => {
    let picked: AgentSummary | undefined;
    const { stdin } = render(
      <AgentPicker
        agents={agents}
        onPick={(agent) => {
          picked = agent;
        }}
      />,
    );
    await tick();
    stdin.write("[B");
    await tick();
    stdin.write("\r");
    await tick();
    expect(picked?.id).toBe("mcp-tester");
  });
});
