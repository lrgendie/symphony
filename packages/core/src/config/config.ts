import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { DEFAULT_DAEMON_PORT } from "@symphony/shared";
import { getSymphonyPaths, type SymphonyPaths } from "./paths.js";

/** `~/.symphony/config.json` şeması — bilinmeyen alanlar atılır (ileri uyumluluk). */
export const ConfigSchema = z
  .object({
    daemon: z
      .object({
        port: z.number().int().positive().default(DEFAULT_DAEMON_PORT),
      })
      .strip()
      .default({}),
    defaults: z
      .object({
        provider: z.string().default("anthropic"),
        model: z.string().default("claude-opus-4-8"),
      })
      .strip()
      .default({}),
    // ADR-013: kullanıcı profili enjeksiyonu — kirlenmiş/istenmeyen profilde hızlı kapatma.
    memory: z
      .object({
        enabled: z.boolean().default(true),
      })
      .strip()
      .default({}),
    // Faz 4: `symphony` başlatılınca masaüstü de otomatik açılsın mı (kapalıysa) — vars. açık.
    desktop: z
      .object({
        autoLaunch: z.boolean().default(true),
      })
      .strip()
      .default({}),
  })
  .strip();

export type SymphonyConfig = z.infer<typeof ConfigSchema>;

/** Config dosyasını okur; yoksa varsayılanları döndürür ve ilk dosyayı yazar. */
export function loadConfig(paths: SymphonyPaths = getSymphonyPaths()): SymphonyConfig {
  if (!existsSync(paths.configFile)) {
    const config = ConfigSchema.parse({});
    if (existsSync(paths.home)) {
      writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + "\n");
    }
    return config;
  }
  return ConfigSchema.parse(JSON.parse(readFileSync(paths.configFile, "utf8")));
}
