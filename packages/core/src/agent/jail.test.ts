import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceJail } from "./jail.js";
import { AgentError } from "./errors.js";

const base = join(tmpdir(), `symphony-jail-test-${Date.now()}`);
const workspace = join(base, "ws");
const outside = join(base, "disari");
const extra = join(base, "ek");

beforeAll(() => {
  for (const dir of [workspace, join(workspace, "alt"), outside, extra]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(workspace, "a.txt"), "icerik", "utf8");
  writeFileSync(join(outside, "gizli.txt"), "gizli", "utf8");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("WorkspaceJail (SPEC-AGENT §3)", () => {
  it("göreli ve mutlak iç yolları çözer", () => {
    const jail = new WorkspaceJail(workspace);
    expect(jail.resolve("a.txt")).toContain("a.txt");
    expect(jail.resolve(join(workspace, "alt"))).toContain("alt");
    // henüz var olmayan dosya (write_file yeni dosya) da çözülür
    expect(jail.resolve("alt/yeni/dosya.txt")).toContain("dosya.txt");
  });

  it("../ kaçışını PERMISSION_JAIL ile reddeder", () => {
    const jail = new WorkspaceJail(workspace);
    expect(() => jail.resolve("../disari/gizli.txt")).toThrowError(AgentError);
    try {
      jail.resolve("..");
    } catch (error) {
      expect((error as AgentError).name).toBe("PERMISSION_JAIL");
    }
  });

  it("dışarıyı gösteren mutlak yolu reddeder", () => {
    const jail = new WorkspaceJail(workspace);
    expect(() => jail.resolve(join(outside, "gizli.txt"))).toThrowError(AgentError);
  });

  it("kök adının önekiyle başlayan kardeş dizine izin vermez", () => {
    // ws vs ws-kardes: path.relative "../ws-kardes" döndürür → dışarıda.
    const sibling = join(base, "ws-kardes");
    mkdirSync(sibling, { recursive: true });
    const jail = new WorkspaceJail(workspace);
    expect(() => jail.resolve(sibling)).toThrowError(AgentError);
  });

  it("extraDirs açık onaylı ek kök sayılır", () => {
    const jail = new WorkspaceJail(workspace, [extra]);
    expect(jail.resolve(join(extra, "yeni.txt"))).toContain("yeni.txt");
  });

  it("symlink gerçek hedefine çözülür ve kaçış yakalanır", () => {
    const linkPath = join(workspace, "tuzak");
    try {
      symlinkSync(outside, linkPath, "junction"); // Windows'ta junction ayrıcalık istemez
    } catch {
      return; // symlink oluşturulamayan ortamda (izin yok) bu senaryo atlanır
    }
    const jail = new WorkspaceJail(workspace);
    expect(() => jail.resolve("tuzak/gizli.txt")).toThrowError(AgentError);
  });

  it("var olmayan cwd AGENT_CWD_INVALID fırlatır", () => {
    expect(() => new WorkspaceJail(join(base, "yok-boyle-dizin"))).toThrowError(AgentError);
  });
});
