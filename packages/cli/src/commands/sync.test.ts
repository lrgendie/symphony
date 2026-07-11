import { afterEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { syncCommand, syncInitCommand } from "./sync.js";

/**
 * ADR-017 Karar 3 — gerçek git, AĞ YOK: uzak bir yerel "bare" repo (dosya sistemi yolu) ile
 * temsil edilir. `daemon.token`/`data/` gibi beyaz-liste DIŞI dosyalar kasıtlı yazılıp asla
 * senkronlanmadıkları doğrulanır (güvenlik kabulü).
 */

const dirsToClean: string[] = [];

/**
 * `syncInitCommand` yalnız repo YOKSA `git init` çağırır — burada ÖNCEDEN init edip test-özel
 * bir yazar kimliği kuruyoruz (host makinenin genel git config'inden BAĞIMSIZ; CI/dev makinede
 * `user.name`/`user.email` global ayarlanmamışsa commit "Author identity unknown" ile patlardı).
 */
function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphony-sync-home-"));
  dirsToClean.push(dir);
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@symphony.local"', { cwd: dir });
  execSync('git config user.name "Symphony Test"', { cwd: dir });
  return dir;
}

/** Git ile HİÇ init edilmemiş düz bir dizin — "sync init hiç çalıştırılmadı" senaryosu için. */
function freshPlainHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphony-sync-plain-"));
  dirsToClean.push(dir);
  return dir;
}

function freshBareRemote(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphony-sync-remote-"));
  dirsToClean.push(dir);
  execSync("git init --bare -b main", { cwd: dir });
  return dir;
}

afterEach(() => {
  for (const dir of dirsToClean.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("symphony sync (ADR-017 Karar 3) — gerçek git, ağ YOK", () => {
  // Gerçek git süreçleri birden çok depoda çalışır — tam paket koşusunda sistem yüklüyken
  // vitest'in varsayılan 5000ms'i yetersiz kalabiliyordu (izole koşuda sorun yoktu).
  it("ilk makine yerel beyaz-listeyi uzağa gönderir; ikinci makine indirir — daemon.token/data SENKRONLANMAZ", async () => {
    const remote = freshBareRemote();
    const home1 = freshHome();
    mkdirSync(join(home1, "agents"), { recursive: true });
    writeFileSync(join(home1, "config.json"), '{"a":1}', "utf8");
    writeFileSync(join(home1, "agents", "asistan.md"), "# asistan", "utf8");
    // Beyaz liste DIŞI — sync'e hiç girmemeli.
    writeFileSync(join(home1, "daemon.token"), "gizli-token", "utf8");
    mkdirSync(join(home1, "data"), { recursive: true });
    writeFileSync(join(home1, "data", "symphony.db"), "ikili-veri", "utf8");

    await syncInitCommand(remote, home1);

    const home2 = freshHome();
    await syncInitCommand(remote, home2);

    expect(readFileSync(join(home2, "config.json"), "utf8")).toBe('{"a":1}');
    expect(readFileSync(join(home2, "agents", "asistan.md"), "utf8")).toBe("# asistan");
    expect(existsSync(join(home2, "daemon.token"))).toBe(false);
    expect(existsSync(join(home2, "data"))).toBe(false);

    const tracked = (await simpleGit(home2).raw(["ls-files"])).split("\n").filter(Boolean);
    expect(tracked.some((f) => f.includes("daemon.token"))).toBe(false);
    expect(tracked.some((f) => f.startsWith("data"))).toBe(false);
    expect(tracked).toContain("config.json");
  }, 15000);

  it("çakışan değişiklik: ikinci makine pull --rebase çakışınca DURUR, elle çöz mesajı basar", async () => {
    const remote = freshBareRemote();
    const home1 = freshHome();
    writeFileSync(join(home1, "config.json"), '{"a":1}', "utf8");
    await syncInitCommand(remote, home1);

    const home2 = freshHome();
    await syncInitCommand(remote, home2);

    // home1 değiştirip senkronlar — uzak ilerler.
    writeFileSync(join(home1, "config.json"), '{"a":2}', "utf8");
    await syncCommand(home1);

    // home2, home1'in ilerlemesinden HABERSİZ aynı dosyayı FARKLI değiştirir.
    writeFileSync(join(home2, "config.json"), '{"a":3}', "utf8");

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("__EXIT__");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(syncCommand(home2)).rejects.toThrow("__EXIT__");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("çakıştı"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  }, 15000);

  it("`sync init` hiç çalıştırılmadan `sync` çağrılırsa net hatayla durur", async () => {
    const home = freshPlainHome();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("__EXIT__");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(syncCommand(home)).rejects.toThrow("__EXIT__");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("sync init"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
