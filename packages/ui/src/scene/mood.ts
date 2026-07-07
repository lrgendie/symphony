/**
 * Yaşayan küre "ruh hâli" (mood) — sistem durumundan türetilen TEK anlam kaynağı.
 * Saf fonksiyon (React/Three.js yok) → birim test edilebilir. LivingSphere.tsx bunu her
 * karede çağırıp görsele çevirir. TASARIM.md §2: her hareketin anlamı var (durum/yük/hata).
 */

export type SphereMood = "offline" | "error" | "awaiting" | "executing" | "thinking" | "idle";

export interface MoodInput {
  connected: boolean;
  runStates: readonly string[];
  pendingCount: number;
  lastErrorAt: number | null;
  now: number;
}

/** Hata flaşı bu kadar ms görünür kalır, sonra alttaki gerçek duruma döner. */
export const ERROR_FLASH_MS = 2500;

/**
 * Öncelik (en baskın önce): bağlantı yok > yeni hata > izin bekliyor > araç çalışıyor >
 * düşünüyor > boşta. Böylece kürenin gösterdiği şey her zaman "en çok dikkat isteyen" durum.
 */
export function deriveMood(input: MoodInput): SphereMood {
  if (!input.connected) return "offline";
  if (input.lastErrorAt !== null && input.now - input.lastErrorAt < ERROR_FLASH_MS) return "error";
  if (input.pendingCount > 0) return "awaiting";
  if (input.runStates.includes("executing_tool")) return "executing";
  if (input.runStates.some((s) => s === "thinking" || s === "queued")) return "thinking";
  return "idle";
}

export interface MoodStyle {
  /** Ana renk (marka paleti, TASARIM.md §1). */
  color: string;
  /** Dönüş hızı (rad/sn). */
  spin: number;
  /** Nefes frekansı (rad/sn). */
  breathe: number;
  /** Nefes genliği (ölçek ± bu kadar). */
  amp: number;
  /** Parçacık parlaklığı (opaklık). */
  opacity: number;
  /**
   * LLM aktivite sürücüsü 0..1: dalga alanının (wave-field) genliğini besler. GPU yükünden
   * BAĞIMSIZ canlılık kaynağıdır — bulut LLM (Claude/Gemini) çalışırken yerel GPU yükselmez ama
   * "sesli sohbet dalgası" benzeri atılım sürmelidir. LivingScene `max(gpuLoad, activity)` alır.
   */
  activity: number;
  /** HUD etiketi. */
  label: string;
}

export const MOOD_STYLE: Record<SphereMood, MoodStyle> = {
  idle: { color: "#22d3ee", spin: 0.05, breathe: 0.9, amp: 0.03, opacity: 0.55, activity: 0.0, label: "IDLE" },
  thinking: { color: "#38bdf8", spin: 0.18, breathe: 1.8, amp: 0.06, opacity: 0.85, activity: 0.45, label: "THINKING" },
  executing: { color: "#e879f9", spin: 0.5, breathe: 3.2, amp: 0.09, opacity: 1.0, activity: 0.75, label: "EXECUTING" },
  awaiting: { color: "#fbbf24", spin: 0.12, breathe: 2.6, amp: 0.05, opacity: 0.9, activity: 0.2, label: "AWAITING" },
  error: { color: "#ef4444", spin: 0.7, breathe: 6.0, amp: 0.14, opacity: 1.0, activity: 0.9, label: "ERROR" },
  offline: { color: "#3b4252", spin: 0.02, breathe: 0.5, amp: 0.015, opacity: 0.35, activity: 0.0, label: "OFFLINE" },
};
