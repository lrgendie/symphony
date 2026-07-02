# CLAUDE.md — Symphony Proje Anayasası

> Bu repoda çalışan her AI modeli (Fable, Opus, Sonnet, yerel model) için bağlayıcı talimatlar.
> Bu belge, projenin tasarımı Fable 5 ile yapılırken yazıldı; buradaki kurallar
> daha zayıf bir modelin bile mimariyi bozmadan katkı verebilmesi içindir.

## Proje nedir?

Symphony: yerel (Ollama) + bulut (Claude/GPT/Gemini) LLM'leri ve kod agent'larını tek
daemon'dan yöneten, Win/mac/ARM çapraz platform orkestrasyon sistemi. Terminal (`symphony`)
ve masaüstü (Tauri) aynı daemon'a bağlı iki eş zamanlı arayüzdür.

## Her oturumda ilk iş

1. `memo/DURUM.md` oku → kaldığımız yer ve sıradaki adım orada.
2. Oturum sonunda: `memo/DURUM.md` güncelle + `memo/oturumlar/YYYY-AA-GG.md` günlüğü yaz.
   (Commit+push'u SessionEnd hook'u otomatik yapar; elle yapıyorsan mesaj formatı: `oturum: ...`)

## Belge haritası

| Belge | İçerik | Ne zaman bak |
|---|---|---|
| `ROADMAP.md` | Fazlar, kabul testleri | Yeni faza başlarken |
| `docs/PROTOKOL.md` | WS/REST protokol spesifikasyonu | shared/core/cli/ui'ye dokunmadan önce **mutlaka** |
| `docs/SPEC-AGENT.md` | Agent motoru + izin sistemi şartnamesi | Faz 3+ işlerinde **mutlaka** |
| `docs/kararlar/KARARLAR.md` | Mimari kararlar ve gerekçeleri (ADR) | Teknoloji değiştirmek istediğinde |
| `docs/GEREKSINIMLER.md` | Kütüphane envanteri, dizin planı | Bağımlılık eklerken |

## Dokunulmaz kurallar

1. **Protokol kutsaldır.** CLI ve UI, daemon'la YALNIZCA `packages/shared`'daki tiplerle konuşur.
   Yeni mesaj/olay eklemek = önce `docs/PROTOKOL.md` güncelle, sonra `shared`'a zod şeması ekle,
   sonra kullan. Şeması olmayan mesaj gönderilemez.
2. **Mimari kararlar ADR'siz değişmez.** "Electron'a geçelim", "LangChain kullanalım" gibi bir
   değişiklik yapmadan önce `docs/kararlar/KARARLAR.md`'deki ilgili kaydı oku; reddedilme
   gerekçesi hâlâ geçerliyse değiştirme. Değiştireceksen önce ADR'ye yeni kayıt yaz.
3. **API anahtarı asla dosyaya/koda/loga yazılmaz.** Anahtarlar OS keychain'inde (keytar).
   `providers.json` yalnızca anahtar-DIŞI yapılandırma içerir.
4. **Temperature varsayılanı 0'dır.** Agent tanımında açıkça belirtilmedikçe yükseltilmez.
5. **Test geçmeden iş bitmiş sayılmaz.** Her yeni özellik Vitest testiyle gelir; fazın
   ROADMAP'teki kabul testi geçmeden faz kapanmaz.
6. **Agent izinsiz dosya değiştiremez / komut çalıştıramaz.** İzin akışı `docs/SPEC-AGENT.md`'de;
   bu akışı atlayan kısayol ekleme.
7. **Dikey dilim.** Uçtan uca çalışmayan 3 haftalık altyapı işi açma; her adım çalışan bir şey bırakır.

## Kod kuralları

- TypeScript `strict: true`; `any` yasak (zorunluysa `unknown` + daraltma).
- Monorepo: pnpm workspace + turbo. Paketler: `shared` → `core` → (`cli`, `ui`, `desktop`).
  Bağımlılık yönü tek taraflıdır: `shared` hiçbir pakete bağımlı olamaz.
- Tanımlayıcılar (değişken/fonksiyon/tip) İngilizce; kullanıcıya görünen metinler ve belgeler Türkçe.
- Hata yönetimi: hatayı yutma; `pino` ile yapılandırılmış logla (telemetri buna bağlı).
- Çapraz platform: path işlemlerinde daima `node:path`; kabuk komutu üretirken Windows
  (PowerShell) ve POSIX farkını `execa` ile soyutla; `~` genişletmesini elle yapma.

## Komutlar (Faz 0 sonrası geçerli)

```
pnpm install        # bağımlılıklar
pnpm build          # tüm paketleri derle (turbo)
pnpm test           # tüm testler (vitest)
pnpm dev            # core daemon'ı izleme modunda başlat
```

## Kullanıcı hakkında

Kullanıcı Türkçe konuşur; cevaplar Türkçe olmalı. Net tavsiye + kısa gerekçe ister;
seçenek yığını değil karar bekler. Ekonomik neden: pahalı model saatleri tasarım işine,
ucuz model saatleri uygulama işine harcanır — sen hangi modelsen, spec'e sadık kal.
