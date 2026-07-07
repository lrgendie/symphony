import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateDaemonToken, loadExistingToken, persistDaemonToken } from "./token.js";

const dir = mkdtempSync(path.join(tmpdir(), "symphony-token-"));
const tokenFile = path.join(dir, "daemon.token");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("daemon token — yeniden kullanım (2026-07-07 güvenilirlik düzeltmesi)", () => {
  it("generateDaemonToken 64 karakterlik hex üretir", () => {
    expect(generateDaemonToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dosya yoksa loadExistingToken null döner (çağıran yeni üretir)", () => {
    expect(loadExistingToken(path.join(dir, "yok.token"))).toBeNull();
  });

  it("bozuk/kısa token dosyası reddedilir → null (geçersiz token'la kilitlenme yok)", () => {
    const bad = path.join(dir, "bozuk.token");
    writeFileSync(bad, "kisa-ve-hex-degil");
    expect(loadExistingToken(bad)).toBeNull();
  });

  it("persist edilen geçerli token yeniden okunur (restart'ta istemci kopmaz)", () => {
    const token = generateDaemonToken();
    persistDaemonToken(tokenFile, token);
    expect(loadExistingToken(tokenFile)).toBe(token);
  });

  it("baştaki/sondaki boşluk ve yeni satır kırpılır", () => {
    const token = generateDaemonToken();
    writeFileSync(tokenFile, `  ${token}\n`);
    expect(loadExistingToken(tokenFile)).toBe(token);
  });
});
