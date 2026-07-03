# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosyayı okuyarak başla. Oturum sonunda güncelle.

**Son güncelleme:** 2026-07-03 (Oturum 1 devamı)

## Şu an neredeyiz?

**Faz 1 — DEVAM EDİYOR (ilk dikey dilim tamam, 2026-07-03).**

Daemon (`symphonyd`) canlı: Fastify+ws, port 7770, token auth, hello/snapshot akışı,
`chat.start` → `chat.delta` yayını → `chat.completed`+maliyet. Anthropic adapter'ı hazır
(AI SDK v7). Sır kasası: keychain (@napi-rs/keyring) + env yedek. 37 test yeşil.

**⚠️ Kritik teknik not:** Claude 4.7+ modelleri (Opus 4.8, Sonnet 5) `temperature`
parametresini KABUL ETMİYOR (400 döner) — Anthropic adapter'ı bu parametreyi bilinçli
olarak API'ye iletmiyor. ADR-008 ilkesi diğer sağlayıcılarda geçerli.

**Bekleyen ilk iş: kullanıcının Anthropic anahtarını kaydetmesi** → sonra curl ile canlı
streaming kabul testi. Komut:
```powershell
$env:SYMPHONY_KEY = "sk-ant-..."
pnpm --filter @symphony/core key:set anthropic
Remove-Item Env:SYMPHONY_KEY
```

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
1. ✅ Fastify+ws sunucu, ✅ Anthropic adapter, ✅ SecretStore (keychain)
2. Anahtar kaydı (kullanıcı) → curl ile canlı streaming kabul testi
3. SQLite veri katmanı (better-sqlite3): istek kayıtları + hata telemetrisi
4. Ollama adapter'ı (yerel model) → sonra OpenAI/Google
5. Router v1 (kural tabanlı öneri)

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
