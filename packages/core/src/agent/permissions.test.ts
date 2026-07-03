import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { matchesPattern, PermissionEngine } from "./permissions.js";

const base = join(tmpdir(), `symphony-perm-test-${Date.now()}`);
mkdirSync(base, { recursive: true });
const file = join(base, "permissions.json");

beforeEach(() => rmSync(file, { force: true }));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("PermissionEngine (SPEC-AGENT §5)", () => {
  it("kural yokken risk sınıfı varsayılanı geçerlidir", () => {
    const engine = new PermissionEngine(file);
    expect(engine.decide("read_file", "a.txt", "safe")).toBe("allow");
    expect(engine.decide("write_file", "a.txt", "mutating")).toBe("ask");
    expect(engine.decide("run_command", "rm -rf x", "destructive")).toBe("ask");
  });

  it("karar sırası: deny > allow > varsayılan", () => {
    writeFileSync(
      file,
      JSON.stringify({
        rules: [
          { tool: "write_file", pattern: "**/*.md", decision: "allow" },
          { tool: "write_file", pattern: "docs/**", decision: "deny" },
        ],
      }),
      "utf8",
    );
    const engine = new PermissionEngine(file);
    expect(engine.decide("write_file", "README.md", "mutating")).toBe("allow");
    expect(engine.decide("write_file", "docs/a.md", "mutating")).toBe("deny"); // iki kural da eşleşir → deny kazanır
    expect(engine.decide("write_file", "src/x.ts", "mutating")).toBe("ask");
  });

  it("run_command desenleri düz jokerdir (SPEC örneği: pnpm test*)", () => {
    expect(matchesPattern("run_command", "pnpm test*", "pnpm test")).toBe(true);
    expect(matchesPattern("run_command", "pnpm test*", "pnpm test --watch a/b")).toBe(true);
    expect(matchesPattern("run_command", "pnpm test*", "pnpm build")).toBe(false);
  });

  it("always_allow kalıcılaştırması yazar, yineleme yapmaz", () => {
    const engine = new PermissionEngine(file);
    engine.addAllowRule("write_file", "src/a.ts");
    engine.addAllowRule("write_file", "src/a.ts");
    const saved = JSON.parse(readFileSync(file, "utf8")) as { rules: unknown[] };
    expect(saved.rules).toHaveLength(1);
    expect(engine.decide("write_file", "src/a.ts", "mutating")).toBe("allow");
    expect(engine.decide("write_file", "src/b.ts", "mutating")).toBe("ask");
  });

  it("bozuk kural dosyası sessizce yutulmaz", () => {
    writeFileSync(file, "{bozuk json", "utf8");
    const engine = new PermissionEngine(file);
    expect(() => engine.decide("write_file", "a.ts", "mutating")).toThrow();
  });
});
