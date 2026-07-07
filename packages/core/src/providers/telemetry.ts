/**
 * Sağlayıcı cevabından rate-limit ve prompt-cache telemetrisini çıkarır.
 * SAF: AI SDK'ya bağımlı değil (düz Record/nesne alır) → nvidia gibi mock'suz test edilir.
 * Header adları sağlayıcıya göre değişebildiği için (`anthropic-ratelimit-*` / `x-ratelimit-*`)
 * SON-EK eşlemesi yaparız; böylece isim öneki değişse bile kırılmaz, yalnız boş kalır.
 */

export interface RateLimitSnapshot {
  requestsRemaining?: number;
  requestsLimit?: number;
  requestsResetAt?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  tokensResetAt?: number;
  retryAfterSec?: number;
}

function toInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}

/**
 * `*-reset` header'ı ya RFC3339 zaman damgası ("2026-07-07T09:00:00Z") ya da
 * "kalan saniye" olabilir → her iki durumu da epoch ms'e çevirir.
 */
function toResetEpochMs(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  const parsed = Date.parse(v);
  if (!Number.isNaN(parsed)) return parsed;
  const seconds = Number(v);
  return Number.isNaN(seconds) || seconds < 0 ? undefined : now + seconds * 1000;
}

/**
 * Rate-limit header'larını okur. Hiçbiri yoksa null (sağlayıcı bilgi vermiyor → gösterge kapalı).
 * `headers` AI SDK'nın `response.headers`'ı (küçük harf anahtarlı Record) ya da undefined.
 */
export function parseRateLimits(
  headers: Record<string, string> | undefined,
  now: number = Date.now(),
): RateLimitSnapshot | null {
  if (headers === undefined) return null;
  const snap: RateLimitSnapshot = {};
  // exactOptionalPropertyTypes: yalnız TANIMLI değeri ata (undefined atama tip hatası).
  const put = (key: keyof RateLimitSnapshot, value: number | undefined): void => {
    if (value !== undefined) snap[key] = value;
  };
  for (const [rawKey, value] of Object.entries(headers)) {
    const key = rawKey.toLowerCase();
    if (key === "retry-after") put("retryAfterSec", toInt(value));
    else if (key.endsWith("ratelimit-requests-remaining")) put("requestsRemaining", toInt(value));
    else if (key.endsWith("ratelimit-requests-limit")) put("requestsLimit", toInt(value));
    else if (key.endsWith("ratelimit-requests-reset")) put("requestsResetAt", toResetEpochMs(value, now));
    else if (key.endsWith("ratelimit-tokens-remaining")) put("tokensRemaining", toInt(value));
    else if (key.endsWith("ratelimit-tokens-limit")) put("tokensLimit", toInt(value));
    else if (key.endsWith("ratelimit-tokens-reset")) put("tokensResetAt", toResetEpochMs(value, now));
  }
  return Object.keys(snap).length === 0 ? null : snap;
}

/**
 * Anthropic prompt-cache token'ları (bu cevaba ait). AI SDK `providerMetadata` yapısı:
 * `{ anthropic: { cacheReadInputTokens, cacheCreationInputTokens } }`. Yoksa 0.
 */
export function extractCacheTokens(providerMetadata: unknown): { read: number; creation: number } {
  const anthropic = (providerMetadata as { anthropic?: Record<string, unknown> } | undefined)
    ?.anthropic;
  const num = (v: unknown): number => (typeof v === "number" && v >= 0 ? v : 0);
  return {
    read: num(anthropic?.["cacheReadInputTokens"]),
    creation: num(anthropic?.["cacheCreationInputTokens"]),
  };
}
