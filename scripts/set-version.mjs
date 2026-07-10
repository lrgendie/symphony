#!/usr/bin/env node
// ADR-017 (Faz 7, Dilim F1): lockstep sürüm — kök + shared/core/cli package.json'larına AYNI
// sürümü yazar. Bağımlılık yok; düz fs+JSON. Kullanım: node scripts/set-version.mjs 0.2.0

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGETS = ["package.json", "packages/shared/package.json", "packages/core/package.json", "packages/cli/package.json"];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function main() {
  const version = process.argv[2];
  if (version === undefined || !SEMVER.test(version)) {
    console.error("Kullanım: node scripts/set-version.mjs <semver> (ör. 0.2.0)");
    process.exit(1);
  }

  for (const relPath of TARGETS) {
    const file = join(ROOT, relPath);
    const raw = readFileSync(file, "utf8");
    const pkg = JSON.parse(raw);
    pkg.version = version;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    console.log(`✔ ${relPath} → ${version}`);
  }
}

main();
