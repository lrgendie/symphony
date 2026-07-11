import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import chalk from "chalk";
import { execa } from "execa";
import { getSymphonyPaths, loadConfig } from "@symphony/core";
import { ensureDaemonRunning } from "../client/daemon-client.js";

/**
 * `symphony update` / `symphony rollback` (ADR-017 Karar 4) — manuel, tek komutla geri
 * alınabilir sürüm yönetimi. Güncelleme npm registry'ye DELEGE edilir (kendi güncelleyici
 * mekanizması YAZILMAZ); `versions.json` yalnız {previous,current,at} geçmişini tutar.
 * Agent araç yüzeyinden bu komutlara giden bir yol YOKTUR — daima insan tetikler.
 */

export interface VersionsFile {
  previous: string;
  current: string;
  /** epoch ms */
  at: number;
}

/** SAF: versions.json'ı okur — dosya yoksa (henüz hiç update çalışmamış) null. */
export function readVersions(file: string): VersionsFile | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as VersionsFile;
}

/** SAF: versions.json'a yazar (2-boşluklu JSON, satır sonu ile — repo konvansiyonu). */
export function writeVersions(file: string, versions: VersionsFile): void {
  writeFileSync(file, `${JSON.stringify(versions, null, 2)}\n`, "utf8");
}

/** SAF: `update` sonrası kayıt — şimdiki sürüm `previous` olur, yeni sürüm `current`. */
export function nextVersions(currentBeforeUpdate: string, newVersion: string): VersionsFile {
  return { previous: currentBeforeUpdate, current: newVersion, at: Date.now() };
}

/** SAF: `rollback` sonrası kayıt — previous/current YER DEĞİŞTİRİR (tekrar rollback = tekrar ileri gider). */
export function swappedVersions(versions: VersionsFile): VersionsFile {
  return { previous: versions.current, current: versions.previous, at: Date.now() };
}

interface OwnPackage {
  name: string;
  version: string;
}

function readOwnPackage(): OwnPackage {
  const require = createRequire(import.meta.url);
  return require("@symphony/cli/package.json") as OwnPackage;
}

/**
 * Daemon çalışıyorsa TEMİZ kapatır (`POST /api/shutdown`, ADR-017 Karar 4) — token dosyası
 * yoksa (hiç başlatılmamış) sessizce atlanır; istek başarısız olsa da (daemon zaten kapanmış
 * olabilir) sorun değil, `ensureDaemonRunning` devamını halleder.
 */
async function shutdownDaemonIfRunning(home?: string): Promise<void> {
  const paths = getSymphonyPaths(home);
  if (!existsSync(paths.daemonTokenFile)) return;
  const config = loadConfig(paths);
  const token = readFileSync(paths.daemonTokenFile, "utf8").trim();
  try {
    await fetch(`http://127.0.0.1:${config.daemon.port}/api/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Daemon zaten çalışmıyordu ya da bağlantı koptu — devam edilir.
  }
}

/** `symphony update` — npm registry'de yeni sürüm varsa kurar, daemon'ı yeniden başlatır. */
export async function updateCommand(home?: string): Promise<void> {
  const pkg = readOwnPackage();
  const { stdout } = await execa("npm", ["view", pkg.name, "version"], { windowsHide: true });
  const latest = stdout.trim();

  if (latest === pkg.version) {
    console.log(chalk.green(`✔ zaten güncel (${pkg.version})`));
    return;
  }

  console.log(chalk.dim(`${pkg.version} → ${latest} güncelleniyor...`));
  await execa("npm", ["install", "-g", `${pkg.name}@${latest}`], { windowsHide: true });

  const paths = getSymphonyPaths(home);
  writeVersions(paths.versionsFile, nextVersions(pkg.version, latest));

  await shutdownDaemonIfRunning(home);
  await ensureDaemonRunning(home);
  console.log(chalk.green(`✔ ${latest} sürümüne güncellendi, daemon yeniden başlatıldı`));
}

/** `symphony rollback` — son `update`den önceki sürüme döner. */
export async function rollbackCommand(home?: string): Promise<void> {
  const paths = getSymphonyPaths(home);
  const versions = readVersions(paths.versionsFile);
  if (versions === null) {
    console.error(chalk.yellow("⚠ geri alınacak bir sürüm kaydı yok — henüz `symphony update` çalıştırılmadı."));
    process.exit(1);
  }

  console.log(chalk.dim(`${versions.current} → ${versions.previous} geri alınıyor...`));
  const pkg = readOwnPackage();
  await execa("npm", ["install", "-g", `${pkg.name}@${versions.previous}`], { windowsHide: true });
  writeVersions(paths.versionsFile, swappedVersions(versions));

  await shutdownDaemonIfRunning(home);
  await ensureDaemonRunning(home);
  console.log(chalk.green(`✔ ${versions.previous} sürümüne geri alındı, daemon yeniden başlatıldı`));
}
