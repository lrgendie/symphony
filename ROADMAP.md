# 🎼 SYMPHONY — Yol Haritası

> Yerel + bulut LLM'leri ve agent'ları tek merkezden yöneten, koda müdahale edebilen,
> Windows / macOS / ARM üzerinde çalışan, terminal + masaüstü senkron orkestrasyon platformu.

---

## 1. Temel Mimari Karar: "Daemon Merkezli" Tasarım

Projenin en kritik kararı şu: **bütün akıl tek bir çekirdek serviste (daemon) yaşar,
terminal ve masaüstü uygulaması sadece o servise bağlanan iki ayrı "ekran"dır.**

```
                    ┌─────────────────────────────┐
                    │      symphonyd (Çekirdek)    │
                    │  • Provider yöneticisi       │
                    │  • Agent motoru              │
                    │  • Görev kuyruğu             │
                    │  • Olay yayını (WebSocket)   │
                    │  • İzin/güvenlik katmanı     │
                    └──────────┬──────────────────┘
                    WebSocket + REST (localhost)
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────┴─────┐    ┌─────┴─────┐    ┌─────┴─────┐
        │  CLI/TUI  │    │ Masaüstü  │    │  (ileride │
        │ symphony  │    │ Dashboard │    │  web/mobil)│
        └───────────┘    └───────────┘    └───────────┘
```

**Neden?** Terminale `symphony` yazıp bir agent başlattığında, masaüstü uygulaması aynı
WebSocket olay akışını dinlediği için her şeyi **eş zamanlı** görürsün. İstediğin
"senfoni yönetir gibi canlı izleme" özelliği bu mimarinin doğal sonucudur — sonradan
eklenen bir özellik değil.

---

## 2. Teknoloji Seçimleri (ve Nedenleri)

| Katman | Seçim | Neden |
|---|---|---|
| **Dil** | TypeScript (her yerde) | Tüm AI SDK'ları (Anthropic, OpenAI, Google, Ollama) birinci sınıf TS desteğine sahip. Tek dil = CLI, çekirdek ve arayüz arasında kod paylaşımı. Claude Code'un kendisi de bu stack ile yazıldı. |
| **Çalışma zamanı** | Node.js 22 LTS | Windows/macOS/Linux + x64/ARM64 resmi desteği. Bilgisayar değiştirince tek kurulum. |
| **Paket yöneticisi** | pnpm (workspace/monorepo) | Tek repo içinde core/cli/ui/desktop paketleri. |
| **LLM soyutlama** | Vercel AI SDK (`ai` paketi) | Claude, GPT, Gemini, Ollama'yı **tek arayüzle** konuşturur: streaming + tool-calling hepsinde aynı kodla çalışır. Provider eklemek = 1 adapter dosyası. |
| **Yerel LLM** | Ollama | Windows/Mac/Linux + Apple Silicon'da native. REST API'si var; sistemde "bir provider daha" gibi görünür. |
| **Araç protokolü** | MCP (Model Context Protocol) | Agent'lara yetenek eklemenin endüstri standardı. Symphony MCP istemcisi olursa, hazır binlerce MCP sunucusunu (dosya, tarayıcı, DB...) tak-çalıştır kullanırsın. |
| **CLI/TUI** | Ink (React ile terminal arayüzü) | Claude Code'un kullandığı kütüphane. Model seçici, canlı spinner'lar, renkli paneller. |
| **Masaüstü** | Tauri 2 + React + Vite | ~10 MB kurulum (Electron ~150 MB), Windows ARM64 ve Apple Silicon native desteği. İçindeki arayüz zaten web (React) olduğu için CLI dışındaki her şey TS kalır. Rust derleme sorun çıkarırsa B planı: Electron. |
| **Canlı arayüz görselleri** | Three.js (React Three Fiber) | "Living Interface" vizyonu: WebGL parçacık küresi — sistem boştayken nefes alır, agent çalışırken hareketlenir, hataya renkle tepki verir. |
| **Yerel veri katmanı** | SQLite (better-sqlite3) | Sohbet geçmişi, model performans kayıtları, kullanım istatistikleri — kişiselleşmenin ve akıllı yönlendirmenin yakıtı, tamamı lokalde. |
| **API anahtarları** | İşletim sistemi keychain'i (keytar / Tauri secure storage) | Anahtarlar asla düz dosyada durmaz. |
| **Taşınabilirlik** | `~/.symphony/` klasörü + git senkronu | Agent tanımların, ayarların, proje kayıtların burada. Yeni bilgisayarda: uygulamayı kur → `symphony sync` → kaldığın yerden devam. |

---

## 3. Depo Yapısı

```
symphony/
├── package.json              # pnpm workspace kökü
├── packages/
│   ├── shared/               # Ortak tipler, WS protokol şeması (her paket bunu kullanır)
│   ├── core/                 # symphonyd: provider'lar, agent motoru, event bus
│   ├── cli/                  # `symphony` komutu (Ink TUI)
│   ├── ui/                   # React dashboard (Vite) — hem Tauri hem tarayıcıda çalışır
│   └── desktop/              # Tauri 2 kabuğu (ui'yi paketler)
└── docs/
```

---

## 4. Fazlar

### Faz 0 — Temel Atma (1. hafta) ✅ 2026-07-03
- [x] pnpm monorepo + TypeScript + ESLint/Prettier kurulumu
- [x] `packages/shared`: olay/mesaj tipleri — PROTOKOL.md'nin tamamı zod şemalarına kodlandı (zarf, 11 istek, 26 olay/cevap, agent durum makinesi)
- [x] `~/.symphony/` config yapısı: `core`'da paths modülü (`SYMPHONY_HOME` ile taşınabilir)
- [x] Test altyapısı (Vitest, 24 test) + GitHub Actions CI — ileride sistemin kendine yazacağı yamaların "bağışıklık sistemi"; test paketi geçmeyen hiçbir değişiklik canlıya çıkamaz
- **Çıktı:** `pnpm build` ve `pnpm test` çalışan iskelet repo.
- **Kabul testi:** Temiz klonda `pnpm install && pnpm build && pnpm test` sıfır hatayla geçer; CI yeşil; `shared`'daki en az bir zod şemasının doğrulama testi vardır.

### Faz 1 — Çekirdek: Provider Katmanı (2–3. hafta) — devam ediyor
- [x] `symphonyd` süreci: localhost REST + WebSocket sunucusu (Fastify + ws) — token auth, hello akışı, snapshot ✅ 2026-07-03
- [x] Vercel AI SDK ile provider adapter'ları: **Anthropic ✅ (canlı) → Ollama ✅ (canlı: qwen3:8b, $0) → OpenAI ✅ (kod; canlı test anahtar bekliyor) → Google ✅ (kod; canlı test anahtar bekliyor)** 2026-07-03
- [x] API anahtarı yönetimi (keychain: @napi-rs/keyring + env yedek) + provider sağlık kontrolü ✅ 2026-07-03
- [x] Streaming sohbet: tek uçtan tüm modellerle konuşabilme ✅ 2026-07-03 — Anthropic + Ollama canlı doğrulandı; OpenAI/Google kod hazır, canlı doğrulama anahtar bekliyor
- [x] SQLite veri katmanı: her isteğin kaydı (model, süre, token, maliyet, başarı) + `usage.query` + kalıcı toplamlar ✅ 2026-07-03 — ileride router ve kişiselleşme bu veriyle beslenecek; sohbet geçmişi tablosu Faz 2'de CLI oturumlarıyla eklenecek
- [x] Hata telemetrisi: daemon hatalarının yapılandırılmış kaydı (hangi işlem, girdi ÖZETİ, stack trace) ✅ 2026-07-03 — kendi kendini onarmanın veri kaynağı; agent hataları Faz 3'te aynı tabloya düşecek
- [x] **Model yönlendirici v1 (kural tabanlı):** görev türüne göre gerekçeli öneri (kod/hızlı/uzun bağlam/genel) ✅ 2026-07-03 — donanımı tanıyor (nvidia-smi ile VRAM; <5 GB'da yerel öneri geriye düşer), yalnız kullanılabilir sağlayıcılardan önerir, `router.suggest` protokol mesajı canlı
- **Çıktı:** `curl` ile 4 farklı sağlayıcıdan streaming cevap alınabiliyor.
- **Kabul testi:** 4 sağlayıcıdan streaming cevap; anahtarlar diskte grep'lenemiyor (yalnız keychain); her istek SQLite'a kayıt düşüyor; `providers.status` gerçek sağlık durumu döndürüyor; router v1 örnek göreve gerekçeli öneri veriyor.

### Faz 2 — CLI: `symphony` Komutu (4–5. hafta) ✅ 2026-07-03
- [x] Ink TUI: açılışta model seçici (↑/↓+Enter, tüm sağlayıcılar) + streaming sohbet ekranı (Esc iptal) ✅ 2026-07-03 — kullanıcının canlı TUI denemesi geçti
- [x] `symphony` yazınca daemon çalışmıyorsa otomatik başlatma ✅ 2026-07-03 — kabul koşusu geçti: temiz terminalde `status` daemon'ı spawn etti
- [x] Komutlar: `symphony` (TUI), `symphony models`, `symphony status`, `symphony watch` (canlı olay akışı), `symphony history` (sohbet geçmişi) ✅ 2026-07-03 — `symphony agents` Faz 3'te (agent motoru gerekiyor)
- [x] Global kurulum: PATH'e `symphony` komutu ✅ 2026-07-03 — `pnpm setup` + `pnpm add -g link:packages/cli` (workspace bağımlılıkları nedeniyle npm yerine pnpm link; symlink olduğu için her build otomatik yansır)
- [x] Sohbet geçmişi: SQLite `sessions`+`messages` (göç v2, replace semantiği), REST `/api/history/*`, TUI sabit sessionId ✅ 2026-07-03 — canlı doğrulandı
- **Çıktı:** Terminalde `symphony` → model seç → sohbet et.
- **Kabul testi:** Temiz terminalde `symphony` daemon'ı otomatik başlatıyor ✅; model seçici tüm sağlayıcıları listeliyor ✅; streaming sohbet akıyor ✅ (canlı, 2026-07-03); aynı anda açık ikinci istemci aynı olayları görüyor ✅ (concurrency.test.ts + `symphony watch`).

### Faz 3 — Kod Agent'ı: Sisteme Müdahale (6–8. hafta) ⭐ kalbi burası
- [ ] Araç seti: `read_file`, `write_file`, `edit`, `glob`, `grep`, `run_command` (PowerShell/bash)
- [ ] Agent döngüsü: model → tool call → sonuç → model... (Vercel AI SDK tool-calling ile, her modelde aynı)
- [ ] **İzin sistemi:** her dosya yazma / komut çalıştırma öncesi onay (Claude Code'daki gibi), "her zaman izin ver" listesi
- [ ] Diff önizleme: agent dosya değiştirmeden önce ne değişeceğini göster
- [ ] MCP istemci desteği: harici MCP sunucularını agent'lara araç olarak bağlama
- [ ] **Eklenti sistemi:** `symphony add <github-repo | npm-paket | mcp-sunucu>` — GitHub'daki bir aracı veya MCP sunucusunu indirip agent'lara araç olarak kaydetme; ilk örnek eklenti: Playwright tabanlı web scraping aracı
- **Çıktı:** "şu dosyadaki bug'ı düzelt" diyebildiğin, onayınla kodu değiştiren agent.
- **Kabul testi:** Agent diff gösterip onay almadan tek bayt yazamıyor (izinsiz yazma girişimi testle kanıtlanmış şekilde engelli); workspace dışına çıkamıyor; deny cevabı koşuyu kırmıyor; bir harici MCP sunucusu bağlanıp araç olarak çağrılıyor. Davranışlar `docs/SPEC-AGENT.md`'ye uygun.

### Faz 4 — Masaüstü: Orkestra Sahnesi (9–11. hafta)
- [ ] Tauri 2 + React dashboard, daemon'un WS akışına bağlanır
- [ ] **"Living Interface" sahnesi:** Three.js parçacık küresi merkezde — boşta yavaşça nefes alır, agent düşünürken dalgalanır, araç çalıştırırken hızlanır, hatada renk değiştirir. Her agent'ın kendi küçük "yaşam formu" olur
- [ ] **Şef Paneli:** aktif agent'lar (kim çalışıyor, hangi araç, hangi dosya), canlı log akışı
- [ ] Model panosu: provider durumları, token kullanımı/maliyet sayaçları, yerel model VRAM durumu
- [ ] **Yol haritası görselleştirme:** projelerin ROADMAP/plan dosyalarından otomatik üretilen interaktif faz-adım grafiği; hangi adım bitti, hangi adımda hangi agent çalışıyor canlı görünür
- [ ] Proje görünümü: hangi projede hangi agent ne yapıyor
- [ ] Terminal ⇄ masaüstü eş zamanlılık testi: CLI'da başlayan iş anında ekranda
- **Çıktı:** Terminalde agent çalıştırırken masaüstünde canlı izlediğin, yaşayan dashboard.
- **Kabul testi:** CLI'da başlatılan koşu 1 saniye içinde masaüstünde görünüyor; küre agent durumlarına (thinking/executing/failed) görsel tepki veriyor; token/maliyet sayaçları gerçek kullanım verisiyle artıyor; izin istekleri masaüstünden de cevaplanabiliyor.

### Faz 5 — Orkestrasyon: Çoklu Agent (12–14. hafta)
- [ ] Görev kuyruğu: birden çok agent'ı paralel çalıştırma, birbirine iş devretme
- [ ] Agent tanımları dosya olarak: `~/.symphony/agents/*.md` (rol + araçlar + model) → taşınabilir
- [ ] "Şef" agent: görevi alt görevlere bölüp uygun agent'lara/modellere dağıtan üst akıl
- [ ] Maliyet stratejisi: basit işleri yerel/ucuz modele, zor işleri Claude'a yönlendirme
- **Çıktı:** Tek komutla çok-agent'lı iş akışı, dashboard'da orkestra gibi izlenir.
- **Kabul testi:** İki agent aynı anda farklı görevlerde koşup dashboard'da ayrı izlenebiliyor; şef agent bir görevi en az iki alt göreve bölüp farklı modellere dağıtıyor; agent tanımı dosyası yeni makineye kopyalanınca aynen çalışıyor.

### Faz 6 — Zeka Katmanı: Seni Tanıyan Symphony (15–17. hafta)
- [ ] **Model yönlendirici v2 (öğrenen):** Faz 1'den beri biriken kayıtlardan (hangi model hangi görevde başarılı/hızlı/ucuz oldu) skor tablosu; "bu işi kime verelim?" sorusuna veriyle cevap
- [ ] Soru sorulduğunda otomatik öneri: "Bu görev için yerel Qwen yeterli (ücretsiz, ~3sn) — ama en yüksek kalite istersen Claude öneririm (~$0.04)" gibi şeffaf gerekçeli seçenek sunma
- [ ] **Kullanıcı hafızası:** tercihlerini, kod stilini, sık kullandığın projeleri ve düzeltmelerini hatırlayan kalıcı profil (`~/.symphony/memory/`) — her agent bu bağlamla başlar
- [ ] **Kendini geliştirme döngüsü:** haftalık kullanım özeti üzerinden sistemin kendi yönlendirme kurallarını ve agent tanımlarını güncelleme önerisi (onayınla uygulanır)
- [ ] Geri bildirim sinyalleri: cevabı beğenme/düzeltme, agent çıktısını geri alma gibi olaylar skorlara işlenir
- **Çıktı:** "Şu PDF'leri özetleyecek bir şey lazım" dediğinde donanımına, geçmişine ve bütçene göre doğru modeli öneren; seni tanıdıkça isabeti artan sistem.
- **Kabul testi:** Router v2 önerileri gerçek kullanım skorlarına dayanıyor ve gerekçesini gösteriyor; kullanıcı hafızasına yazılan bir tercih yeni oturumda agent bağlamında görülüyor; haftalık rapor üretiliyor; tüm öğrenme verisi lokalde kalıyor (dışarı istek testle doğrulanmış şekilde yok).

### Faz 7 — Paketleme ve Taşınabilirlik (18–19. hafta)
- [ ] Tauri installer'ları: Windows x64/ARM64 (.msi), macOS Intel/Apple Silicon (.dmg)
- [ ] CLI dağıtımı: npm paketi + tek dosya binary seçeneği
- [ ] `symphony sync`: `~/.symphony/` klasörünü özel git deposuyla eşitleme (yeni makinede 2 dakikada kurulum)
- [ ] Otomatik güncelleme (sürümlü + tek komutla geri alınabilir; güncelleyici çekirdek ayrı ve dokunulmaz)
- **Çıktı:** Kur → giriş yap → senkronla → devam et.
- **Kabul testi:** Windows installer temiz bir makinede kurulup çalışıyor; `symphony` komutu PATH'te; `symphony sync` ikinci makinede ayarları ve agent tanımlarını geri getiriyor (anahtarlar hariç — onlar yeniden girilir); güncelleme tek komutla geri alınabiliyor.

### Faz 8 — Kendini Geliştiren Symphony (20. hafta ve sonrası, sürekli) ⭐ nihai hedef
> Symphony'nin kod agent'ı vardır; kendini geliştirmek = agent'ın hedef olarak **kendi reposunu** alması.
> Güvenliği dört sigorta sağlar: test paketi (Faz 0), hata telemetrisi (Faz 1), rollback (Faz 7), onay kapısı.

- [ ] **Doktor agent:** hata telemetrisini periyodik okur, tekrarlayan hataları saptar, kök neden analizi yapar
- [ ] **Kendine yama döngüsü:** Doktor agent hatayı sandbox'ta (ayrı git branch + izole süreç) yeniden üretir → düzeltme yazar → tüm test paketini çalıştırır → geçerse diff + test raporu ile onayına sunar
- [ ] **Onaylı canlıya alma:** onayladığın yama sürüm olarak derlenir, daemon kendini yeniden başlatarak günceller; sorun çıkarsa watchdog otomatik bir önceki sürüme döner
- [ ] **Güven merdiveni:** yama kategorileri bazında sicil tutulur ("null hatası düzeltmeleri: 12/12 başarılı"); istediğin kategorilere "artık sormadan uygula" yetkisi verebilirsin — varsayılan her zaman "sor"
- [ ] **Bekçi modu (senin projelerin için):** Symphony'de kayıtlı programlarının loglarını/çıktılarını izler; hata veya crash görünce seni uyarır ve tek tıkla "düzeltme öner" akışını başlatır — kendi hatalarını kapattığı mekanizmanın aynısı senin kodun için de çalışır
- [ ] **Kendini geliştirme raporu:** haftalık özet — hangi hatalar yakalandı, hangi yamalar uygulandı, router isabeti nasıl değişti, hangi yeni yetenek öneriliyor
- [ ] Değişmezler (asla otomatikleşmez): güncelleyici çekirdek, izin sistemi, API anahtar yönetimi — bunlara dokunan her değişiklik her zaman insan onayı ister
- **Çıktı:** Hatasını gören, yamasını yazan, test eden, onayınla kendini güncelleyen ve sicili büyüdükçe daha bağımsızlaşan sistem.
- **Kabul testi:** Kasıtlı enjekte edilen bir hatayı Doktor agent telemetriden saptayıp sandbox'ta yama + geçen test raporu üretiyor; testleri geçmeyen yama canlıya çıkamıyor; bozuk sürüm watchdog ile otomatik geri alınıyor; değişmez bileşenlere (güncelleyici, izin sistemi, anahtar yönetimi) dokunan yama otomatik uygulanamıyor.

---

## 5. İlk Somut Adımlar (bu hafta)

1. Monorepo iskeletini kur (Faz 0)
2. `shared` paketinde WS protokolünü tasarla — bu sözleşme her şeyin temeli
3. `core` içinde tek provider'la (Anthropic) uçtan uca streaming sohbeti çalıştır
4. Kazanılan güvenle Ollama'yı ekle → "hem yerel hem bulut" hedefi 1. ayda kanıtlanmış olur

## 6. İlkeler

- **Önce dikey dilim:** Her fazda uçtan uca çalışan küçük bir şey; asla 3 ay görünmez altyapı yazma.
- **Protokol kutsaldır:** CLI ve UI daemon'la sadece `shared` paketindeki tiplerle konuşur.
- **Güvenlik varsayılan:** Agent hiçbir dosyayı iznin olmadan değiştiremez; anahtarlar keychain'de.
- **Her model eşit vatandaş:** Claude, GPT, Gemini, yerel Llama — hepsi aynı adapter arayüzünün arkasında.
- **Determinizm varsayılandır:** Tüm model çağrılarında `temperature` varsayılanı **0**'dır (kod, araç çağrısı, analiz — tutarlılık ve tekrarlanabilirlik için). Agent tanımında açıkça belirtilerek yükseltilebilir (ör. yaratıcı yazım görevleri); ama bilinçli bir istisna olmadıkça 0 kalır.
- **Öğrenme lokaldir:** Seni tanıyan tüm veri (kullanım geçmişi, tercihler, skorlar) kendi diskinde durur; hiçbir yere gönderilmez, `symphony sync` ile sadece kendi depona yedeklenir.
- **Arayüz yaşar:** Dashboard bir tablo yığını değil, sistemin nabzını gösteren canlı bir sahnedir — ama her animasyonun bir anlamı vardır (durum, yük, hata), süs değil.
