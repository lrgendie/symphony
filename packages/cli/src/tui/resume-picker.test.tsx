import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { HistorySessionSummary } from "@lrgendie/shared";
import { ResumePicker, type ResumeChoice } from "./resume-picker.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const DOWN = String.fromCharCode(27, 91, 66); // aşağı ok: ESC [ B

const lastSession: HistorySessionSummary = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  provider: "ollama",
  model: "qwen3:8b",
  title: "kuantum nedir",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 4,
};

describe("ResumePicker", () => {
  it("yeni/devam seçeneklerini ve önceki sohbet özetini listeler", () => {
    const { lastFrame } = render(
      <ResumePicker lastSession={lastSession} onPick={() => undefined} />,
    );
    expect(lastFrame()).toContain("Yeni sohbet");
    expect(lastFrame()).toContain("Önceki sohbete devam et");
    expect(lastFrame()).toContain("ollama/qwen3:8b");
    expect(lastFrame()).toContain("4 mesaj");
    expect(lastFrame()).toContain("kuantum nedir");
  });

  it("varsayılan Enter yeni sohbeti seçer", async () => {
    let picked: ResumeChoice | undefined;
    const { stdin } = render(
      <ResumePicker
        lastSession={lastSession}
        onPick={(choice) => {
          picked = choice;
        }}
      />,
    );
    await tick();
    stdin.write("\r");
    await tick();
    expect(picked).toBe("new");
  });

  it("aşağı ok + Enter önceki sohbete devam eder", async () => {
    let picked: ResumeChoice | undefined;
    const { stdin } = render(
      <ResumePicker
        lastSession={lastSession}
        onPick={(choice) => {
          picked = choice;
        }}
      />,
    );
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write("\r");
    await tick();
    expect(picked).toBe("continue");
  });
});
