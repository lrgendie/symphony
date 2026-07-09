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

### Faz 2.5 — CLI Kimliği: Karşılama Ekranı (küçük dilim) ✅ 2026-07-03
- [x] `symphony` açılışında karşılama ekranı: marka logosu (ASCII/Unicode), sürüm + protokol,
  tarih, daemon/sağlayıcı durum özeti, toplam kullanım (SQLite'tan), kısayol ipuçları —
  Claude Code'un oturum başlangıcı karşılaması gibi ✅ 2026-07-03 (`tui/welcome.tsx`, testli)
- [x] Logo tek modülde yaşar (`packages/cli/src/tui/logo.ts`): kullanıcının kendi logosu
  gelince yalnız o dosya değişir; renk paleti markayla uyumlu ✅ 2026-07-03
- **Çıktı:** `symphony` yazınca sistem "merhaba" diyor — kimliği olan bir açılış.
- **Kabul testi:** Karşılama ekranı logo + tarih + gerçek sağlayıcı durumu + gerçek kullanım
  toplamını gösteriyor; model seçici akışı bozulmuyor; bileşen testli.

### Faz 3 — Kod Agent'ı: Sisteme Müdahale (6–8. hafta) ⭐ kalbi burası
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

### Faz 4 — Masaüstü: Orkestra Sahnesi (9–11. hafta) — dilim 1 başladı (2026-07-05)
- [x] Tauri 2 + React dashboard, daemon'un WS akışına bağlanır ✅ 2026-07-05 (dilim 1) —
  `packages/ui` (React 19 + Vite 8, tarayıcı-güvenli WS istemcisi, yalnız `shared`'a bağımlı)
  + `packages/desktop` (Tauri 2, `ui/dist`'i sarar, token'ı `~/.symphony/daemon.token`'dan
  okuyup webview'e enjekte eder). cargo build ✅, wire-protokol smoke testi ✅ (daemon
  `client:"desktop"` bağlantısını kabul edip snapshot döndü), store birim testleri ✅ (6).
  **Pencere görsel doğrulaması KULLANICI tarafından yapıldı ✅ 2026-07-05** — `desktop:dev`
  ile pencere açıldı, canlı akış çalıştı.
- [~] **"Living Interface" sahnesi:** Three.js parçacık küresi merkezde — boşta yavaşça nefes alır, agent düşünürken dalgalanır, araç çalıştırırken hızlanır, hatada renk değiştirir. **Parçacık küresi YAPILDI ✅ 2026-07-05** (`@react-three/fiber`, `ui/src/scene/LivingScene.tsx`): fibonacci küre, durum→mood (`scene/mood.ts`, saf+testli: idle/thinking/executing/awaiting/error/offline), renk lerp + nefes + dönüş, HUD mood etiketi. Görsel doğrulama kullanıcıya. Kalan: her agent'ın kendi "yaşam formu", tesseract'ın canlı mimari haritasına dönüşmesi. Görsel yön: `docs/TASARIM.md`.
- [~] **Şef Paneli:** aktif agent'lar (kim çalışıyor, hangi araç, hangi dosya), canlı log akışı —
  dilim 1: aktif koşular + canlı olay akışı; **dilim 2 (2026-07-05): izin istekleri masaüstünden
  CEVAPLANABİLİYOR** (kart + renkli diff + Evet/Bu koşu/Daima/Hayır → `permission.respond`,
  ilk cevap kazanır, SPEC §5). "hangi dosya" zengin görünümü sonraki dilim
- [~] Model panosu: provider durumları ✅ (canlı up/down/degraded), token kullanımı/maliyet
  sayaçları + yerel model VRAM durumu — sonraki dilim
- [ ] **Yol haritası görselleştirme:** projelerin ROADMAP/plan dosyalarından otomatik üretilen interaktif faz-adım grafiği; hangi adım bitti, hangi adımda hangi agent çalışıyor canlı görünür
- [ ] Proje görünümü: hangi projede hangi agent ne yapıyor
- [ ] **CLI → masaüstü otomatik açılış:** terminalde `symphony` başlatılınca masaüstü
  uygulaması da açılır (kurulu ve kapalıysa) — sistem tek komutla "canlanır".
  Yapılandırılabilir: `~/.symphony/config.json` → `desktop.autoLaunch` (varsayılan açık)
- [ ] Terminal ⇄ masaüstü eş zamanlılık testi: CLI'da başlayan iş anında ekranda
- **Çıktı:** Terminalde agent çalıştırırken masaüstünde canlı izlediğin, yaşayan dashboard.
- **Kabul testi:** CLI'da başlatılan koşu 1 saniye içinde masaüstünde görünüyor ✅ (dilim 1,
  kullanıcı doğruladı); küre agent durumlarına (thinking/executing/failed) görsel tepki veriyor
  (Living Interface — bekliyor); token/maliyet sayaçları gerçek kullanım verisiyle artıyor
  (model panosu — bekliyor); izin istekleri masaüstünden de cevaplanabiliyor ✅ (dilim 2, kod +
  store testleri; buton tıklama görsel doğrulaması kullanıcıya kaldı).

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
- [ ] **Kullanıcı hafızası:** tercihlerini, kod stilini, sık kullandığın projeleri ve düzeltmelerini hatırlayan kalıcı profil (`~/.symphony/memory/`) — her agent bu bağlamla başlar.
      **Kapsam kararı (2026-07-05):** `~/.symphony/memory/profil.md` yalnız KULLANICI/asistan
      (Claude Code gibi bir yazma aracı üzerinden) tarafından yazılır; **agent'lar kendi
      başlarına bu dosyaya YAZAMAZ** — yalnız okur, sistem promptuna eklenir. Gerekçe: bir
      agent'ın kendi güvenini/bağlamını kendi genişletmesi riskli (yanlış/yanıltıcı bir
      "gerçek" yazarsa sonraki TÜM agent'ları etkiler); bu zaten Faz 6'nın kendi notuyla
      uyumlu ("kendi güncelleme onayınla uygulanır"). Şimdilik YAPILMADI — vakti gelince
      (bu faza sıra gelince) yapılacak; bu not sırf kapsam kararını kaybetmemek için düşüldü.
- [ ] **Kendini geliştirme döngüsü:** haftalık kullanım özeti üzerinden sistemin kendi yönlendirme kurallarını ve agent tanımlarını güncelleme önerisi (onayınla uygulanır)
- [ ] Geri bildirim sinyalleri: cevabı beğenme/düzeltme, agent çıktısını geri alma gibi olaylar skorlara işlenir
- [ ] **Bağlam Haritası (yaşayan bilgi grafiği):** kullanıcının konuşmaları/projeleri/geliştirmeleri
      zamanla *compound* eden, keşfedilebilir bir nöral graf olarak görünür (Obsidian graph benzeri,
      zamansal). Verisi çoğunlukla MEVCUT SQLite'ta (sessions/messages/agent_runs). Görsel yön:
      `docs/TASARIM.md §3` (kullanıcının referans görseli `Tasarım/`). Faz 4 dashboard + bu hafıza
      birleşince "seni tanıyan yaşayan arayüz" tamamlanır. Ayrı büyük dilim (protokol eki gerekebilir).
- **Çıktı:** "Şu PDF'leri özetleyecek bir şey lazım" dediğinde donanımına, geçmişine ve bütçene göre doğru modeli öneren; seni tanıdıkça isabeti artan sistem.
- **Kabul testi:** Router v2 önerileri gerçek kullanım skorlarına dayanıyor ve gerekçesini gösteriyor; kullanıcı hafızasına yazılan bir tercih yeni oturumda agent bağlamında görülüyor; haftalık rapor üretiliyor; tüm öğrenme verisi lokalde kalıyor (dışarı istek testle doğrulanmış şekilde yok).

### Faz 7 — Paketleme ve Taşınabilirlik (18–19. hafta)
- [ ] Tauri installer'ları: Windows x64/ARM64 (.msi), macOS Intel/Apple Silicon (.dmg)
- [ ] CLI dağıtımı: npm paketi + tek dosya binary seçeneği
- [ ] `symphony sync`: `~/.symphony/` klasörünü özel git deposuyla eşitleme (yeni makinede 2 dakikada kurulum)
- [ ] Otomatik güncelleme (sürümlü + tek komutla geri alınabilir; güncelleyici çekirdek ayrı ve dokunulmaz)
- [ ] **Mimari + kullanım PDF rehberi:** sistemin ne yaptığı, mimari şema, kod haritası
  (hangi paket/dosya ne işe yarar), araçlar/agent'lar/skill'ler ve kodda nerede tanımlı
  oldukları, protokol özeti, komut başvurusu. Kaynak markdown (`docs/REHBER.md`) olarak
  yazılır — sistem geliştikçe güncellenir — ve PDF'e derlenir. Tüm sistem tamamlanınca
  teslim edilir; iskeleti Faz 4 sonunda çıkarılır ki belge kodla birlikte büyüsün
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
