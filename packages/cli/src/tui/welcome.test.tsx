import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ProviderHealth, Usage } from "@symphony/shared";
import { LOGO_LINES } from "./logo.js";
import { Welcome } from "./welcome.js";

const providers: ProviderHealth[] = [
  { provider: "anthropic", status: "up" },
  { provider: "ollama", status: "up" },
  { provider: "openai", status: "down" },
];
const totals: Usage = { inputTokens: 1_200, outputTokens: 345, costUsd: 0.0091 };

describe("Welcome (Faz 2.5 kabul testi)", () => {
  it("logo + sürüm/protokol + sağlayıcı durumu + kullanım özetini gösterir", () => {
    const { lastFrame } = render(<Welcome providers={providers} totals={totals} />);
    const frame = lastFrame() ?? "";

    // Logo tek modülden geliyor (ink satır sonu boşluklarını kırpar → trimEnd)
    for (const line of LOGO_LINES) expect(frame).toContain(line.trimEnd());
    expect(frame).toContain("protokol v1");
    expect(frame).toContain("anthropic");
    expect(frame).toContain("openai");
    expect(frame).toContain("token"); // 1.545 token — ayraç yerelde değişebilir
    expect(frame).toContain("$0.0091");
    expect(frame).toContain("Ctrl+C");
    // Tarih gerçekten bugünün yılını taşıyor (statik metin değil)
    expect(frame).toContain(String(new Date().getFullYear()));
  });
});
