import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AGENT_TOOLS,
  isDestructiveCommand,
  maskSecrets,
  sanitizedEnv,
  type ToolContext,
} from "./tools.js";
import { WorkspaceJail } from "./jail.js";
import { AgentError } from "./errors.js";

const workspace = join(tmpdir(), `symphony-tools-test-${Date.now()}`);
let ctx: ToolContext;
const signal = (): AbortSignal => new AbortController().signal;

beforeAll(() => {
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "const selam = 1;\nconst selam2 = 1;\n", "utf8");
  ctx = { jail: new WorkspaceJail(workspace) };
});

afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("araç seti (SPEC-AGENT §2)", () => {
  it("read_file okur; olmayan dosya AGENT_FILE_NOT_FOUND", async () => {
    await expect(AGENT_TOOLS.read_file.execute({ path: "src/a.ts" }, ctx, signal())).resolves
      .toContain("selam");
    await expect(
      AGENT_TOOLS.read_file.execute({ path: "yok.ts" }, ctx, signal()),
    ).rejects.toThrowError(AgentError);
  });

  it("write_file önizlemesi diff + taban hash verir, execute iç içe dizin oluşturur", async () => {
    const args = { path: "derin/klasor/yeni.txt", content: "merhaba\n" };
    const preview = AGENT_TOOLS.write_file.preview?.(args, ctx);
    expect(preview?.diff).toContain("+merhaba");
    expect(preview?.baseHash).toBe("YENI-DOSYA");
    await AGENT_TOOLS.write_file.execute(args, ctx, signal());
    expect(readFileSync(join(workspace, "derin", "klasor", "yeni.txt"), "utf8")).toBe("merhaba\n");
  });

  it("edit belirsiz eşleşmeyi reddeder, replaceAll ile değiştirir", async () => {
    const ambiguous = { path: "src/a.ts", oldText: "const selam", newText: "let selam" };
    await expect(AGENT_TOOLS.edit.execute(ambiguous, ctx, signal())).rejects.toThrowError(
      /VALIDATION_EDIT_AMBIGUOUS|geçiyor/,
    );
    await AGENT_TOOLS.edit.execute({ ...ambiguous, replaceAll: true }, ctx, signal());
    expect(readFileSync(join(workspace, "src", "a.ts"), "utf8")).not.toContain("const selam");
  });

  it("glob ve grep bulur; geçersiz regex VALIDATION_TOOL_ARGS", async () => {
    await expect(AGENT_TOOLS.glob.execute({ pattern: "src/**/*.ts" }, ctx, signal())).resolves
      .toContain("src/a.ts");
    const hits = await AGENT_TOOLS.grep.execute({ pattern: "let selam" }, ctx, signal());
    expect(hits).toMatch(/src\/a\.ts:1/);
    await expect(
      AGENT_TOOLS.grep.execute({ pattern: "([bozuk" }, ctx, signal()),
    ).rejects.toThrowError(AgentError);
  });

  it("run_command çalışır ve çıkış kodunu bildirir", async () => {
    const out = await AGENT_TOOLS.run_command.execute({ command: "echo selamlar" }, ctx, signal());
    expect(out).toContain("çıkış kodu: 0");
    expect(out).toContain("selamlar");
  });

  it("run_command ortamından anahtar taşıyan değişkenler temizlenir (SPEC §8.4)", async () => {
    process.env["SYMPHONY_TEST_API_KEY"] = "cok-gizli-deger";
    try {
      expect(sanitizedEnv()["SYMPHONY_TEST_API_KEY"]).toBeUndefined();
      const cmd =
        process.platform === "win32"
          ? 'echo "deger=[$env:SYMPHONY_TEST_API_KEY]"'
          : 'echo "deger=[$SYMPHONY_TEST_API_KEY]"';
      const out = await AGENT_TOOLS.run_command.execute({ command: cmd }, ctx, signal());
      expect(out).not.toContain("cok-gizli-deger");
    } finally {
      delete process.env["SYMPHONY_TEST_API_KEY"];
    }
  });

  it("yıkıcı komut sezgiseli (SPEC §2): silme/push/publish destructive", () => {
    expect(isDestructiveCommand("rm -rf node_modules")).toBe(true);
    expect(isDestructiveCommand("del a.txt")).toBe(true);
    expect(isDestructiveCommand("Remove-Item a.txt")).toBe(true);
    expect(isDestructiveCommand("git push origin main")).toBe(true);
    expect(isDestructiveCommand("pnpm publish")).toBe(true);
    expect(isDestructiveCommand("pnpm test")).toBe(false);
    expect(isDestructiveCommand("git status")).toBe(false);
    expect(isDestructiveCommand("modele git")).toBe(false); // 'del' kelime içinde değil
    expect(AGENT_TOOLS.run_command.riskClass({ command: "rm -rf x" })).toBe("destructive");
    expect(AGENT_TOOLS.run_command.riskClass({ command: "pnpm build" })).toBe("mutating");
  });

  it("format/mkfs sezgiseli PowerShell'in Format-* cmdlet'lerini yanlış pozitif işaretlemez", () => {
    // Gerçek koşuda görüldü (2026-07-05): Format-Table salt-okunur bir listeleme
    // cmdlet'i ama eski desen \b(format|mkfs)\b onu disk biçimlendirmeyle karıştırıyordu.
    expect(isDestructiveCommand("Get-ChildItem | Format-Table -AutoSize")).toBe(false);
    expect(isDestructiveCommand("Get-ChildItem | Format-List")).toBe(false);
    expect(isDestructiveCommand("Get-Process | Format-Wide")).toBe(false);
    expect(isDestructiveCommand("format C:")).toBe(true); // gerçek disk biçimlendirme hâlâ yakalanır
    expect(isDestructiveCommand("mkfs.ext4 /dev/sda1")).toBe(true);
  });

  it("maskSecrets anahtar desenlerini yıldızlar (SPEC §8.3)", () => {
    expect(maskSecrets("anahtar: sk-abc123def456ghj olsun")).toBe("anahtar: *** olsun");
    expect(maskSecrets("AIzaSyB1234567890abc")).toBe("***");
    expect(maskSecrets("temiz metin")).toBe("temiz metin");
  });

  it("araçlar jail dışına çıkamaz", async () => {
    await expect(
      AGENT_TOOLS.read_file.execute({ path: "../../etc/passwd" }, ctx, signal()),
    ).rejects.toThrowError(AgentError);
    expect(() =>
      AGENT_TOOLS.write_file.permissionTarget({ path: "..\\kacak.txt", content: "x" }, ctx),
    ).toThrowError(AgentError);
  });
});
