import type { ModelMessage } from "ai";

/**
 * Prompt cache breakpoint'leri (D2.5, 2026-07-11) — SAF, testli.
 *
 * **Neden:** agent döngüsü her turda TÜM konuşmayı yeniden gönderir. Cache olmadan bu, uzun
 * koşularda karesel maliyet demek — canlı ölçüm: tek doktor koşusu 4.277.531 girdi token / $13.08.
 *
 * **Nasıl (GERÇEK sağlayıcıya sorularak doğrulandı, tahminle değil):** Anthropic'te `cache_control`
 * bir içerik bloğuna konur ve "buraya KADAR olan her şeyi (system + araçlar + önceki mesajlar)
 * cache'le" demektir. AI SDK bunu mesajın `providerOptions.anthropic.cacheControl` alanından okur.
 * Ölçüm (izole script): breakpoint YOKken `input_tokens=10871, cache_read=0` (tam fiyat);
 * breakpoint VARken `input_tokens=2, cache_read=10842` — girdinin %99.98'i cache'ten.
 *
 * **Strateji — İKİ breakpoint (SDK sınırı 4):**
 *  - SABİT: ilk mesaj → system prompt + araç tanımları + görev metni; koşu boyunca hiç değişmez,
 *    her turda cache'ten OKUNUR.
 *  - HAREKETLİ: son mesaj → o ana dek biriken konuşmanın tamamını cache'e YAZAR; bir sonraki tur
 *    onu okur (böylece büyüyen önek de cache'lenir, yalnız yeni turun içeriği tam fiyat olur).
 *
 * **Sağlayıcıdan bağımsız GÜVENLİ:** `providerOptions` ad-alanlıdır (`anthropic`), diğer
 * sağlayıcılar (OpenAI/Google/Ollama) bu alanı sessizce yok sayar — dallanma gerekmez.
 */

const CACHE_CONTROL = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/**
 * Mesaj dizisine cache breakpoint'lerini (yeniden) yerleştirir — YERİNDE değiştirir, çünkü
 * `engine` aynı diziyi tur boyunca büyütür. Önceki turun breakpoint'leri TEMİZLENİR: aksi hâlde
 * her tur bir breakpoint eklerdi ve SDK'nın 4 sınırı aşılınca fazlası sessizce yok sayılırdı.
 */
export function applyPromptCacheBreakpoints(messages: ModelMessage[]): void {
  for (const message of messages) {
    stripCacheControl(message);
  }
  if (messages.length === 0) return;

  const first = messages[0];
  const last = messages[messages.length - 1];
  if (first !== undefined) setCacheControl(first);
  // Tek mesajlık ilk turda ikisi aynı nesnedir — çifte breakpoint konmaz.
  if (last !== undefined && last !== first) setCacheControl(last);
}

function setCacheControl(message: ModelMessage): void {
  message.providerOptions = { ...message.providerOptions, ...CACHE_CONTROL };
}

function stripCacheControl(message: ModelMessage): void {
  const options = message.providerOptions;
  if (options?.["anthropic"] === undefined) return;
  const rest = Object.fromEntries(Object.entries(options).filter(([key]) => key !== "anthropic"));
  message.providerOptions = Object.keys(rest).length > 0 ? rest : undefined;
}
