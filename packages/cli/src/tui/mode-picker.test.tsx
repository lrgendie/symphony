import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { ModePicker, type TuiMode } from "./mode-picker.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ModePicker", () => {
  it("Sohbet ve Agent seçeneklerini listeler", () => {
    const { lastFrame } = render(<ModePicker onPick={() => undefined} />);
    expect(lastFrame()).toContain("Sohbet");
    expect(lastFrame()).toContain("Agent");
  });

  it("↓ + Enter Agent modunu seçer", async () => {
    let picked: TuiMode | undefined;
    const { stdin } = render(
      <ModePicker
        onPick={(mode) => {
          picked = mode;
        }}
      />,
    );
    await tick();
    stdin.write("[B"); // aşağı ok
    await tick();
    stdin.write("\r"); // Enter
    await tick();
    expect(picked).toBe("agent");
  });
});
