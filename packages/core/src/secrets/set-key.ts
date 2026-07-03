#!/usr/bin/env node
// Anahtar kaydetme aracı — anahtarı komut satırı ARGÜMANI olarak almaz
// (kabuk geçmişine düşmesin); SYMPHONY_KEY ortam değişkeninden okur.
//
// Kullanım (PowerShell):
//   $env:SYMPHONY_KEY = "sk-ant-..."
//   pnpm --filter @symphony/core key:set anthropic
//   Remove-Item Env:SYMPHONY_KEY
import { createSecretStore } from "./secret-store.js";

const provider = process.argv[2];
const key = process.env["SYMPHONY_KEY"];

if (!provider || !key) {
  console.error("Kullanım: SYMPHONY_KEY ortam değişkenini ayarla, sonra: key:set <provider>");
  process.exit(1);
}

const store = await createSecretStore();
await store.set(provider, key);
const masked = `${key.slice(0, 10)}...${key.slice(-4)}`;
console.log(`✔ '${provider}' anahtarı ${store.backend} kasasına kaydedildi (${masked})`);
