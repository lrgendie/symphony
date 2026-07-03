/**
 * Marka logosu — TEK değişim noktası (ROADMAP Faz 2.5).
 * Kaynak: kullanıcının logosu (2026-07-03, revizyon 2) — tesseract:
 * kompakt izometrik dış küp (camgöbeği), içinde izometrik iç küp (mor),
 * dış ve iç köşeler İNCE (gri) çapraz çizgilerle bağlı (boyutlar arası kenar),
 * ◉ = kırmızı sinaps düğümü — iç küpün ön yüz MERKEZİNDE, figürün odağı.
 * Görünmeyen (arkada kalan) kenarlar çizilmez — derinlik hissi bundan gelir.
 *
 * Kural: toplam genişlik ≤ 60 sütun, yükseklik ≤ 12 satır.
 * Satır içi renk gerektiği için satırlar segment listesidir.
 */
export interface LogoSegment {
  text: string;
  /** Ink Text rengi; verilmezse varsayılan terminal rengi. */
  color?: string;
}

const EDGE = "cyan"; // dış küp kenarları
const NODE = "cyanBright"; // dış köşe düğümleri
const LINK = "gray"; // dış↔iç köşe bağları (ince çizgisel yapı)
const INNER_EDGE = "magenta"; // iç küp kenarları
const INNER_NODE = "magentaBright"; // iç küp düğümleri
const SYNAPSE = "redBright"; // kırmızı sinaps — merkez odak
const WORD = ["cyanBright", "cyan", "blueBright"]; // SYMPHONY satır renkleri

export const LOGO_LINES: readonly LogoSegment[][] = [
  [
    { text: "      " },
    { text: "●", color: NODE },
    { text: "───────────", color: EDGE },
    { text: "●", color: NODE },
  ],
  [
    { text: "     " },
    { text: "╱", color: EDGE },
    { text: "           " },
    { text: "╱│", color: EDGE },
  ],
  [
    { text: "    " },
    { text: "●", color: NODE },
    { text: "───────────", color: EDGE },
    { text: "●", color: NODE },
    { text: " " },
    { text: "│", color: EDGE },
  ],
  [
    { text: "    " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "╲", color: LINK },
    { text: "  " },
    { text: "◆", color: INNER_NODE },
    { text: "───", color: INNER_EDGE },
    { text: "◆", color: INNER_NODE },
    { text: "╱", color: LINK },
    { text: " " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "╔═╗ ╦ ╦ ╔╦╗ ╔═╗ ╦ ╦ ╔═╗ ╔╗╔ ╦ ╦", color: WORD[0] },
  ],
  [
    { text: "    " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "◆", color: INNER_NODE },
    { text: "───", color: INNER_EDGE },
    { text: "◆", color: INNER_NODE },
    { text: "│", color: INNER_EDGE },
    { text: "  " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "╚═╗ ╚╦╝ ║║║ ╠═╝ ╠═╣ ║ ║ ║║║ ╚╦╝", color: WORD[1] },
  ],
  [
    { text: "    " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "│", color: INNER_EDGE },
    { text: " " },
    { text: "◉", color: SYNAPSE },
    { text: " " },
    { text: "│", color: INNER_EDGE },
    { text: "◆", color: INNER_NODE },
    { text: "  " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "╚═╝  ╩  ╩ ╩ ╩   ╩ ╩ ╚═╝ ╝╚╝  ╩", color: WORD[2] },
  ],
  [
    { text: "    " },
    { text: "│", color: EDGE },
    { text: "   " },
    { text: "◆", color: INNER_NODE },
    { text: "───", color: INNER_EDGE },
    { text: "◆", color: INNER_NODE },
    { text: "   " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "●", color: NODE },
  ],
  [
    { text: "    " },
    { text: "│", color: EDGE },
    { text: " " },
    { text: "╱", color: LINK },
    { text: "       " },
    { text: "╲", color: LINK },
    { text: " " },
    { text: "│", color: EDGE },
    { text: "╱", color: EDGE },
  ],
  [
    { text: "    " },
    { text: "●", color: NODE },
    { text: "───────────", color: EDGE },
    { text: "●", color: NODE },
  ],
];

export const LOGO_TAGLINE = "yerel + bulut LLM orkestrasyonu";

/** Test/önizleme için: bir logo satırının düz metni. */
export function logoLineText(line: readonly LogoSegment[]): string {
  return line.map((segment) => segment.text).join("");
}
