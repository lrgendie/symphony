import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureProfileScaffold,
  formatProfileContext,
  loadProfile,
  MAX_PROFILE_CHARS,
  PROFILE_SCAFFOLD,
  readProfileSnapshot,
  writeProfile,
} from "./profile.js";

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

describe("readProfileSnapshot (REST GET /api/memory, Dilim M2)", () => {
  it("dosya yoksa iskeleti döner, updatedAt null", () => {
    const snapshot = readProfileSnapshot(file());
    expect(snapshot.content).toBe(PROFILE_SCAFFOLD);
    expect(snapshot.chars).toBe(PROFILE_SCAFFOLD.length);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.updatedAt).toBeNull();
  });

  it("dosya varsa TAM içeriği döner (loadProfile'ın aksine kesmez/iskelet-null yapmaz)", () => {
    const f = file();
    writeFileSync(f, "## Kimlik\nDeniz\n", "utf8");
    const snapshot = readProfileSnapshot(f);
    expect(snapshot.content).toBe("## Kimlik\nDeniz\n");
    expect(snapshot.chars).toBe("## Kimlik\nDeniz\n".length);
    expect(snapshot.updatedAt).not.toBeNull();
  });

  it("MAX_PROFILE_CHARS aşılırsa truncated:true ama content KESİLMEZ (insan görüntüsü)", () => {
    const f = file();
    const long = "a".repeat(MAX_PROFILE_CHARS + 500);
    writeFileSync(f, long, "utf8");
    const snapshot = readProfileSnapshot(f);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.content).toBe(long);
    expect(snapshot.chars).toBe(long.length);
  });
});

describe("formatProfileContext (canlı bulgu düzeltmesi, 2026-07-10)", () => {
  it("profil metnini kapsar VE kimlik karışıklığına karşı açıkça uyarır", () => {
    const block = formatProfileContext("## Kimlik\nAdım Deniz.\n");
    expect(block).toContain("Adım Deniz.");
    // Küçük yerel modelin "ben kimim?" sorusuna profildeki ismi kendi kimliği sanmaması için
    // metnin bunu KULLANICIya ait olarak, SENİN kimliğin OLMADIĞINI açıkça belirtmesi gerekir.
    expect(block).toContain("SENİN kimliğin DEĞİL");
    expect(block).toContain("KULLANICIYA aittir");
  });
});

describe("writeProfile (REST PUT /api/memory, Dilim M2)", () => {
  it("üst dizin yoksa da oluşturup TAM içeriği yazar ve okunabilir snapshot döner", () => {
    dir = mkdtempSync(join(tmpdir(), "symphony-profile-test-"));
    const nested = join(dir, "memory", "profil.md");
    const snapshot = writeProfile(nested, "## Kimlik\nDeniz\n");
    expect(readFileSync(nested, "utf8")).toBe("## Kimlik\nDeniz\n");
    expect(snapshot.content).toBe("## Kimlik\nDeniz\n");
  });

  it("var olan dosyayı TAM değiştirir (üzerine yazar)", () => {
    const f = file();
    writeFileSync(f, PROFILE_SCAFFOLD, "utf8");
    const snapshot = writeProfile(f, "## Kimlik\nyeni içerik\n");
    expect(readFileSync(f, "utf8")).toBe("## Kimlik\nyeni içerik\n");
    expect(snapshot.content).toBe("## Kimlik\nyeni içerik\n");
  });
});
