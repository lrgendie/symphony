/**
 * Marka logosu — TEK değişim noktası (ROADMAP Faz 2.5).
 * Kullanıcının kendi logosu geldiğinde yalnız bu dosya güncellenir:
 * LOGO_LINES satırları ASCII/Unicode sanata çevrilmiş logoyla değiştirilir.
 * Kural: genişlik ≤ 60 sütun (dar terminallerde taşmasın), yükseklik ≤ 8 satır.
 *
 * Geçici banner: "Calvin S" figlet stili (kutu çizgi karakterleri).
 */
export const LOGO_LINES: readonly string[] = [
  "╔═╗ ╦ ╦ ╔╦╗ ╔═╗ ╦ ╦ ╔═╗ ╔╗╔ ╦ ╦",
  "╚═╗ ╚╦╝ ║║║ ╠═╝ ╠═╣ ║ ║ ║║║ ╚╦╝",
  "╚═╝  ╩  ╩ ╩ ╩   ╩ ╩ ╚═╝ ╝╚╝  ╩ ",
];

/** Logo satırlarının renkleri (üstten alta) — marka paletiyle uyumlu tutulur. */
export const LOGO_COLORS: readonly string[] = ["cyanBright", "cyan", "blueBright"];

export const LOGO_TAGLINE = "yerel + bulut LLM orkestrasyonu";
