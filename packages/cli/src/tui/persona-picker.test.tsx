import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { AgentSummary } from "@lrgendie/shared";
import { PersonaPicker, type Persona } from "./persona-picker.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const DOWN = String.fromCharCode(27, 91, 66); // aşağı ok: ESC [ B (ink downArrow bunu tanır)

const agents: AgentSummary[] = [
  { id: "asistan", name: "asistan", description: "salt-okur sohbet", tools: ["read_file"], mcpServers: [], maxSteps: 50 },
  { id: "coder", name: "coder", description: "dosya/komut", tools: ["write_file"], mcpServers: [], maxSteps: 50 },
];

describe("PersonaPicker (Dilim 2.3 — birleşik giriş)", () => {
  it("Sohbet'i İLK seçenek olarak, ardından kayıtlı agent'ları listeler", () => {
    const { lastFrame } = render(<PersonaPicker agents={agents} onPick={() => undefined} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Sohbet");
    expect(frame).toContain("asistan");
    expect(frame).toContain("coder");
    // Sohbet, agent'lardan önce gelmeli (ilk satır seçili ❯).
    expect(frame.indexOf("Sohbet")).toBeLessThan(frame.indexOf("asistan"));
  });

  it("Enter (varsayılan) → Sohbet personası döner", async () => {
    let picked: Persona | undefined;
    const { stdin } = render(
      <PersonaPicker agents={agents} onPick={(p) => (picked = p)} />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    expect(picked).toEqual({ kind: "chat" });
  });

  it("↓ + Enter → ilk agent (asistan) personası döner", async () => {
    let picked: Persona | undefined;
    const { stdin } = render(
      <PersonaPicker agents={agents} onPick={(p) => (picked = p)} />,
    );
    await tick();
    stdin.write(DOWN); // Sohbet → asistan
    await tick();
    stdin.write("\r");
    await tick();
    expect(picked).toEqual({ kind: "agent", agent: agents[0] });
  });

  it("agent yoksa yalnız Sohbet listelenir (boş liste çökmez)", () => {
    const { lastFrame } = render(<PersonaPicker agents={[]} onPick={() => undefined} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Sohbet");
    expect(frame).not.toContain("asistan");
  });
});
