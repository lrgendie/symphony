/**
 * Yaşayan Küre'nin "dalga alanı" — parçacık küresinin YÜZEY deformasyonu (ses-dalgası estetiği).
 * Saf fonksiyon (React/Three.js yok) → birim test edilebilir. LivingScene her karede çağırıp
 * position + color BufferAttribute'larını doldurur.
 *
 * TASARIM.md §2 / kullanıcı isteği (2026-07-07): yük ifadesi ARTIK ölçek-nabzı değil, yüzeyde
 * ilerleyen vektörel dalga. Dalga sabit bir yöne (ekran SAĞ-ÜST, GPU göstergesinin yazılı olduğu
 * taraf) doğru ilerler; o bölgede genlik KESKİNLEŞİR ve renk ISINIR. Küre dönerken bölge ekranda
 * sabit kalsın diye dönüş bu fonksiyonda pozisyona pişirilir (world-uzayı yön) — her hareketin
 * gerçek bir anlamı var (yük + LLM aktivitesi = ortak "canlılık" sürücüsü `drive`).
 */

/** Ekran-uzayı sabit odak yönü: sağ (+x), üst (+y), hafif kameraya (+z). Küre dönse de sabit. */
export const FOCUS_DIR = normalize3(1, 1, 0.4);

/** Dalga bu eksende ilerler (odakla aynı → dalga sağ-üste doğru rulo yapar, orada keskinleşir). */
export const WAVE_DIR = FOCUS_DIR;

// —— Ayar sabitleri (görsel; kullanıcı canlı ince ayar yapar) ——
/** Sürücü 0'da bile çok hafif "yaşıyor" kıpırtısı (küre asla tamamen ölü değil). */
export const AMBIENT_DISP = 0.035;
/** drive=1'de odak tepesindeki azami radyal atılım (dünya birimi; RADIUS≈1.5). */
export const MAX_DISP = 0.3;
/** Odak-DIŞI bölgenin sürücü genliğinden aldığı taban pay (odakta 1'e çıkar). */
const OFF_FOCUS_FRACTION = 0.28;
/** Dalganın uzamsal frekansı (yüzeyde kaç bant). */
const WAVE_K = 6.5;
/** Dalganın ilerleme hızı (rad/sn). */
const WAVE_SPEED = 2.2;
/** Odak keskinliği üsteli: büyük = dar, sivri bölge ("dalga yönüne doğru keskinleş"). */
const FOCUS_EXP = 2.4;
/** İkinci harmonik payı (dalgaya doku/keskinlik katar). */
const HARMONIC = 0.35;
/** drive ile büyüyen, odak yönüne doğru sabit dışa "atılım" (vektörel şişme). */
const FOCUS_BULGE = 0.14;
/** Renk ısınmasında odak bölgesinin ağırlığı ("renk sıcaklığı dalga yönüne gelir"). */
const WARM_FOCUS = 0.6;
/** Dalga tepesinin renge kattığı ek ısı payı. */
const WARM_CREST = 0.25;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function normalize3(x: number, y: number, z: number): readonly [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/**
 * Birim yönü önce Y sonra X ekseni etrafında döndürür (ortonormal → birim uzunluk korunur).
 * Dönüşü burada uygulamak, odak/dalga yönünü world-uzayında sabit tutar (küre dönerken bölge
 * ekranda sabit kalır). Saf: sadece sayı → sayı.
 */
export function rotateDir(
  x: number,
  y: number,
  z: number,
  angleX: number,
  angleY: number,
): [number, number, number] {
  const cy = Math.cos(angleY);
  const sy = Math.sin(angleY);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(angleX);
  const sx = Math.sin(angleX);
  const y2 = y * cx - z1 * sx;
  const z2 = y * sx + z1 * cx;
  return [x1, y2, z2];
}

/** Odak ağırlığı: yönün odakla hizasının pozitif lobu, üsle keskinleştirilmiş → 0..1. */
export function focusWeight(dot: number, exp = FOCUS_EXP): number {
  return dot <= 0 ? 0 : Math.pow(dot, exp);
}

export interface WaveFieldParams {
  /** Küre taban yarıçapı (dünya birimi). */
  radius: number;
  /** Zaman (sn) — dalganın ilerlemesini sürer. */
  time: number;
  /** Biriken dönüş açıları (dünya-uzayı odağı sabit tutmak için pozisyona pişirilir). */
  angleX: number;
  angleY: number;
  /** 0..1 canlılık sürücüsü (yumuşatılmış GPU yükü + LLM aktivitesi maksimumu). */
  drive: number;
  /** 0..1 renk ısısı (yumuşatılmış) — odak bölgesini sıcağa kaydırır. */
  heat: number;
}

/**
 * Birim taban yönlerinden (baseDirs, len N*3) her parçacığın deforme world pozisyonunu (outPos)
 * ve ısıyla-karışmış rengini (outCol) yazar. baseColor→warmColor arası per-parçacık lerp: ısı ve
 * odak/dalga bölgesi rengi sıcaklaştırır. GC yok — çağıran arabellekleri yeniden kullanır.
 */
export function computeWaveField(
  baseDirs: Float32Array,
  outPos: Float32Array,
  outCol: Float32Array,
  params: WaveFieldParams,
  baseColor: readonly [number, number, number],
  warmColor: readonly [number, number, number],
): void {
  const { radius, time, angleX, angleY, drive, heat } = params;
  const count = (baseDirs.length / 3) | 0;
  const [fx, fy, fz] = FOCUS_DIR;
  const [wxDir, wyDir, wzDir] = WAVE_DIR;
  const [br, bg, bb] = baseColor;
  const [wr, wg, wb] = warmColor;
  const phaseT = time * WAVE_SPEED;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const [wx, wy, wz] = rotateDir(baseDirs[o] ?? 0, baseDirs[o + 1] ?? 0, baseDirs[o + 2] ?? 0, angleX, angleY);

    const dFocus = wx * fx + wy * fy + wz * fz;
    const fw = focusWeight(dFocus);

    // Yüzeyde ilerleyen dalga (odak ekseni boyunca) + harmonik.
    const phase = (wx * wxDir + wy * wyDir + wz * wzDir) * WAVE_K - phaseT;
    const wave = Math.sin(phase) + HARMONIC * Math.sin(2 * phase);

    // Genlik: ambient (her yerde) + sürücü (odakta tam, dışında OFF_FOCUS_FRACTION).
    const amp = AMBIENT_DISP + drive * MAX_DISP * (OFF_FOCUS_FRACTION + (1 - OFF_FOCUS_FRACTION) * fw);
    // Odak yönüne doğru sabit dışa atılım (vektörel şişme), sürücüyle büyür.
    const bulge = drive * FOCUS_BULGE * fw;
    const r = radius + amp * wave + bulge;

    outPos[o] = wx * r;
    outPos[o + 1] = wy * r;
    outPos[o + 2] = wz * r;

    // Renk: ısı × odak bölgesi (+ dalga tepesi) → base'ten warm'a lerp.
    const crest = wave > 0 ? wave : 0;
    const warm = clamp01(heat * (0.35 + WARM_FOCUS * fw) + crest * WARM_CREST * drive);
    outCol[o] = br + (wr - br) * warm;
    outCol[o + 1] = bg + (wg - bg) * warm;
    outCol[o + 2] = bb + (wb - bb) * warm;
  }
}
