import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProjectVerification } from "./sandbox.js";

/**
 * ADR-018 Karar 7 (Faz 8, Dilim D6) — GERÇEK alt-süreç: bekçi projelerinin KENDİ `testCommand`'ı
 * (`pnpm build/test/lint` sabit zincirinin YERİNE geçer). `exit 0`/`exit 1` cmd.exe (Windows
 * `shell:true`) VE POSIX sh'de AYNI şekilde çalışır — cross-platform güvenli bir kanıt.
 */
describe("runProjectVerification — GERÇEK execa (shell:true)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "symphony-verify-"));
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  it("çıkış kodu 0 → ok:true", async () => {
    const result = await runProjectVerification(cwd, "exit 0");
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("exit 0");
  });

  it("çıkış kodu sıfır DEĞİLSE → ok:false + çıkış kodu özette", async () => {
    const result = await runProjectVerification(cwd, "exit 1");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("DÜŞTÜ");
    expect(result.summary).toContain("1");
  });

  it("komut BULUNAMAZSA çökmez, ok:false döner (boru hattı düşmez)", async () => {
    const result = await runProjectVerification(cwd, "kesinlikle-var-olmayan-komut-xyz");
    expect(result.ok).toBe(false);
  });
});
