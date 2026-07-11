import { describe, expect, it } from "vitest";
import { extractCacheTokens, parseRateLimits } from "./telemetry.js";

describe("parseRateLimits", () => {
  it("anthropic header'larını okur; reset RFC3339 → epoch ms", () => {
    const now = Date.parse("2026-07-07T09:00:00Z");
    const snap = parseRateLimits(
      {
        "anthropic-ratelimit-requests-remaining": "48",
        "anthropic-ratelimit-requests-limit": "50",
        "anthropic-ratelimit-requests-reset": "2026-07-07T09:01:00Z",
        "anthropic-ratelimit-tokens-remaining": "18000",
        "anthropic-ratelimit-tokens-limit": "20000",
      },
      now,
    );
    expect(snap).not.toBeNull();
    expect(snap?.requestsRemaining).toBe(48);
    expect(snap?.requestsLimit).toBe(50);
    expect(snap?.requestsResetAt).toBe(Date.parse("2026-07-07T09:01:00Z"));
    expect(snap?.tokensRemaining).toBe(18000);
  });

  it("önek toleransı (x-ratelimit-*) + reset 'kalan saniye' + retry-after", () => {
    const now = 1_000_000;
    const snap = parseRateLimits(
      {
        "x-ratelimit-requests-remaining": "0",
        "x-ratelimit-requests-limit": "50",
        "x-ratelimit-requests-reset": "30",
        "retry-after": "12",
      },
      now,
    );
    expect(snap?.requestsRemaining).toBe(0);
    expect(snap?.requestsResetAt).toBe(now + 30_000);
    expect(snap?.retryAfterSec).toBe(12);
  });

  it("ilgili header yoksa null; undefined girdi null", () => {
    expect(parseRateLimits({ "content-type": "application/json" })).toBeNull();
    expect(parseRateLimits(undefined)).toBeNull();
  });
});

describe("extractCacheTokens", () => {
  it("GERÇEK Anthropic şeması (2026-07-11 canlı ölçüm): anthropic.usage.* snake_case", () => {
    // Bu şekil GERÇEK sağlayıcıdan izole script'le ALINDI (D2.5). Önceki uygulama
    // `anthropic.cacheReadInputTokens` (üst seviye, camelCase) okuyordu — TAHMİNDİ ve hep 0
    // dönüyordu; testi de aynı tahmini doğruladığı için bug 4 ay görünmez kaldı.
    const c = extractCacheTokens({
      anthropic: {
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 10842,
          cache_creation_input_tokens: 128,
        },
      },
    });
    expect(c).toEqual({ read: 10842, creation: 128 });
  });

  it("eski (camelCase/üst seviye) şekil geriye dönük olarak DA okunur — SDK şekli değişirse sayaç sıfırlanmasın", () => {
    const c = extractCacheTokens({
      anthropic: { cacheReadInputTokens: 6656, cacheCreationInputTokens: 128 },
    });
    expect(c).toEqual({ read: 6656, creation: 128 });
  });

  it("yoksa/eksikse 0 döner (sağlayıcı cache bildirmiyor)", () => {
    expect(extractCacheTokens(undefined)).toEqual({ read: 0, creation: 0 });
    expect(extractCacheTokens({ openai: {} })).toEqual({ read: 0, creation: 0 });
    expect(extractCacheTokens({ anthropic: { cacheReadInputTokens: "x" } })).toEqual({
      read: 0,
      creation: 0,
    });
  });
});
