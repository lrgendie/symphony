# 🎼 SYMPHONY — Yol Haritası

> Yerel + bulut LLM'leri ve agent'ları tek merkezden yöneten, koda müdahale edebilen,
> Windows / macOS / ARM üzerinde çalışan, terminal + masaüstü senkron orkestrasyon platformu.

> **📌 Model devri notu (2026-07-04):** Tasarım Fable 5 ile yapıldı; Fable'ın haftalık
> limiti dolduğunda işi Opus (veya başka bir model) devralır. Devralan model işe
> başlamadan önce **`memo/DEVIR.md`** okumak ZORUNDADIR: mimari özet, iş disiplini,
> Faz 3 kalanları ve bu projede kanla öğrenilmiş teknik tuzaklar orada. Oturum
> başlangıç rutini: `memo/DURUM.md` + `memo/BAGLAM.md` (geniş kod taraması yasak).

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

### Faz 1 — Çekirdek: Provider Katmanı (2–3. hafta) ✅ 2026-07-03
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

### Faz 2.5 — CLI Kimliği: Karşılama Ekranı (küçük dilim) ✅ 2026-07-03
- [x] `symphony` açılışında karşılama ekranı: marka logosu (ASCII/Unicode), sürüm + protokol,
  tarih, daemon/sağlayıcı durum özeti, toplam kullanım (SQLite'tan), kısayol ipuçları —
  Claude Code'un oturum başlangıcı karşılaması gibi ✅ 2026-07-03 (`tui/welcome.tsx`, testli)
- [x] Logo tek modülde yaşar (`packages/cli/src/tui/logo.ts`): kullanıcının kendi logosu
  gelince yalnız o dosya değişir; renk paleti markayla uyumlu ✅ 2026-07-03
- **Çıktı:** `symphony` yazınca sistem "merhaba" diyor — kimliği olan bir açılış.
- **Kabul testi:** Karşılama ekranı logo + tarih + gerçek sağlayıcı durumu + gerçek kullanım
  toplamını gösteriyor; model seçici akışı bozulmuyor; bileşen testli.

### Faz 3 — Kod Agent'ı: Sisteme Müdahale (6–8. hafta) ✅ 2026-07-05 ⭐ kalbi burası
- [x] Araç seti: `read_file`, `write_file`, `edit`, `glob`, `grep`, `run_command` (PowerShell/bash) ✅ 2026-07-04 — workspace jail + sır maskeleme + temiz env dâhil (`core/src/agent/tools.ts`, testli)
- [x] Agent döngüsü: model → tool call → sonuç → model... (Vercel AI SDK tool-calling ile, her modelde aynı) ✅ 2026-07-04 — maxSteps sigortası, AGENT_TOOL_LOOP, iptal, durum makinesi (`engine.ts`)
- [x] **İzin sistemi:** her dosya yazma / komut çalıştırma öncesi onay (Claude Code'daki gibi), "her zaman izin ver" listesi ✅ 2026-07-04 — deny>allow>risk varsayılanı; destructive'de always_allow yok
- [x] Diff önizleme: agent dosya değiştirmeden önce ne değişeceğini göster ✅ 2026-07-04 — bayat-diff (PERMISSION_STALE_DIFF) denetimiyle
- [x] MCP istemci desteği: harici MCP sunucularını agent'lara araç olarak bağlama ✅ 2026-07-05
  — `@modelcontextprotocol/sdk` (stdio), `~/.symphony/mcp-servers.json` kayıt defteri,
  agent frontmatter'ında `mcpServers: [...]`, araçlar `mcp__<sunucu>__<araç>` adıyla
  `mutating` risk sınıfında bağlanır (`core/src/agent/mcp.ts`)
- [x] **Eklenti sistemi (v1 kapsamı: npm paketi):** `symphony add <npm-paketi>` ✅ 2026-07-05 —
  daemon `mcp.addServer` isteğiyle sunucuya CANLI bağlanıp `tools/list` doğrular
  (yanlış paket adı hemen görülür), sonra `~/.symphony/mcp-servers.json`'a kaydeder.
  GitHub-repo kaynağı v1 dışında bırakıldı (build/sandbox belirsizliği ayrı bir dilim).
  İlk örnek eklenti canlı denendi: `symphony add @playwright/mcp` → 23 araç bulundu
  (browser_click, browser_navigate, browser_snapshot, ...).
- [x] TUI'de agent modu: izin isteği kutusu + diff görünümü ✅ 2026-07-05 — `symphony` (argümansız)
  artık karşılama sonrası Sohbet/Agent modu soruyor; Agent seçilince kayıtlı agent listesi
  (`agents.list`), sonra görev girişi, sonra canlı koşu ekranı (araç günlüğü + tek tuşla
  e/d/h izin kutusu + renkli diff + sonuç/hata). `cli/src/tui/{mode-picker,agent-picker,
  agent-run}.tsx`. 12 bileşen testi (`ink-testing-library`, gerçek klavye tuşu simülasyonu)
  yeşil. **Not:** raw-mode terminal TTY gerektirdiği için bu oturumda otomatik canlı
  doğrulama yapılamadı (Bash aracı + winpty denendi, ikisi de gerçek konsol veremedi) —
  kullanıcının kendi terminalinde bir kez denemesi gerekiyor (Faz 2'nin sohbet TUI'sinde
  de aynı şekilde kullanıcı doğrulamıştı).
- **Çıktı:** "şu dosyadaki bug'ı düzelt" diyebildiğin, onayınla kodu değiştiren agent.
- **Kabul testi:** Agent diff gösterip onay almadan tek bayt yazamıyor (izinsiz yazma girişimi testle kanıtlanmış şekilde engelli) ✅; workspace dışına çıkamıyor ✅; deny cevabı koşuyu kırmıyor ✅ (üçü de `engine.test.ts` + `daemon-agent.test.ts`, 2026-07-04); bir harici MCP sunucusu bağlanıp araç olarak çağrılıyor ✅ (2026-07-05, canlı: `@modelcontextprotocol/server-filesystem`, izin akışı + araç hatası kurtarma gerçek sunucuyla kanıtlandı — `mcp.test.ts` + `engine.test.ts`). Davranışlar `docs/SPEC-AGENT.md`'ye uygun.

### Faz 4 — Masaüstü: Orkestra Sahnesi (9–11. hafta) ✅ 2026-07-10 (P1/P2/P3 kapanışı)
- [x] Tauri 2 + React dashboard, daemon'un WS akışına bağlanır ✅ 2026-07-05 (dilim 1) —
  `packages/ui` (React 19 + Vite 8, tarayıcı-güvenli WS istemcisi, yalnız `shared`'a bağımlı)
  + `packages/desktop` (Tauri 2, `ui/dist`'i sarar, token'ı `~/.symphony/daemon.token`'dan
  okuyup webview'e enjekte eder). cargo build ✅, wire-protokol smoke testi ✅ (daemon
  `client:"desktop"` bağlantısını kabul edip snapshot döndü), store birim testleri ✅ (6).
  **Pencere görsel doğrulaması KULLANICI tarafından yapıldı ✅ 2026-07-05** — `desktop:dev`
  ile pencere açıldı, canlı akış çalıştı.
- [x] **"Living Interface" sahnesi** ✅ TAMAM ama TASARIM DEĞİŞTİ (2026-07-08, Dilim 7/8/8b):
  ilk parçacık küresi (fibonacci sphere) kullanıcı geri bildirimiyle ("çok basit") EMEKLİ
  edildi, yerine **Yaşayan Tesseract** geldi — 3 kademeli 4B hiperküp (bakır dış=GPU,
  cyan iç=LLM/mood, violet derin çekirdek kafesi), gerçek bloom (UnrealBloomPass), GLSL akış
  shader'ı, atım sistemi (synapse/energy/converge), sinematik kamera. `ui/src/scene/
  TesseractScene.tsx` + `scene/tesseract/{geometry,pulses}.ts` (saf+testli). Görsel dil artık
  `docs/TASARIM.md §2`'de tesseract olarak güncel. **"Yaşam formu" ✅ 2026-07-10:** her aktif
  koşu artık tesseract'ın etrafında kendi yörüngeli uydusuyla temsil ediliyor — mood rengi
  (thinking=cyan/executing=magenta/awaiting=amber), doğuş/ölüm (patla-sön) animasyonu, çocuk
  koşular (ADR-014 devretme) daha küçük render edilir. `scene/tesseract/satellites.ts` (saf+testli).
- [x] **Şef Paneli:** aktif agent'lar + canlı log akışı ✅ · izin istekleri masaüstünden
  CEVAPLANABİLİYOR ✅ (dilim 2, kart + renkli diff + Evet/Bu koşu/Daima/Hayır, SPEC §5) ·
  çocuk koşular (Faz 5, `run_agent`) ebeveyninin altında girintili görünüyor ✅ (2026-07-10,
  O3, `orderRunsForDisplay`) · "hangi dosya" zengin görünümü ✅ (2026-07-10, `RunFile`, diff
  izin kartı kapansa da kalıcı, `read_file` sonuç önizlemesi).
- [x] Model panosu ✅ TAMAM (2026-07-05 temel + 2026-07-07 Dilim 6 API kapasitesi) — provider
  durumları (canlı up/down/degraded), token kullanımı/maliyet sayaçları (`usage.updated`),
  prompt-cache isabet göstergesi, yerel GPU/VRAM vitalleri (`hardware.updated`,
  `scene/hardware-vitals.ts`), Anthropic rate-limit çubukları (`provider.limits`).
- [x] **Yol haritası görselleştirme:** ✅ 2026-07-10 (ADR-015 Karar 3/5, Dilim P2/P3) —
  `ROADMAP.md` sözleşmeli düz markdown olarak ayrıştırılır (`core/src/roadmap/parse.ts`,
  `GET /api/roadmap`), proje başlığı altında mütevazı PANEL (faz satırı + ilerleme çubuğu),
  interaktif graf DEĞİL (o, Faz 6 Bağlam Haritası'nın işi). "Hangi adımda hangi agent canlı"
  bağlaması bilinçle v2'ye ertelendi (ADR-015 Karar 4) — statik done/in_progress/todo yeterli
  sayıldı, canlı koşular zaten aynı proje başlığı altında görünüyor.
- [x] Proje görünümü: ✅ 2026-07-10 (ADR-015 Karar 1/2, Dilim P1) — hangi projede hangi agent
  ne yapıyor: "Aktif koşular" paneli koşunun `cwd`'sine göre gruplanır (kayıt defteri yok,
  ad = basename); geçmiş koşuların projeye göre dökümü bilinçle v2.
- [x] **CLI → masaüstü otomatik açılış:** ✅ 2026-07-10 — terminalde `symphony` başlatılınca
  masaüstü uygulaması da açılır (kurulu ve kapalıysa) — sistem tek komutla "canlanır".
  Yapılandırılabilir: `~/.symphony/config.json` → `desktop.autoLaunch` (varsayılan açık).
- [x] Terminal ⇄ masaüstü eş zamanlılık testi ✅ TAMAM — CLI'da başlayan iş masaüstünde anında
  görünüyor (dilim 1 kabul testi, kullanıcı doğruladı) · agent akış metni paritesi (dilim 2.1b,
  `agent.delta`→`runStreams`) · Faz 5 çocuk koşu hiyerarşisi de aynı anda iki yüzeyde tutarlı
  (O2 CLI/TUI + O3 masaüstü, aynı `parentRunId` alanından besleniyor).
- **Çıktı:** Terminalde agent çalıştırırken masaüstünde canlı izlediğin, yaşayan dashboard. ✅
  (tesseract + model panosu + izin kartları + çocuk-koşu hiyerarşisiyle birlikte gerçekleşti)
- **Kabul testi:** CLI'da başlatılan koşu 1 saniye içinde masaüstünde görünüyor ✅ · tesseract
  agent durumlarına (thinking/executing/failed) görsel tepki veriyor ✅ (Living Interface,
  görsel doğrulama kullanıcıya) · token/maliyet sayaçları gerçek kullanım verisiyle artıyor ✅
  (model panosu) · izin istekleri masaüstünden de cevaplanabiliyor ✅ (dilim 2) · proje
  gruplaması + roadmap paneli birim testleriyle kanıtlı (P1/P2/P3, 315 test) — **canlı görsel
  doğrulama (P1/P2/P3'ün `desktop:dev`'de gerçek proje/ROADMAP.md ile görülmesi) KULLANICIYA
  kalıyor**, Bash'ten görülemez.

### Sıradaki dilimler — kullanıcı önceliği (2026-07-07, ANLAŞILAN SIRA: 1→2→3→4)

> Kullanıcı geri bildiriminden doğdu (sohbet/agent ayrımı sürtünmesi + hafıza yokluğu). Her biri
> ayrı dikey dilim; bittiğinde `memo/DURUM.md` güncellenir. Fazlara dağılır ama sıra bu.

1. ✅ **Oturum sürekliliği** (2026-07-08, worktree; 2026-07-09 main'e merge) — TUI "önceki sohbete
   devam et": `DaemonClient.listSessions/sessionDetail` (REST) + `ChatFlow` + `resume-picker.tsx` +
   `chat.tsx` prop tohumu. Sıfır protokol/daemon değişikliği (REPLACE semantiği yetti). v2 adayları
   DURUM.md'de (tam oturum tarayıcısı, model-değişince-devam).
2. ✅ **Birleşik sohbet-agent modu BİTTİ** (2026-07-09) — ADR-012: 2.1 akış (streamText+`agent.delta`) ·
   2.1b masaüstü paritesi · 2.2 çok-tur (`awaiting_user`+`agent.say`+`conversational`) · 2.3a birleşik
   giriş (`PersonaPicker` + salt-okur asistan agent'ı; ModePicker/AgentPicker silindi) · 2.3b konuşma
   kalıcılığı (konuşmalı agent koşuları sessions/messages'a yazar, `agent.start.sessionId` resume) ·
   2.3c TUI agent-resume (`AgentFlow`). Canlı doğrulandı. Opsiyonel kırıntı: "Sohbet"i de agent'a taşı.
3. **Uzun-dönem hafıza (= aşağıdaki Faz 6 "Kullanıcı hafızası")** — `~/.symphony/memory/` kalıcı
   profil, her oturumda bağlama enjekte. Kapsam kararı Faz 6'da (agent kendi yazamaz).
   **→ TASARIM TAMAM (2026-07-09, ADR-013):** (a) profil ile başlanıyor, (b) RAG Bağlam
   Haritası'na ertelendi, (c) LoRA süresiz; dilimler M1/M2/M3 `memo/DURUM.md`'de, uygulama Sonnet'te.
   **+ Konuşma arşivinden kişiselleşme (kullanıcı isteği 2026-07-07):** kullanıcı tüm geçmiş Claude
   sohbetlerini arşivledi; yerel LLM'in kullanıcıyı tanıyıp *tarzını benimsemesi* isteniyor. FİZİBIL,
   3 katman (artan maliyet, önerilen sıra a→b→c):
   - **(a) Stil/tercih profili** — arşivden damıtılmış kompakt profil → system prompt'a enjekte.
     En ucuz, kontrollü, hemen; "tarz benimseme" için ilk hamle. (Faz 6 memory ile aynı boru.)
   - **(b) RAG** — arşiv embedding'lenir; sorguda ilgili geçmiş bağlama çekilir (Faz 6 "Bağlam
     Haritası" ile örtüşür). "Beni hatırla / geçmişe atıfla" için.
   - **(c) LoRA ince-ayar** — arşivle qwen'e LoRA eğitimi → tarz ağırlıklara işlenir; Ollama'ya
     Modelfile/GGUF ile içe aktarılır. En güçlü ama en ağır (veri hazırlığı + eğitim); RTX 4060
     8GB'da küçük modelde mümkün. Profil+RAG yetmezse.
4. ✅ **Token güvenilirlik hatası** (2026-07-07) — `token.ts loadExistingToken`: daemon restart'ında
   diskteki geçerli 64-hex token yeniden kullanılır; masaüstü/CLI artık kopmuyor (+5 test).

### Faz 5 — Orkestrasyon: Çoklu Agent (12–14. hafta) ✅ 2026-07-10 (v1 kapsamı)
> **ADR-014** (2026-07-10): devretme = motor-içi dinamik `run_agent` aracı; hiyerarşi
> `parentRunId?` (ADDITIVE); derinlik-1 + `MAX_CHILD_RUNS=8` sigortaları; varsayılan "sef"
> agent'ı. Dilimler O1 (çekirdek devretme) → O2 ("sef" + CLI/TUI hiyerarşi) → O3 (masaüstü
> hiyerarşi) hepsi BİTTİ, testli (286 test) VE canlı doğrulandı (`symphony agent sef "..."` —
> Claude Haiku şefi, yerel qwen3:8b'ye devretti; biri başarısız oldu ama koşu düşmedi, şef
> kendi topladığı veriyle telafi etti — "araç hatası ≠ koşu hatası" tasarımının canlı kanıtı).
> Paralel çocuk + gerçek kapasite-kuyruğu bilinçle v2'ye ertelendi (ADR-014 "Ertelenenler").
- [x] Görev kuyruğu (devretme kısmı): birbirine iş devretme ✅ `run_agent` (O1) — eşzamanlı
  bağımsız üst-düzey koşular motor Map'inde zaten çalışıyordu (O1-f testi + canlı kanıtladı).
  Gerçek KAPASİTE kuyruğu (bekleyen iş listesi) ve PARALEL çocuk koşular v2'ye ertelendi.
- [x] Agent tanımları dosya olarak: `~/.symphony/agents/*.md` (rol + araçlar + model) → taşınabilir ✅ FİİLEN Faz 3'ten beri (frontmatter+`ensureDefaultAgent`)
- [x] "Şef" agent: görevi alt görevlere bölüp uygun agent'lara/modellere dağıtan üst akıl ✅ O2 — varsayılan `sef` agent'ı (`read_file/glob/grep/run_agent`, yazma yok)
- [x] Maliyet stratejisi: basit işleri yerel/ucuz modele, zor işleri Claude'a yönlendirme ✅ v1 = şef prompt'u + mevcut kural-tabanlı router (ADR-014 Karar 5); öğrenen router (v2) Faz 6'da
- **Çıktı:** Tek komutla çok-agent'lı iş akışı, dashboard'da orkestra gibi izlenir. ✅ masaüstünde çocuk koşular `↳` ile ebeveyninin altında girintili (O3, `orderRunsForDisplay`)
- **Kabul testi:** İki agent aynı anda farklı görevlerde koşup dashboard'da ayrı izlenebiliyor ✅ (O1-f + O3 store testleri) · şef agent bir görevi en az iki alt göreve bölüp farklı modellere dağıtıyor ✅ (O1-a testi + BUGÜNKÜ canlı `symphony agent sef` koşusu, Claude Haiku→qwen3:8b karışımı) · agent tanımı dosyası yeni makineye kopyalanınca aynen çalışıyor ✅ (Faz 3'ten beri, davranış değişmedi).

### Faz 6 — Zeka Katmanı: Seni Tanıyan Symphony (15–17. hafta) ✅ 2026-07-10 (ADR-016, dilimler Z1-Z5 tamamı)
- [x] **Model yönlendirici v2 (öğrenen):** Faz 1'den beri biriken kayıtlardan (hangi model hangi görevde başarılı/hızlı/ucuz oldu) skor tablosu; "bu işi kime verelim?" sorusuna veriyle cevap
      **✅ Dilim Z1 (2026-07-10):** sorgu-zamanı agregasyon (fiziksel tablo yok) + kural iskeleti/skor
      düzeltmesi karışımı (`router.ts`↔`stats.ts`), `MIN_SAMPLES=3` altında v1 birebir korunur.
- [x] Soru sorulduğunda otomatik öneri: "Bu görev için yerel Qwen yeterli (ücretsiz, ~3sn) — ama en yüksek kalite istersen Claude öneririm (~$0.04)" gibi şeffaf gerekçeli seçenek sunma
      **✅ Dilim Z1 kapsamında:** kanıt `reason` metninde — "son N koşuda %X başarı, ort. Ys/tur, $Z/koşu".
- [x] **Kullanıcı hafızası:** tercihlerini, kod stilini, sık kullandığın projeleri ve düzeltmelerini hatırlayan kalıcı profil (`~/.symphony/memory/`) — her agent bu bağlamla başlar.
      **✅ ADR-013 (M1-M3, 2026-07-09/10) ile ERKEN KARŞILANDI** — profil enjeksiyonu (chat+agent,
      tek kaynak), REST GET/PUT, `symphony memory show|path|distill`, damıtıcı agent. Kabul
      maddesi ("hafızaya yazılan tercih yeni oturumda agent bağlamında görülüyor") canlı
      doğrulandı. ADR-016 Karar 3: Faz 6'da yeni hafıza işi YOK; RAG ertelemesi aynen sürüyor.
      **Kapsam kararı (2026-07-05):** `~/.symphony/memory/profil.md` yalnız KULLANICI/asistan
      (Claude Code gibi bir yazma aracı üzerinden) tarafından yazılır; **agent'lar kendi
      başlarına bu dosyaya YAZAMAZ** — yalnız okur, sistem promptuna eklenir. Gerekçe: bir
      agent'ın kendi güvenini/bağlamını kendi genişletmesi riskli (yanlış/yanıltıcı bir
      "gerçek" yazarsa sonraki TÜM agent'ları etkiler). *(ADR-013 Karar 2 bunu uyguladı.)*
- [x] **Kendini geliştirme döngüsü:** haftalık kullanım özeti üzerinden sistemin kendi yönlendirme kurallarını ve agent tanımlarını güncelleme önerisi (onayınla uygulanır)
      **✅ Dilim Z3 (2026-07-10):** deterministik `symphony report` + eşik-tabanlı öneri cümleleri.
      **✅ Dilim D5 (2026-07-11, ADR-018 Karar 6):** ZAMANLANMIŞ üretim — rapor haftada bir
      kendiliğinden yazılır. **✅ Dilim D7 (2026-07-11, ADR-018 Karar 8):** agent TANIM-GÜNCELLEME
      önerisi — agent'ın KENDİ geçmiş koşularından (birden fazla model denenmişse, biri açıkça
      daha başarılıysa) model pinleme önerir; `symphony agent-oneri uygula <agentId>` onayla
      uygular. Canlı doğrulandı: gerçek kullanım geçmişinden İKİ gerçek öneri üretti (biri, bu
      oturumda ayrıca elle bulunan qwen2.5vl vision-model regresyonunu bağımsız olarak DOĞRULADI).
- [x] Geri bildirim sinyalleri: cevabı beğenme/düzeltme, agent çıktısını geri alma gibi olaylar skorlara işlenir
      **✅ Dilim Z2 (2026-07-10):** `feedback.submit` + TUI tek tuş + `symphony feedback`, router v2
      skorunu gerçekten etkiliyor (canlı doğrulandı). "Çıktıyı geri alma" sinyali BİLİNÇLE HARİÇ —
      geri-alma mekanizması yok, vekil sinyal yanıltıcı olurdu (ADR-016 Karar 4, reddedilen kısım).
- [x] **Bağlam Haritası (yaşayan bilgi grafiği):** kullanıcının konuşmaları/projeleri/geliştirmeleri
      zamanla *compound* eden, keşfedilebilir bir nöral graf olarak görünür (Obsidian graph benzeri,
      zamansal). Verisi çoğunlukla MEVCUT SQLite'ta (sessions/messages/agent_runs). Görsel yön:
      `docs/TASARIM.md §3` (kullanıcının referans görseli `Tasarım/`). Faz 4 dashboard + bu hafıza
      birleşince "seni tanıyan yaşayan arayüz" tamamlanır.
      **✅ Dilim Z4+Z5 (2026-07-10):** REST `GET /api/context-map` (deterministik kenarlar:
      proje/aynı-gün, embedding YOK) + masaüstünde AYRI sekme, d3-force ile 2D yerleşim, düğüm
      rengi=tür, tıkla→detay. Canlı doğrulandı — bu dilim ayrıca daemon'da eksik olan CORS
      desteğini de ortaya çıkarıp düzeltti (Canlı bulgu #4, `@fastify/cors`).
- **Çıktı:** "Şu PDF'leri özetleyecek bir şey lazım" dediğinde donanımına, geçmişine ve bütçene göre doğru modeli öneren; seni tanıdıkça isabeti artan sistem.
- **Kabul testi:** Router v2 önerileri gerçek kullanım skorlarına dayanıyor ve gerekçesini gösteriyor; kullanıcı hafızasına yazılan bir tercih yeni oturumda agent bağlamında görülüyor; haftalık rapor üretiliyor; tüm öğrenme verisi lokalde kalıyor (dışarı istek testle doğrulanmış şekilde yok).

### Faz 7 — Paketleme ve Taşınabilirlik (18–19. hafta) — ADR-017 (F1-F7 yazıldı/testli); kullanıcı-tetiklemeli adımlar kaldı
- [~] Tauri installer'ları: Windows x64/ARM64 (.msi), macOS Intel/Apple Silicon (.dmg) — Dilim
  F3: Windows x64 (NSIS) GERÇEKTEN kurulup `symphony`'nin otomatik bulup başlattığı canlı
  doğrulandı 2026-07-11; ARM64/macOS CI matrix'i (Dilim F6) yazıldı ama gerçek tag push'lanıp
  koşulmadı (Mac/ARM erişimi yok) — Windows Program Files (.msi, yönetici) yolu da doğrulanmadı
- [~] CLI dağıtımı: npm paketi + tek dosya binary seçeneği — Dilim F1: üç paket (shared/core/cli)
  yayın metadata'sıyla hazır, tek-dosya binary ADR-017 Karar 1'de REDDEDİLDİ (native modüller
  kırar); gerçek `npm publish` KULLANICININ npm login'ini bekliyor (Dilim F2, kısmen)
- [x] `symphony sync`: Dilim F4 — beyaz liste (config/providers/agents/memory/mcp-servers),
  gerçek git ile (ağ yok, yerel bare repo) uçtan uca test edildi; `daemon.token`/`data` asla
- [x] Otomatik güncelleme (sürümlü + tek komutla geri alınabilir; güncelleyici çekirdek ayrı ve
  dokunulmaz) — Dilim F5: `symphony update`/`rollback` + `POST /api/shutdown`, testli; gerçek
  registry'ye karşı kabul F2'nin npm yayınına bağımlı, henüz yapılmadı
- [x] **Mimari + kullanım PDF rehberi** — Dilim F7 (2026-07-11): `docs/REHBER.md` yazıldı,
  `pnpm docs:pdf` ile PDF üretimi çalışıyor, kullanıcıya görsel kontrol için gönderildi
- **Çıktı:** Kur → giriş yap → senkronla → devam et.
- **Kabul testi:** Windows installer temiz bir makinede kurulup çalışıyor ✅ (F3, NSIS);
  `symphony` komutu PATH'te ✅; `symphony sync` ikinci makinede ayarları ve agent tanımlarını
  geri getiriyor ✅ (F4, testle kanıtlı); güncelleme tek komutla geri alınabiliyor ✅ (F5,
  execa/versions.json testle kanıtlı — gerçek npm registry'ye karşı KULLANICI ile doğrulanacak).

### Faz 8 — Kendini Geliştiren Symphony ✅ TAMAMLANDI (2026-07-11) — ADR-018, dilimler D1-D6
> Symphony'nin kod agent'ı vardır; kendini geliştirmek = agent'ın hedef olarak **kendi reposunu** alması.
> Güvenliği dört sigorta sağlar: test paketi (Faz 0), hata telemetrisi (Faz 1), rollback (Faz 7), onay kapısı.

- [x] **Doktor agent:** hata telemetrisini periyodik okur, tekrarlayan hataları saptar, kök neden analizi yapar (D1/D2)
- [x] **Kendine yama döngüsü:** Doktor agent hatayı sandbox'ta (git worktree + izole süreç) yeniden üretir → düzeltme yazar → tüm test paketini çalıştırır → geçerse diff + test raporu ile onayına sunar (D2)
- [x] **Onaylı canlıya alma:** onayladığın yama sürüm olarak derlenir, daemon kendini yeniden başlatarak günceller; sorun çıkarsa watchdog otomatik bir önceki sürüme döner (D3 — kullanıcıyla canlı kanıtlandı: kasıtlı bozuk yama gerçekten geri alındı)
- [x] **Güven merdiveni:** yama kategorileri bazında sicil tutulur ("null hatası düzeltmeleri: 12/12 başarılı"); istediğin kategorilere "artık sormadan uygula" yetkisi verebilirsin — varsayılan her zaman "sor" (D4)
- [x] **Bekçi modu (senin projelerin için):** Symphony'de kayıtlı programlarının loglarını izler; hata veya crash görünce seni uyarır, `symphony doctor --proje` ile aynı boru hattını senin kodun için çalıştırır (D6)
- [x] **Kendini geliştirme raporu:** haftalık özet — hangi hatalar yakalandı, hangi yamalar uygulandı, kategori sicili; her hafta kendiliğinden de üretilir (D5)
- [x] Değişmezler (asla otomatikleşmez): güncelleyici çekirdek, izin sistemi, API anahtar yönetimi — bunlara dokunan her değişiklik her zaman insan onayı ister (D3/D4, `PROTECTED_PATHS`)
- **Çıktı:** Hatasını gören, yamasını yazan, test eden, onayınla kendini güncelleyen ve sicili büyüdükçe daha bağımsızlaşan sistem.
- **Kabul testi:** Kasıtlı enjekte edilen bir hatayı Doktor agent telemetriden saptayıp sandbox'ta yama + geçen test raporu üretiyor ✅; testleri geçmeyen yama canlıya çıkamıyor ✅; bozuk sürüm watchdog ile otomatik geri alınıyor ✅; değişmez bileşenlere (güncelleyici, izin sistemi, anahtar yönetimi) dokunan yama otomatik uygulanamıyor ✅. Üç senaryonun üçü de gerçek repo + gerçek daemon üzerinde D3'te canlı kanıtlandı (`memo/DURUM.md`).

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
