import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ModelInfo } from "@symphony/shared";
import { ModelPicker } from "./model-picker.js";

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-opus-4-8", local: false, contextWindow: 1_000_000 },
  { provider: "ollama", id: "qwen3:8b", local: true, contextWindow: 40_960 },
];

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ModelPicker", () => {
  it("tüm sağlayıcıların modellerini listeler (kabul testi: model seçici)", () => {
    const { lastFrame } = render(<ModelPicker models={models} onPick={() => undefined} />);
    expect(lastFrame()).toContain("anthropic/claude-opus-4-8");
    expect(lastFrame()).toContain("ollama/qwen3:8b");
    expect(lastFrame()).toContain("yerel");
  });

  it("↓ + Enter ikinci modeli seçer", async () => {
    let picked: ModelInfo | undefined;
    const { stdin } = render(
      <ModelPicker
        models={models}
        onPick={(model) => {
          picked = model;
        }}
      />,
    );
    await tick();
    stdin.write("\u001B[B"); // aşağı ok
    await tick();
    stdin.write("\r"); // Enter
    await tick();
    expect(picked?.id).toBe("qwen3:8b");
  });
});
