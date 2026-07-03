# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosyayı okuyarak başla. Oturum sonunda güncelle.

**Son güncelleme:** 2026-07-03 (Oturum 4 — SQLite veri katmanı)

## Şu an neredeyiz?

**Faz 1 — DEVAM EDİYOR (SQLite veri katmanı + telemetri tamam, 2026-07-03).**

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

**→ Faz 1 kalanlar:**
1. ✅ Fastify+ws sunucu, ✅ Anthropic adapter, ✅ SecretStore, ✅ canlı streaming testi
2. ✅ SQLite veri katmanı: istek kayıtları + hata telemetrisi + usage.query (2026-07-03)
3. Ollama adapter'ı (yerel model — kullanıcıya Ollama kurulumu gerekecek) → sonra OpenAI/Google
4. Router v1 (kural tabanlı öneri)
5. Daemon tek-kopya kilidi (EADDRINUSE dersi)

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
