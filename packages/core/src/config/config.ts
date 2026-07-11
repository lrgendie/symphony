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
        /**
         * ADR-017 (Faz 7, Dilim F3): kurulu masaüstü uygulamasının .exe yolu — otomatik arama
         * (bilinen kurulum dizinleri) yetersiz kalırsa elle geçersiz kılmak için. Vars. tanımsız
         * (otomatik arama kullanılır).
         */
        appPath: z.string().min(1).optional(),
      })
      .strip()
      .default({}),
    /**
     * Kaçak üretim sigortası (canlı bulgu #1, 2026-07-10): `temperature:0`daki küçük yerel
     * modeller uzun/yapılandırılmış isteklerde tekrar döngüsüne girip DURMA token'ı hiç
     * üretmeyebiliyor (gözlenen: 15+ dk GPU %98). Bu tavan hem agent turlarına hem sohbete
     * uygulanır — koşunun SONLANMASINI garanti eder. Agent tanımı (`maxOutputTokens`
     * frontmatter) ve `chat.start.options.maxTokens` bu değeri ezebilir.
     */
    limits: z
      .object({
        maxOutputTokens: z.number().int().positive().max(200_000).default(8192),
      })
      .strip()
      .default({}),
    /**
     * Kendini geliştirme (ADR-018, Faz 8): doktor boru hattının ayarları. `repoPath` verilmezse
     * daemon KENDİ konumundan yukarı doğru `pnpm-workspace.yaml` arar (repo checkout'undan
     * çalışıyorsa bulur); paketlenmiş (npm-global) kurulumda bulunamaz ve `doctor.run` net
     * hatayla durur — kendine-yama yalnız kaynak repo'dan çalışan daemon için anlamlıdır.
     */
    selfDev: z
      .object({
        repoPath: z.string().min(1).optional(),
        minRecurrence: z.number().int().positive().default(3),
        windowDays: z.number().int().positive().default(7),
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
