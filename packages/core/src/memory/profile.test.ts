import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureProfileScaffold, loadProfile, MAX_PROFILE_CHARS, PROFILE_SCAFFOLD } from "./profile.js";

let dir: string;

function file(): string {
  dir = mkdtempSync(join(tmpdir(), "symphony-profile-test-"));
  return join(dir, "profil.md");
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadProfile", () => {
  it("dosya yoksa null döner", () => {
    expect(loadProfile(file())).toBeNull();
  });

  it("boş dosya null döner", () => {
    const f = file();
    writeFileSync(f, "   \n  ", "utf8");
    expect(loadProfile(f)).toBeNull();
  });

  it("yalnız iskelet (kullanıcı henüz doldurmadı) → null", () => {
    const f = file();
    ensureProfileScaffold(f);
    expect(loadProfile(f)).toBeNull();
  });

  it("gerçek içerik varsa metni ve truncated:false döner", () => {
    const f = file();
    writeFileSync(f, "# Kullanıcı Profili\n\n## Kimlik\nAdım Deniz, TypeScript tercih ederim.\n", "utf8");
    const loaded = loadProfile(f);
    expect(loaded?.truncated).toBe(false);
    expect(loaded?.text).toContain("Deniz");
  });

  it("MAX_PROFILE_CHARS aşılırsa kesilir ve truncated:true", () => {
    const f = file();
    writeFileSync(f, "a".repeat(MAX_PROFILE_CHARS + 500), "utf8");
    const loaded = loadProfile(f);
    expect(loaded?.truncated).toBe(true);
    expect(loaded?.text.length).toBe(MAX_PROFILE_CHARS);
  });
});

describe("ensureProfileScaffold", () => {
  it("dosya yoksa iskeleti yazar", () => {
    const f = file();
    ensureProfileScaffold(f);
    expect(readFileSync(f, "utf8")).toBe(PROFILE_SCAFFOLD);
  });

  it("üst dizin yoksa da oluşturup yazar (paths.ts memoryDir deseni)", () => {
    dir = mkdtempSync(join(tmpdir(), "symphony-profile-test-"));
    const nested = join(dir, "memory", "profil.md");
    ensureProfileScaffold(nested);
    expect(readFileSync(nested, "utf8")).toBe(PROFILE_SCAFFOLD);
  });

  it("dosya VARSA dokunmaz (kullanıcı içeriği ezilmez)", () => {
    const f = file();
    writeFileSync(f, PROFILE_SCAFFOLD, "utf8");
    writeFileSync(f, "## Kimlik\nzaten dolu\n", "utf8");
    ensureProfileScaffold(f);
    expect(readFileSync(f, "utf8")).toBe("## Kimlik\nzaten dolu\n");
  });
});
