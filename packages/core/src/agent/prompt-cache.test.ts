import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { applyPromptCacheBreakpoints } from "./prompt-cache.js";

/** Bir mesajda anthropic cache breakpoint'i var mı? */
function cached(message: ModelMessage): boolean {
  return message.providerOptions?.["anthropic"] !== undefined;
}

describe("applyPromptCacheBreakpoints (D2.5) — SAF", () => {
  it("boş dizide çökmez", () => {
    expect(() => applyPromptCacheBreakpoints([])).not.toThrow();
  });

  it("tek mesajda TEK breakpoint (ilk = son, çifte konmaz)", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "görev" }];
    applyPromptCacheBreakpoints(messages);
    expect(cached(messages[0]!)).toBe(true);
    expect(messages[0]!.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("İLK (sabit: system+araçlar+görev) ve SON (hareketli: biriken konuşma) mesaja breakpoint", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "görev" },
      { role: "assistant", content: "düşünüyorum" },
      { role: "user", content: "devam" },
    ];
    applyPromptCacheBreakpoints(messages);
    expect(cached(messages[0]!)).toBe(true);
    expect(cached(messages[1]!)).toBe(false); // ortadakiler işaretlenmez
    expect(cached(messages[2]!)).toBe(true);
  });

  it("tur ilerleyince ESKİ breakpoint temizlenir — SDK'nın 4 breakpoint sınırı aşılmaz", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "görev" },
      { role: "assistant", content: "tur1" },
    ];
    applyPromptCacheBreakpoints(messages); // breakpoint: [0], [1]

    // Motor konuşmayı büyütür (yeni tur).
    messages.push({ role: "user", content: "tur2" });
    applyPromptCacheBreakpoints(messages);

    const isaretli = messages.filter(cached);
    expect(isaretli).toHaveLength(2); // BİRİKMEDİ
    expect(cached(messages[0]!)).toBe(true); // sabit
    expect(cached(messages[1]!)).toBe(false); // eski hareketli TEMİZLENDİ
    expect(cached(messages[2]!)).toBe(true); // yeni hareketli
  });

  it("başka sağlayıcıların providerOptions'ı KORUNUR (yalnız anthropic ad-alanına dokunulur)", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a", providerOptions: { openai: { foo: "bar" } } },
      { role: "user", content: "b", providerOptions: { openai: { foo: "baz" } } },
    ];
    applyPromptCacheBreakpoints(messages);
    expect(messages[0]!.providerOptions).toEqual({
      openai: { foo: "bar" },
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    // Ortadaki-olmayan (son) da işaretli ama openai alanı yerinde.
    expect(messages[1]!.providerOptions?.["openai"]).toEqual({ foo: "baz" });
  });

  it("temizlik: yalnız anthropic alanı olan mesajda providerOptions tamamen kalkar", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    applyPromptCacheBreakpoints(messages); // [0] ve [2] işaretli
    messages.push({ role: "assistant", content: "d" });
    applyPromptCacheBreakpoints(messages); // [2] artık ortada → temizlenmeli

    expect(messages[2]!.providerOptions).toBeUndefined();
  });
});
