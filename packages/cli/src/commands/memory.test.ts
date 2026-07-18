import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ModelInfo } from "@lrgendie/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import {
  buildDistillTask,
  listArchiveFilesByRecency,
  resolveDistillModel,
  writeDistillDraft,
} from "./memory.js";

let dir: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env["SYMPHONY_HOME"];
});

describe("listArchiveFilesByRecency (Dilim M3)", () => {
  it("dosyaları en yeniden en eskiye sıralar, node_modules/.git'i atlar", () => {
    dir = mkdtempSync(join(tmpdir(), "symphony-distill-test-"));
    mkdirSync(join(dir, "alt"), { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "eski.md"), "eski", "utf8");
    writeFileSync(join(dir, "alt", "yeni.md"), "yeni", "utf8");
    writeFileSync(join(dir, "node_modules", "yoksay.md"), "yoksay", "utf8");

    const now = Date.now();
    utimesSync(join(dir, "eski.md"), new Date(now - 60_000), new Date(now - 60_000));
    utimesSync(join(dir, "alt", "yeni.md"), new Date(now), new Date(now));

    const files = listArchiveFilesByRecency(dir);
    expect(files).toEqual(["alt/yeni.md", "eski.md"]);
  });

  it("boş dizin boş dizi döner", () => {
    dir = mkdtempSync(join(tmpdir(), "symphony-distill-test-"));
    expect(listArchiveFilesByRecency(dir)).toEqual([]);
  });
});

describe("buildDistillTask", () => {
  it("dizin yolu + dosya sırasını + karakter bütçesini görev metnine yazar", () => {
    const task = buildDistillTask("C:/arsiv", ["a.md", "b.md"]);
    expect(task).toContain("C:/arsiv");
    expect(task).toContain("- a.md\n- b.md");
    expect(task).toContain("6000 karakter");
  });

  it("dosya yoksa (dizin boş) açıkça belirtir", () => {
    expect(buildDistillTask("C:/arsiv", [])).toContain("(dizin boş)");
  });
});

describe("resolveDistillModel (gizlilik varsayılanı, ADR-013 Karar 5)", () => {
  function fakeClient(models: ModelInfo[]): DaemonClient {
    return { request: async () => ({ models }) } as unknown as DaemonClient;
  }

  it("--bulut verilmezse yerel modeli AÇIKÇA pinler", async () => {
    const client = fakeClient([
      { provider: "anthropic", id: "claude-opus-4-8", local: false },
      { provider: "ollama", id: "qwen3:8b", local: true },
    ]);
    await expect(resolveDistillModel(client, false)).resolves.toEqual({
      provider: "ollama",
      model: "qwen3:8b",
    });
  });

  it("yerel model yoksa ve --bulut verilmediyse hata fırlatır", async () => {
    const client = fakeClient([{ provider: "anthropic", id: "claude-opus-4-8", local: false }]);
    await expect(resolveDistillModel(client, false)).rejects.toThrow(/buluta gönderilmez/);
  });

  it("--bulut verilirse models.list'e HİÇ sormaz, pinlemez (router seçsin)", async () => {
    const client = { request: () => Promise.reject(new Error("çağrılmamalıydı")) } as unknown as DaemonClient;
    await expect(resolveDistillModel(client, true)).resolves.toEqual({});
  });
});

describe("writeDistillDraft (canlı profil GÜVENLİĞİ, ADR-013 Karar 2/5)", () => {
  it("taslağı profil.taslak.md'ye yazar; profil.md'ye HİÇ dokunmaz", () => {
    dir = mkdtempSync(join(tmpdir(), "symphony-distill-home-"));
    process.env["SYMPHONY_HOME"] = dir;
    mkdirSync(join(dir, "memory"), { recursive: true });
    writeFileSync(join(dir, "memory", "profil.md"), "CANLI-PROFIL-DEĞİŞMEMELİ", "utf8");

    const draftFile = writeDistillDraft("## Kimlik\nDamıtılmış metin\n");

    expect(draftFile).toBe(join(dir, "memory", "profil.taslak.md"));
    expect(readFileSync(draftFile, "utf8")).toBe("## Kimlik\nDamıtılmış metin\n");
    // Kritik güvenlik özelliği: canlı profil dosyası BAYTI BAYTINA aynı kaldı.
    expect(readFileSync(join(dir, "memory", "profil.md"), "utf8")).toBe(
      "CANLI-PROFIL-DEĞİŞMEMELİ",
    );
  });
});
