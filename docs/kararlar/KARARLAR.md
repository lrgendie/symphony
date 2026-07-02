# ⚖️ KARARLAR.md — Mimari Karar Kayıtları (ADR)

> Kural: Buradaki bir kararı değiştirmek isteyen (insan veya model), önce ilgili kaydın
> "Reddedilenler" bölümünü okur. Gerekçe hâlâ geçerliyse karar değişmez. Değişecekse
> buraya yeni tarihli bir kayıt eklenir; eski kayıt silinmez, "geçersiz" işaretlenir.
> Tüm kayıtlar 2026-07-02/03 tarihli, Fable 5 ile tasarlanmıştır.

---

## ADR-001 — Daemon merkezli mimari
**Karar:** Tüm durum ve akıl tek arka plan sürecinde (`symphonyd`); CLI, masaüstü ve olası
web arayüzü yalnız WS/REST istemcisidir.
**Gerekçe:** Terminal ⇄ masaüstü eş zamanlılığı ancak tek doğruluk kaynağıyla bedavaya gelir;
arayüz eklemek (mobil, web) çekirdeğe dokunmaz.
**Reddedilenler:** Her arayüzün kendi motoru (senkronizasyon cehennemi); Electron main
process'te motor (CLI'sız kalır, Tauri'ye kilitler).
**Geri dönüş koşulu:** Yok — bu proje kimliğidir.

## ADR-002 — Tek dil: TypeScript
**Karar:** Çekirdek, CLI ve UI TypeScript; çalışma zamanı Node 22 LTS.
**Gerekçe:** Tüm hedef AI SDK'ları TS'de birinci sınıf; `shared` paketiyle uçtan uca tip
güvenliği; tek dil = tek zihinsel model, kod paylaşımı, kolay işe alım (gelecekte model/insan).
**Reddedilenler:** Python çekirdek (cross-platform paketleme zahmeti, iki dil maliyeti);
Rust/Go çekirdek (geliştirme hızı bu projede belirleyici); Bun (cazip ama native modül
ekosistemi — better-sqlite3, keytar — Node'da daha kanıtlanmış; Faz 7'de yeniden değerlendirilebilir).

## ADR-003 — LLM soyutlaması: Vercel AI SDK
**Karar:** Tüm model çağrıları `ai` paketi + resmi provider adapter'ları üzerinden.
**Gerekçe:** Streaming + tool-calling tek arayüzde; Anthropic/OpenAI/Google/Ollama resmî veya
olgun adapter'lara sahip; provider eklemek ~1 dosya.
**Reddedilenler:** Her SDK'yı elle sarmak (4× bakım); LangChain (ağır soyutlama, bizim
ihtiyaç sadece çağrı katmanı — orkestrasyonu zaten kendimiz yazıyoruz).
**Geri dönüş koşulu:** SDK tool-calling'de kritik bir yeteneği desteklemezse o provider için
yerel ince sarmalayıcı yazılır; genel soyutlama değişmez.

## ADR-004 — Masaüstü kabuk: Tauri 2 (yedek plan: Electron)
**Karar:** Masaüstü uygulaması Tauri 2; UI zaten web (React) olduğundan kabuk incedir.
**Gerekçe:** ~10 MB kurulum, düşük RAM, Windows ARM64 + Apple Silicon native, imzalama ve
auto-update desteği.
**Reddedilenler:** Electron (150 MB, RAM ağır) — ANCAK bilinçli B planıdır: Rust toolchain
Faz 4'te 1 haftadan uzun sorun çıkarırsa Electron'a geçilir; UI kodu hiç değişmez, yalnız kabuk.

## ADR-005 — Yerel LLM: Ollama
**Karar:** Yerel modeller Ollama üzerinden (REST, localhost:11434); Symphony'de sıradan bir provider.
**Gerekçe:** Win/mac/Linux + ARM native; model indirme/kota/GPU yönetimini o çözüyor;
kullanıcı tabanı ve model kataloğu en geniş.
**Reddedilenler:** llama.cpp'yi gömmek (native derleme + VRAM yönetimi bizim sorunumuz olur);
LM Studio (API'si var ama kapalı kaynak, otomasyonu zayıf). İkisi de ileride ek provider
olarak eklenebilir — mimari engel yok.

## ADR-006 — Veri katmanı: SQLite (better-sqlite3)
**Karar:** Tüm kalıcı veri (geçmiş, telemetri, router skorları) tek SQLite dosyasında:
`~/.symphony/data/symphony.db`.
**Gerekçe:** Sıfır kurulum, tek dosya = kolay yedek/senkron, senkron API (better-sqlite3)
event-loop'u bloklamayacak kadar hızlı; localhost tek kullanıcı — sunucu DB gereksiz.
**Reddedilenler:** PostgreSQL (kurulum yükü), JSON dosyaları (sorgu/istatistik ihtiyacı var),
IndexedDB/LowDB (çok istemcili daemon erişimi sorunlu).

## ADR-007 — Araç protokolü: MCP istemcisi olmak
**Karar:** Symphony, MCP (Model Context Protocol) istemcisi olur; harici MCP sunucuları
agent araçlarına dönüşür. Yerleşik araçlar (dosya, komut) MCP'siz, süreç-içi kalır.
**Gerekçe:** Binlerce hazır sunucu (tarayıcı, DB, scraping); standart kazanan protokol.
Yerleşik araçların süreç-içi kalması: izin sistemi ve jail ile sıkı bütünleşme + hız.
**Reddedilenler:** Her aracı kendimiz yazmak (ekosistemi kaçırırız); HER aracı MCP yapmak
(izin/jail denetimini gevşetir, gecikme ekler).

## ADR-008 — Temperature varsayılanı 0
**Karar:** Tüm model çağrılarında `temperature: 0`; agent tanımında açık istisna mümkün.
**Gerekçe:** Kod/araç/analiz işlerinde determinizm, tekrarlanabilir testler, daha az halüsinasyon.
**Reddedilenler:** Görev türüne göre otomatik temperature (öngörülemez davranış; istisna
bilinçli ve görünür olmalı).

## ADR-009 — Monorepo: pnpm workspace + turbo
**Karar:** Tek repo; paketler `shared/core/cli/ui/desktop`; bağımlılık yönü tek taraflı
(`shared` ← herkes; `core` ← kimse UI'dan).
**Gerekçe:** Protokol tiplerinin tek kaynaktan paylaşımı monorepo'suz eziyettir; turbo
önbelleğiyle hızlı CI.
**Reddedilenler:** Çoklu repo (sürüm eşleme cehennemi); npm/yarn (pnpm disk/hız üstünlüğü).

## ADR-010 — Anahtar saklama: OS keychain (keytar)
**Karar:** API anahtarları Windows Credential Manager / macOS Keychain'de; dosyada asla.
**Gerekçe:** Repo/yedek sızıntısında anahtar sızmaz; `symphony sync` anahtarsız güvenli olur.
**Bilinen risk:** keytar bakım modunda; Electron'dan bağımsız prebuilt'leri ARM64'te sorun
çıkarırsa alternatif: `@napi-rs/keyring` (Rust tabanlı, aktif). Faz 1'de ikisi de denenir,
çalışan seçilir — arayüz bizim `SecretStore` soyutlamamızdır, geçiş maliyeti ~1 dosya.

## ADR-011 — Yeniden bağlanmada replay yok, snapshot var
**Karar:** Daemon olay geçmişi tutmaz; kopan istemci `hello.ok.snapshot` + `state.sync` ile
tam durumu alır, kalıcı geçmişi REST/SQLite'tan sorgular.
**Gerekçe:** Replay tamponu (sıra numarası, kaçırılan olay, tampon taşması) karmaşıklığın
%80'i, değerin %20'si. Snapshot basit ve her zaman doğru.
**Geri dönüş koşulu:** UI'da "kopukluk anında olan biteni kaçırdım" gerçek bir sorun olursa
Faz 5+'ta değerlendirilir.
