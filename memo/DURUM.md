# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosyayı okuyarak başla. Oturum sonunda güncelle.

**Son güncelleme:** 2026-07-02 (Oturum 1)

## Şu an neredeyiz?

**Faz: 0 öncesi hazırlık — TAMAMLANDI ✅**

Proje fikri netleşti, tüm planlama belgeleri yazıldı. Henüz kod yok; ilk kod Faz 0'da yazılacak.

## Bitenler

- [x] Vizyon + mimari kararlar + 9 fazlık yol haritası → `ROADMAP.md`
- [x] Teknoloji seçimi: TypeScript her yerde, Vercel AI SDK, Ollama, Tauri 2, Ink, MCP
- [x] Gereksinim envanteri (araçlar, kütüphaneler, dosya planı) → `docs/GEREKSINIMLER.md`
- [x] Memo/süreklilik sistemi kuruldu → `memo/`
- [x] `.gitignore` + `README.md`
- [x] Donanım tespiti: i7-12650H, 32 GB RAM, RTX 4060 8 GB VRAM → 7-8B yerel modeller akıcı, büyük işler API'ye

## Sıradaki adım (buradan devam)

**→ Faz 0'ı başlat:**
1. Node.js 22 LTS + pnpm kurulumunu doğrula/kur
2. pnpm workspace monorepo iskeleti (`packages/shared|core|cli|ui|desktop`)
3. `shared` içinde zod ile WS protokol tiplerinin ilk taslağı
4. Vitest + temel CI

## Bekleyen kararlar / kullanıcıdan gerekenler

- [ ] **GitHub remote:** Özel `symphony` reposu oluşturulup bağlanacak (push yedeği için şart).
      Seçenekler: kullanıcı github.com'dan oluşturur VEYA `gh` CLI kurulup terminalden oluşturulur.
- [ ] API anahtarları Faz 1'de gerekecek (Anthropic ilk sırada; OpenAI/Google sonra eklenebilir).
- [ ] Ollama kurulumu Faz 1'de yapılacak.

## Notlar

- Kullanıcı dili: Türkçe. Belgeler Türkçe tutulacak.
- Oturum sonu rutini: DURUM.md güncelle → oturum günlüğü yaz → commit → push.
