# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosyayı okuyarak başla. Oturum sonunda güncelle.

**Son güncelleme:** 2026-07-03 (Oturum 9 — Faz 2 KAPANDI)

## Şu an neredeyiz?

**Faz 2 — TAMAM (2026-07-03). Sıradaki: Faz 3 agent motoru (SPEC-AGENT.md).**

Faz 2 kapanışı (Oturum 9): global kurulum (`pnpm setup` + `pnpm add -g link:packages/cli`;
`symphony` PATH'te — yeni terminal gerek), `symphony watch` (canlı olay akışı) +
ikinci-istemci eş zamanlılık testi (kabul kriteri kanıtlı), sohbet geçmişi
(SQLite göç v2: `sessions`+`messages`, replace semantiği; REST `/api/history/*`;
`symphony history [id-ön-eki]`; TUI artık sabit sessionId gönderiyor → çok turlu
sohbet tek oturum). Canlı doğrulandı: qwen3:8b ile tur → `symphony history`
liste + döküm çalıştı. **76/76 test yeşil; build+lint+format temiz.**

**Faz 1 durumu:** kod tamam; OpenAI/Google canlı doğrulama anahtar bekliyor.

Daemon (`symphonyd`) canlı: Fastify+ws, port 7770, token auth, hello/snapshot akışı,
`chat.start` → `chat.delta` yayını → `chat.completed`+maliyet. Anthropic adapter'ı hazır
(AI SDK v7). Sır kasası: keychain (@napi-rs/keyring) + env yedek. **44 test yeşil.**

**✅ YENİ (2026-07-03, Oturum 4):** SQLite veri katmanı (`packages/core/src/db/store.ts`,
better-sqlite3, WAL, `user_version` göçleri). Her istek — başarı/hata/iptal —
`requests` tablosuna düşüyor; gerçek hatalar `telemetry` tablosuna (scope, kod, mesaj,
stack, girdi ÖZETİ — ham içerik asla). `usage.updated.totals` artık SQLite'tan kalıcı;
`usage.query` WS mesajı çalışıyor (provider/model/gün gruplaması + zaman aralığı).
DataStore `@symphony/core`'dan export ediliyor (Doktor agent Faz 8'de bunu okuyacak).

**⚠️ Kritik teknik not:** Claude 4.7+ modelleri (Opus 4.8, Sonnet 5) `temperature`
parametresini KABUL ETMİYOR (400 döner) — Anthropic adapter'ı bu parametreyi bilinçli
olarak API'ye iletmiyor. ADR-008 ilkesi diğer sağlayıcılarda geçerli.

**✅ CANLI STREAMING KABUL TESTİ GEÇTİ (2026-07-03):** Anahtar keychain'de
(`anahtar-kaydet.bat` ile kaydedildi), curl → daemon → Claude Opus 4.8 gerçek streaming
cevap + maliyet (62in/99out token, $0.0028). Faz 1'in Anthropic ayağı uçtan uca çalışıyor.

**Öğrenilen ders (Faz 2'de çözülecek):** Daemon zaten çalışırken ikinci kopya
EADDRINUSE ile çöküyor ama önce token dosyasının üstüne yazıyor → eski daemon'a
erişim kilitleniyor. Çözüm: başlarken port kontrolü / tek-kopya kilidi
(CLI'ın otomatik başlatma mantığıyla birlikte ele alınacak).

## Bitenler

- [x] Vizyon + mimari kararlar + 9 fazlık yol haritası → `ROADMAP.md`
- [x] Teknoloji seçimi: TypeScript her yerde, Vercel AI SDK, Ollama, Tauri 2, Ink, MCP
- [x] Gereksinim envanteri (araçlar, kütüphaneler, dosya planı) → `docs/GEREKSINIMLER.md`
- [x] Memo/süreklilik sistemi kuruldu → `memo/`
- [x] `.gitignore` + `README.md`
- [x] Donanım tespiti: i7-12650H, 32 GB RAM, RTX 4060 8 GB VRAM → 7-8B yerel modeller akıcı, büyük işler API'ye
- [x] GitHub remote bağlandı: `lrgendie/symphony` — dal `main` olarak yeniden adlandırıldı, push edildi
- [x] Oturum sonu otomatik commit+push hook'u kuruldu ve test edildi (`.claude/settings.json`)
- [x] Karar: temperature varsayılanı 0 (agent tanımıyla bilinçli istisna mümkün)
- [x] VS C++ dosyaları silindi (kullanıcı onayıyla) — repo temiz
- [x] **"Fable mirası" belgeleri yazıldı:** `CLAUDE.md` (anayasa), `docs/PROTOKOL.md` (WS spesifikasyonu),
      `docs/SPEC-AGENT.md` (agent+izin şartnamesi), `docs/kararlar/KARARLAR.md` (11 ADR),
      ROADMAP'e faz başına kabul testleri

## Sıradaki adım (buradan devam)

**→ Faz 3: agent motoru** (`docs/SPEC-AGENT.md` MUTLAKA okunarak):
araç seti (read_file/write_file/edit/glob/grep/run_command), agent döngüsü
(AI SDK tool-calling), izin sistemi + diff önizleme, MCP istemcisi.
Kullanıcının asıl beklediği yetenek bu (TUI'de "klasörü taşı" isteği Faz 3 notu).
Not: qwen3:8b `tools` yetenekli → yerel agent modeli adayı.

**Faz 1'den arta kalan (bloklamıyor):**
1. ✅ Fastify+ws sunucu, ✅ Anthropic adapter, ✅ SecretStore, ✅ canlı streaming testi
2. ✅ SQLite veri katmanı: istek kayıtları + hata telemetrisi + usage.query (2026-07-03)
3. ✅ Ollama adapter'ı + CANLI KABUL TESTİ GEÇTİ (2026-07-03): Ollama kuruldu,
   `qwen3:8b` (8.2B Q4_K_M, 40k bağlam) indirildi; curl → daemon → yerel model
   Türkçe streaming cevap (19 giriş / 330 çıkış token, $0) + SQLite kaydı doğrulandı.
   **"Hem yerel hem bulut" hedefi kanıtlandı** (ROADMAP İlk Somut Adımlar §5.4).
4. ✅ Daemon tek-kopya kilidi (2026-07-03): açılışta sağlık sondası → çalışan
   symphonyd varsa `DAEMON_ALREADY_RUNNING` ile durur; token dosyası ancak
   dinleme BAŞARILI olunca yazılır — EADDRINUSE'ta eski token artık ezilmiyor.
5. ✅ Router v1 (2026-07-03): kural tabanlı, gerekçeli öneri (`router.suggest` canlı).
   Görev türü çıkarımı kelime-kümesiyle (JS regex \b Türkçe'de çalışmıyor — ders!),
   VRAM tespiti nvidia-smi'den, yalnız kullanılabilir sağlayıcılardan öneri,
   preferLocal/maxCostUsd kısıtları uygulanıyor. v2 (Faz 6) aynı arayüzle
   SQLite skorlarına geçecek.
6. ✅ OpenAI/Google adapter'ları KODU (2026-07-03): gpt-5.1/mini/nano +
   gemini-2.5-pro/flash, fiyatlar pricing.ts'te, daemon'da 4 sağlayıcı kayıtlı.
   GPT-5 ailesi temperature KABUL ETMİYOR (Claude 4.7+ gibi) → iletilmiyor;
   Gemini'ye iletiliyor. **Canlı test anahtar bekliyor** — kullanıcı anahtar
   eklerse: `pnpm --filter @symphony/core key:set openai` (veya google).

**Faz 1 kod olarak TAMAM.** Kalan: OpenAI/Google canlı doğrulama (anahtar gelince).
Anahtar-diskte-yok kabul koşusu ✅ geçti (grep temiz, yalnız keychain).

## Faz 2 — CLI (TAMAM 2026-07-03; ROADMAP kabul testi geçti)

- ✅ **Daemon istemcisi** (`packages/cli/src/client/daemon-client.ts`): WS+hello,
  replyTo korelasyonu, sticky kayıt (chat'in geç hatası aynı TCP paketinde bile
  yakalanır), üstel geri çekilmeli yeniden bağlanma, olay aboneliği.
- ✅ **Otomatik başlatma**: `ensureDaemonRunning` → sağlık sondası → yoksa
  `@symphony/core/daemon` (yeni export alt yolu) detached spawn + sağlık bekleme.
  **Kabul koşusu geçti:** temiz terminalde `symphony status` daemon'ı kendisi başlattı.
- ✅ **Komutlar**: `symphony status` (sağlayıcı sağlığı + SQLite kullanım özeti),
  `symphony models` (4 sağlayıcı, 9 model listelendi). `symphony agents` Faz 3'e.
- ✅ **Ink TUI** (ink 7 + React 19): model seçici (↑/↓+Enter) → sohbet ekranı
  (canlı delta akışı, maliyet satırı, Esc iptal). Canlı deneme geçti (Oturum 8).
- ✅ **Global kurulum** (Oturum 9): `pnpm setup` (PNPM_HOME + PATH kayıt defterine)
  ardından `pnpm add -g link:packages/cli`. Not: pnpm 11'de `pnpm link --global`
  YOK; npm i -g de workspace:* bağımlılıkları çözemez → link: protokolü şart.
  Symlink olduğu için `pnpm build` sonrası global komut hep güncel.
- ✅ **`symphony watch`** + eş zamanlılık kabul testi (Oturum 9): iki DaemonClient,
  A'nın sohbetini B aynı delta/completed olaylarıyla görüyor (concurrency.test.ts).
- ✅ **Sohbet geçmişi** (Oturum 9): SQLite göç v2 (`sessions` + `messages`,
  FK+CASCADE, foreign_keys pragma). Daemon her BAŞARILI turda oturumu upsert edip
  mesajları TAM geçmiş+cevapla DEĞİŞTİRİYOR (replace, idempotent; eski `at` korunur).
  REST: `GET /api/history/sessions[?limit]`, `GET /api/history/sessions/:id` (404/401).
  Cevap şemaları shared'da (`protocol/rest.ts`). CLI: `symphony history [id-ön-eki]`.
  TUI sabit sessionId üretiyor (useRef) → çok turlu sohbet tek oturumda birikiyor.
  PROTOKOL.md §1.1 (REST katalog) + §3 (oturum/replace kuralı) eklendi.
- 76/76 test yeşil; build+lint+format temiz. Faz 2'nin ROADMAP kabul testi kapandı.

**Teknik not (Ollama):** topluluk paketleri `ollama-ai-provider`/`-v2` AI SDK v7 + zod v3
ile uyumsuz → resmî `@ai-sdk/openai-compatible` seçildi (GEREKSINIMLER.md güncellendi).
`ProviderAdapter.listModels` artık async (dinamik listeler için); Ollama'da temperature
API'ye İLETİLİR (ADR-008), Anthropic'te iletilmez (Claude 4.7+ reddi).

**Not:** "Sohbet geçmişi" tablosu (mesaj içerikleri) bilinçli olarak Faz 2'ye bırakıldı —
CLI oturum yönetimiyle birlikte tasarlanacak; şimdilik yalnız istek META verisi saklanıyor.

**Faz 0'dan notlar (Faz 1'de lazım olacak):**
- Node paketi eklerken `tsconfig.json`'a `"types": ["node"]` yazmayı unutma (TS 6 otomatik almıyor)
- `shared` ortam-bağımsız kalmalı: Node API'si import etme (tarayıcı da kullanacak)
- Kurulu sürümler: Node 24.14.1, pnpm 11.9.0, TS 6.0.3, ESLint 10, Vitest 4, zod 3

## Bekleyen kararlar / kullanıcıdan gerekenler

- [ ] API anahtarları Faz 1'de gerekecek (Anthropic ilk sırada; OpenAI/Google sonra eklenebilir).
- [ ] Ollama kurulumu Faz 1'de yapılacak.

## Notlar

- Kullanıcı dili: Türkçe. Belgeler Türkçe tutulacak.
- Oturum sonu rutini: DURUM.md güncelle → oturum günlüğü yaz → commit → push.
