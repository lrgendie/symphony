/**
 * Marka logosu — TEK değişim noktası (ROADMAP Faz 2.5).
 * Kaynak: kullanıcının logosu (2026-07-03) — nöral sinaps düğümlü tesseract
 * (hiperküp): camgöbeği dış küp iskeleti, mor iç küp, tek kırmızı sinaps.
 * Terminal uyarlaması: dış kare = dış küp, iç kare = iç küp, köşe çaprazları =
 * boyutlar arası bağlar; ◉ = görseldeki parlayan kırmızı sinaps düğümü.
 *
 * Kural: toplam genişlik ≤ 60 sütun, yükseklik ≤ 8 satır.
 * Satır içi renk gerektiği için satırlar segment listesidir.
 */
export interface LogoSegment {
  text: string;
  /** Ink Text rengi; verilmezse varsayılan terminal rengi. */
  color?: string;
}

const EDGE = "cyan"; // dış iskelet + boyut bağları
const NODE = "cyanBright"; // dış köşe düğümleri
const INNER = "magentaBright"; // iç küp düğümleri
const INNER_EDGE = "magenta"; // iç küp kenarları
const SYNAPSE = "redBright"; // parlayan sinaps (görseldeki kırmızı düğüm)
const WORD = ["cyanBright", "cyan", "blueBright"]; // SYMPHONY yazısının satır renkleri

export const LOGO_LINES: readonly LogoSegment[][] = [
  [
    { text: "  " },
    { text: "●", color: NODE },
    { text: "─────────────", color: EDGE },
    { text: "●", color: NODE },
  ],
  [
    { text: "  " },
    { text: "│ ╲         ╱ │", color: EDGE },
    { text: "   " },
    { text: "╔═╗ ╦ ╦ ╔╦╗ ╔═╗ ╦ ╦ ╔═╗ ╔╗╔ ╦ ╦", color: WORD[0] },
  ],
  [
    { text: "  " },
    { text: "│", color: EDGE },
    { text: "  " },
    { text: "◆", color: INNER },
    { text: "───────", color: INNER_EDGE },
    { text: "◆", color: INNER },
    { text: "  " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "╚═╗ ╚╦╝ ║║║ ╠═╝ ╠═╣ ║ ║ ║║║ ╚╦╝", color: WORD[1] },
  ],
  [
    { text: "  " },
    { text: "│", color: EDGE },
    { text: "  " },
    { text: "│       │", color: INNER_EDGE },
    { text: "  " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "╚═╝  ╩  ╩ ╩ ╩   ╩ ╩ ╚═╝ ╝╚╝  ╩", color: WORD[2] },
  ],
  [
    { text: "  " },
    { text: "│", color: EDGE },
    { text: "  " },
    { text: "◆", color: INNER },
    { text: "───────", color: INNER_EDGE },
    { text: "◉", color: SYNAPSE },
    { text: "  " },
    { text: "│", color: EDGE },
  ],
  [{ text: "  " }, { text: "│ ╱         ╲ │", color: EDGE }],
  [
    { text: "  " },
    { text: "●", color: NODE },
    { text: "─────────────", color: EDGE },
    { text: "●", color: NODE },
  ],
];

export const LOGO_TAGLINE = "yerel + bulut LLM orkestrasyonu";

/** Test/önizleme için: bir logo satırının düz metni. */
export function logoLineText(line: readonly LogoSegment[]): string {
  return line.map((segment) => segment.text).join("");
}
