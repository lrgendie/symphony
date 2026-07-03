# 🤝 DEVIR.md — Devralan Modele Talimat (Fable → Opus)

> Bu belge, tasarımı yapan Fable 5'in yerine geçen modele (Opus veya başka)
> yazılmıştır. Fable'ın haftalık limiti dolduğunda buradan devam edilir.
> **CLAUDE.md anayasadır, bu belge onun Faz 3+ eki ve tuzak haritasıdır.**

## Rolün

Mimari kararlar VERİLMİŞ durumda (docs/kararlar/KARARLAR.md — 11 ADR) ve
şartnameler yazılı (docs/PROTOKOL.md, docs/SPEC-AGENT.md). Senin işin bunları
**değiştirmek değil uygulamak**. "Şunu şöyle yapsak daha iyi olur" hissi gelirse:
önce ilgili ADR'yi oku; gerekçe hâlâ geçerliyse uygula, değilse ADR'ye yeni kayıt
YAZMADAN değiştirme. Kullanıcı net karar ister, seçenek listesi değil.

## Her oturumda (sırayla, başka bir şey okumadan)

1. `memo/DURUM.md` → neredeyiz, sıradaki adım ne.
2. `memo/BAGLAM.md` → hangi dosya ne işe yarıyor + "görev → ne okumalı" tablosu.
3. Yalnız dokunacağın dosyaları aç. **Geniş keşif taraması token israfıdır** —
   harita zaten var. İlk 10 dakikada `ls -R`/`grep -r` gezintisi yapma.
4. Oturum sonunda: DURUM.md + (yapı değiştiyse) BAGLAM.md güncelle,
   `memo/oturumlar/YYYY-AA-GG.md` günlüğü yaz, anlamlı mesajla commit et.

## İş disiplini (pazarlıksız)

- **Dikey dilim:** her oturum çalışan, testli bir şey bırakır. Yarım altyapı bırakma.
- **Test geçmeden iş bitmedi:** `pnpm build && pnpm test && pnpm lint` üçlüsü temiz
  olmadan DURUM.md'ye "tamam" yazma. Bugün itibarıyla taban: **115/115 test yeşil.**
- **Protokol kutsal:** yeni WS mesajı = önce PROTOKOL.md, sonra shared'a zod şeması,
  sonra kullanım. Şemasız mesaj derlenmez bile (envelope createMessage şart koşar).
- **İzin akışı kutsal:** araç çalıştırmanın TEK kapısı `agent/engine.ts`'teki izin
  denetimi. "Hızlı olsun" diye bypass ekleme — kabul testleri bunu yakalar.

## Faz 3'te bitenler / kalanlar

Bitti (2026-07-04, testli): araç seti (6 araç), workspace jail, izin motoru
(deny>allow>varsayılan + always_allow), diff önizleme + bayat-diff denetimi,
agent döngüsü (AI SDK v7 tool-calling), SQLite v3 (agent_runs/agent_steps),
daemon entegrasyonu (agent.start/cancel, permission.respond, snapshot),
`symphony agents` + `symphony agent <ad> "<görev>"` CLI.

Kalan (öncelik sırasıyla):
1. **Canlı doğrulama:** `symphony agent coder "memo klasöründeki DURUM.md'nin ilk
   10 satırını oku ve özetle" --provider ollama --model qwen3:8b` — qwen3:8b tools
   yetenekli; gerçek modelle izin akışını terminalde bir kez yaşat.
2. **MCP istemcisi** (ADR-007): `@modelcontextprotocol/sdk` ile harici MCP sunucusuna
   bağlan; sunucunun araçlarını `AgentToolSpec`'e sar (riskClass `mutating` başlar,
   SPEC §2). Yeni tanım alanı: agent frontmatter'ına `mcpServers: [...]` eklersen
   önce SPEC-AGENT.md'yi güncelle.
3. **Eklenti sistemi:** `symphony add <kaynak>` (ROADMAP Faz 3 maddesi); ilk örnek
   Playwright web scraping MCP'si.
4. **TUI entegrasyonu:** sohbet ekranına agent modu (izin isteği kutusu + diff
   görünümü). `cli/src/tui/chat.tsx`'e bak; olaylar zaten DaemonClient.on ile geliyor.

## Teknik tuzaklar (bu oturumda kanla öğrenildi — tekrarlama)

- **AI SDK v7:** `messages` içine `role: "system"` KOYMA → "Invalid prompt" fırlatır;
  sistem metni `generateText({ instructions })` ile verilir. Araç tanımı `tool({
  description, inputSchema })` (execute VERME — izin kapısı bizde). Geçersiz araç
  çağrısı FIRLATMAZ: `toolCalls[i].invalid === true` gelir ve SDK error tool-result'ını
  `response.messages`'a kendisi ekler — bunlara ikinci sonuç yazma. Kullanım sayıları
  `result.usage.inputTokens/outputTokens` (undefined olabilir, ?? 0 kullan).
- **TS2883 (portable type):** adapter'larda dönüş tipini açık yaz
  (`Promise<LanguageModel>`), yoksa pnpm yolu tip adına sızar ve build kırılır.
- **Windows:** better-sqlite3 dosyası açıkken silinemez → testte `store.close()`
  şart; symlink testi `junction` ile (ayrıcalık istemez); komutlar
  `powershell.exe -NoProfile -NonInteractive -Command` ile koşar; `path.win32.relative`
  büyük/küçük harf duyarsızdır (jail buna güvenir).
- **JS regex `\b` Türkçe'de çalışmaz** (router'da yaşandı) — kelime sınırı için
  `(^|[\s;&|])` gibi açık sınıflar kullan.
- **pnpm 11:** global kurulum `link:` protokolüyle; `pnpm link --global` YOK.
  Yeni paket eklerken `docs/GEREKSINIMLER.md` envanterine işle.
- **Mock model:** testte `MockLanguageModelV3` (`ai/test`); doGenerate dönüşü
  `{ finishReason: { unified: "tool-calls" }, usage: { inputTokens: { total: n }, ... },
  content: [...], warnings: [] }` biçiminde — örnek: `agent/engine.test.ts`.
- **Hata kodu sözleşmesi:** `Error.name` = `AGENT_*/PERMISSION_*/...` kodu;
  daemon `toErrorPayload` kodu name'den okur. `AgentError` kullan.
- **temperature:** adapter'daki `forwardsTemperature` bayrağına uy — Claude 4.7+ ve
  GPT-5 aileleri sampling parametresi kabul ETMEZ (400 döner), Gemini/Ollama eder.

## Token ekonomisi (kullanıcının açık talebi)

Kullanıcının saatleri sınırlı ve pahalı. Kural: az sayıda uzun oturum; oturum başına
sabit okuma maliyeti yalnız DURUM+BAGLAM; büyük dosyaları parça parça (offset/limit)
oku; aynı dosyayı iki kez okuma (Edit zaten hata verir bozuksa); doğrulamayı tek
`build+test+lint` koşusunda topla, her küçük değişiklikte koşma.
