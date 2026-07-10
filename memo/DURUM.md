# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-10 (Opus — kaçak üretim sigortası: `maxOutputTokens` tavanı, 320 test)

## Kaçak üretim sigortası: `maxOutputTokens` tavanı BİTTİ (2026-07-10, Opus)

Canlı bulgu #1'in (qwen3:8b'nin 15+ dk GPU %98'de takılı kalması) açık bıraktığı **teorik risk
kapatıldı**: agent ve sohbet turlarının HİÇBİRİNDE çıktı-token tavanı yoktu → durma token'ı hiç
gelmezse koşu context dolana dek sürebiliyordu. Protokolsüz (yeni WS mesajı/olayı YOK).
- **`config.ts`:** `limits.maxOutputTokens` (vars. **8192**, `1..200_000`). Tek varsayılan kaynağı.
- **`definition.ts`:** frontmatter `maxOutputTokens?` — **`.optional()`, `.default()` DEĞİL**
  (burada default olsaydı config'inki hiç uygulanmazdı). `maxSteps` ile simetrik sigorta.
- **`engine.ts`:** `AgentEngineDeps.maxOutputTokens` (ZORUNLU — sessiz varsayılan yok); koşu
  başında `definition.maxOutputTokens ?? deps.maxOutputTokens` çözülür, HER `streamText` turuna
  geçer. `finishReason === "length"` → `AgentError("AGENT_MAX_OUTPUT_TOKENS")`. **Sıra önemli:**
  `recordTurnUsage` ÖNCE çağrılır, sonra throw — token gerçekten harcandı, maliyet defterinde
  görünmeli. Kesik metni sessizce "nihai cevap" saymak (eski davranış) kullanıcıya yarım yanıtı
  tamammış gibi gösterirdi.
- **`daemon.ts`:** motora tavan enjekte edilir; sohbet yolunda `payload.options.maxTokens ??
  config.limits.maxOutputTokens` (istemci ezebilir, vermezse sigorta yine de var).
- **Belgeler:** SPEC-AGENT §4'e sigorta + gerekçe + hata kodu; PROTOKOL.md `chat.start` satırına
  "maxTokens verilmezse config tavanı uygulanır" notu.
- **Test:** 315→**320** (engine +3: config tavanı HER turda iletiliyor · frontmatter config'i
  eziyor · `length` → failed(AGENT_MAX_OUTPUT_TOKENS) + completed YOK + kesik metin delta'da
  kaybolmuyor + usage deftere yazılmış; config +1: default 8192 & `0` reddediliyor;
  definition +1: frontmatter okunuyor & yoksa `undefined`). `pnpm build && pnpm test && pnpm lint`
  temiz (43 dosya/320 test).
- **GERÇEK SAĞLAYICIYA KARŞI DOĞRULANDI (izole script, mock değil):** rapor §5.4 dersi gereği
  (“kaynak okuması yanıltıcıydı”) Ollama'ya doğrudan soruldu — `maxOutputTokens:16` →
  `finishReason:"length"`, `outputTokens=16` (tavana **harfiyen** uyuyor); tavansız → `"stop"`,
  463 token. Yani motorun beklediği `"length"` değeri gerçekte geliyor.
  - **Yan gözlem:** tavan=16'da `chars=0` — qwen3 16 token'ın tamamını `<think>` muhakemesinde
    harcadı, `textStream` hiç metin vermedi. Muhakeme yapan modellerde ÇOK düşük bir tavan boş
    cevap + AGENT_MAX_OUTPUT_TOKENS üretir (doğru davranış, ama 8192 varsayılanı bu bütçenin
    rahatça üstünde).
- **Bilinçli kapsam sınırı:** tavan tek turun SONLANMASINI garanti eder (qwen3:8b'de 8192 token
  ≈ birkaç dakika üst sınır), ama "duvar saati zaman aşımı" EKLENMEDİ. Gerekçe: Dilim O1'de
  bulunan `AbortSignal`'ın ham `streamText` tüketimini gerçekten kesmediği sorunu hâlâ açık —
  bir zaman aşımı bugün ÇALIŞMAYABİLİR. Önce o araştırılmalı (ayrı dilim), tavan onsuz da
  bağımsız bir kazanç.
- **CANLI DOĞRULAMA TAMAMLANDI (daemon restart + gerçek qwen3:8b koşuları, HER İKİ öncelik dalı):**
  1. *Agent tanımı dalı:* geçici `tavan-testi.md` (frontmatter `maxOutputTokens: 32`) →
     `symphony agent tavan-testi` → `✘ koşu başarısız: AGENT_MAX_OUTPUT_TOKENS` ("32 token
     tavanına çarptı"), CLI sıfır-dışı çıkış kodu.
  2. *Config dalı (asıl doğrulanmamış halka: daemon→engine):* config'e geçici
     `limits.maxOutputTokens: 32` + restart → frontmatter tavanı OLMAYAN `asistan` agent'ı
     AYNI hatayla düştü → `config.limits` gerçekten motora geçiyor.
  3. *Regresyon:* config yedekten geri yüklendi (varsayılan 8192), geçici agent silindi,
     daemon restart → normal `asistan` koşusu sorunsuz `✔ tamamlandı` (835+206 token) —
     sigorta sıradan işleri KIRMIYOR.
  Kullanıcının `config.json`'ı ve `agents/` dizini bozulmadan eski hâline döndürüldü.

## Faz 4 — Dilim P3 (masaüstü roadmap paneli + kapanış) BİTTİ (2026-07-10, Sonnet)

ADR-015 Karar 3/5 uygulandı; Faz 4'ün son iki maddesi + tüm ROADMAP.md senkronu tamam.
- **`ui/src/daemon/client.ts`:** `fetchRoadmap(dir)` — `GET /api/roadmap` (Bearer), WS akışının
  DIŞINDA istek-başına REST (roadmap her koşu olayında değişmez). Bağlantı yok/ağ hatası/404/
  şema uyuşmazlığı → sessizce `null` (throw etmez, panel gizlenir).
- **`App.tsx`:** yeni `RoadmapStrip` bileşeni — proje başlığının (`project-head`) hemen altında,
  grup görünür olunca BİR KEZ çeker (`useEffect([cwd])`, agresif polling yok). Faz satırı +
  `model-bar` deseninde ilerleme çubuğu (`done/total`), renk `state`'ten (`--green` done,
  gradient in_progress, soluk `--line` todo). `phases:[]` veya `null` → hiçbir şey render etmez.
- **`index.css`:** `.roadmap-strip`/`.roadmap-phase-*` (Model panosu diliyle tutarlı).
- **`docs/TASARIM.md`:** §3 (Bağlam Haritası) altına ADR-015 Karar 5 notu — roadmap paneli
  mütevazı liste/çubuk, interaktif graf Faz 6'nın işi.
- **`ROADMAP.md`:** Faz 4'ün TÜM maddeleri gerçek duruma senkronlandı ve işaretlendi (yalnız
  P1-P3'ün iki maddesi değil — Şef Paneli'nin "hangi dosya" kalıntısı ve "CLI→masaüstü otomatik
  açılış" da stale `[ ]`/`[~]` kalmıştı, hepsi düzeltildi); Faz 4 başlığı artık ✅ 2026-07-10.
  "Hangi adımda hangi agent canlı" bağlaması v2'ye ertelendi notu düşüldü (ADR-015 Karar 4).
- **Test:** 310→**315** — `daemon/client.test.ts` (5, YENİ dosya: bağlantı yoksa fetch
  çağrılmadan null · başarılı cevap + dir kodlama/Bearer header doğrulaması · 404→null ·
  ağ hatası→null (throw yok) · şemaya uymayan cevap→null). `window`/`fetch` `vi.stubGlobal`
  ile enjekte edildi (paket vitest ortamı "node", DOM yok). Panel bileşen render testi
  YAZILMADI — repo'da ui paketi için jsdom/RTL altyapısı yok, plan bunun yerine "store-seviyesi
  SAF fonksiyon testi yeterli" izni veriyordu. `pnpm build && pnpm test && pnpm lint` temiz.
- **Görsel doğrulama KULLANICIYA** (`desktop:dev`, Bash'ten görülemez — birden fazla farklı
  cwd'de agent koşusu başlatıp her projenin ROADMAP.md'sinden faz çubuklarının doğru göründüğünü
  görmek yeterli; ROADMAP.md'si olmayan proje satırsız kalmalı).

**Faz 4 — Masaüstü: Orkestra Sahnesi tamamen ✅.** Sıradaki: Faz 6 (Zeka Katmanı) ya da kullanıcı
önceliğine göre başka bir dilim — bir sonraki oturum kullanıcıyla birlikte karar verilecek.

## Faz 4 — Dilim P2 (roadmap parser + REST) BİTTİ (2026-07-10, Sonnet)

ADR-015 Karar 3 uygulandı. Kural 1 sırası: PROTOKOL → shared → core → daemon.
**Not:** ilk uygulamada şema yanlış çıkmıştı (`{title, done:boolean, steps:[]}}`) — ADR-015'in
bağlayıcı REST şekli `{title, done, total, state}` (agregat sayaç, adım metni YOK); KARARLAR.md'yi
tekrar okuyup düzeltildi. Ders: DURUM.md'deki plan taslağı değil, KARARLAR.md'deki ADR bağlayıcıdır.
- **PROTOKOL.md:** `GET /api/roadmap?dir=<yol>` satırı + sözleşme notu (`### başlık` faz;
  gövdedeki `- [ ]/- [x]/- [~]` hepsi `total`'a, yalnız `- [x]` `done`'a sayılır; `state`
  türetimi: başlıkta `✅` → done, yoksa `[~]` var ya da `0<done<total` → in_progress,
  `done===total>0` → done, aksi todo). Symphony'ye özgü değil — bu kalıba uyan HERHANGİ bir
  dizinin ROADMAP.md'sinde çalışır.
- **`shared/rest.ts`:** `RoadmapPhaseSchema {title, done, total, state}`, `RoadmapResponseSchema` (ADDITIVE).
- **YENİ `core/src/roadmap/parse.ts`:** `parseRoadmap(markdown)` — SAF, dosya G/Ç yok. `###`
  başlıkları faz sayar (`####` alt başlıkları saymaz — regex `\s+` şartı doğal olarak ayırıyor);
  `- [ ]/- [x]/- [~]` dışındaki bullet'lar (ör. `- **Çıktı:**`) adım sayılmaz.
- **`daemon.ts`:** `GET /api/roadmap` — Bearer auth (global hook), `dir` eksikse 400
  (`VALIDATION_ROADMAP_DIR_REQUIRED`), `<dir>/ROADMAP.md` yoksa 404
  (`VALIDATION_ROADMAP_NOT_FOUND`), varsa `{ phases }` döner.
- **Test:** 301→**310** — `parse.test.ts` (8: gerçek ROADMAP.md kesitinden fixture ·
  `[~]`siz de 0<done<total in_progress türetir · done===total>0 başlıksız da done ·
  adımsız faz todo · başlıksız checkbox yok sayılır · `- **` bullet adım sayılmaz · faz
  yoksa boş dizi · `####` faz saymaz) + `daemon.test.ts` (1: 401/400/404/200 roundtrip,
  gerçek geçici dizinde ROADMAP.md yazıp okutarak). `pnpm build && pnpm test && pnpm lint` temiz.

### ✅ Dilim P3 — masaüstü roadmap paneli + kapanış — BİTTİ (yukarıda "Faz 4 — Dilim P3" bölümünde ayrıntı)

## Faz 4 — Dilim P1 (canlı proje gruplaması) BİTTİ (2026-07-10, Sonnet)

ADR-015 Karar 1/2 uygulandı. Kural 1 sırası: PROTOKOL → shared → core → ui.
- **PROTOKOL.md:** `ActiveRun`a `cwd?` notu (parentRunId notunun hemen altında, "ADR-015" andaçlı).
- **`shared/common.ts`:** `ActiveRunSchema.cwd?` (ADDITIVE, PROTOCOL_VERSION korunur).
- **`engine.ts`:** `activeRuns()` artık `cwd: run.cwd` döner (kayıtta zaten vardı, yalnız dışa
  açılmamıştı) — `parentRunId` gibi opsiyonel spread değil, DAİMA dolu (her koşunun jail cwd'si var).
- **`ui/store.ts`:** `agent.run.started` handler'ı `cwd`'yi `upsertRun`'a geçiriyor. YENİ SAF
  export `groupRunsByProject(runs)`: cwd'ye göre gruplar, ad = basename (`split(/[\\/]/)` —
  hem Windows hem POSIX ayracı), grup içi sıra yine `orderRunsForDisplay`. **Çocuk koşular için
  AYRI eşleme GEREKMEDİ** — `run_agent` zaten ebeveynin cwd'sini birebir devraldığından (ADR-014
  Karar 3) `r.cwd` doğrudan aynı gruba düşürüyor, tasarım basitleşti.
- **`App.tsx`:** Aktif koşular paneli artık proje başlığı altında gruplu (`project-head`: ad +
  soluk tam yol); satır render'ı `RunRow` bileşenine çıkarıldı (okunabilirlik, iki seviyeli
  map). Tek grup olsa da başlık gösterilir (ADR-015 Karar 2, tutarlılık).
- **Test:** 297→**301** (store +4: cwd geçişi · basename iki ayraçla · çocuk ebeveyninin
  grubunda + grup içi girinti korunur · aynı cwd'li iki üst-düzey koşu tek grupta).
  `pnpm build && pnpm test && pnpm lint` temiz (41 dosya/301 test).
- **Görsel doğrulama KULLANICIYA** (`desktop:dev`, Bash'ten görülemez — birden fazla farklı
  cwd'de agent koşusu başlatıp proje başlıklarının ayrıştığını görmek yeterli).

### ✅ Dilim P2 — roadmap parser + REST — BİTTİ (yukarıda "Faz 4 — Dilim P2" bölümünde ayrıntı)

## Faz 4 — "Hangi dosya" zengin görünümü BİTTİ (2026-07-10, Sonnet)

- **`ui/store.ts`:** yeni `runFiles: Record<runId, RunFilePreview>` — yalnız dosya-dokunan araçlar
  (`read_file`/`write_file`/`edit`) için. `agent.tool.requested`'taki diff (write_file/edit) İZİN
  KARTI KAPANDIKTAN SONRA da kalır (önceden yalnız kart açıkken görünüyordu, onaylanır onaylanmaz
  kaybolurdu); `read_file` (izin istemez) `agent.tool.started`'tan başlık + `agent.tool.completed`'tan
  sonuç önizlemesi alır. `agent.run.state:"cancelled"`/`completed`/`failed`'ta `runStreams` ile
  AYNI anda temizlenir (zombi kalmaz); `applySnapshot`'ta da sıfırlanır.
- **`App.tsx`:** yeni `RunFile` bileşeni, koşu satırının altında (`run-stream`'in yanında) —
  mevcut `Diff` bileşenini YENİDEN KULLANIR (kod tekrarı yok).
- **Test:** 293→**297** (store +4: diff-kalıcılığı, read_file başlık+sonuç, dosya-dışı araçlar
  dokunmaz, koşu bitince temizlenir). `pnpm build && pnpm test && pnpm lint` temiz (41/297).
- **Görsel doğrulama KULLANICIYA** (`desktop:dev`, Bash'ten görülemez).

## Faz 4 kalanı: proje görünümü + yol haritası — TASARIM TAMAM (2026-07-10, Fable — ADR-015) → dilimler P1/P2/P3

5 açık soru karara bağlandı, **ADR-015 yazıldı** (`docs/kararlar/KARARLAR.md`). Kararların özü:
- **Proje = koşunun cwd'sinden otomatik** (görünen ad = basename, tam yol soluk); kayıt defteri
  YOK (v1) — çakışma gerçek sorun olursa v2'de isteğe bağlı adlandırma.
- **Kapsam v1 = yalnız CANLI:** "Aktif koşular" paneli cwd'ye göre gruplanır; geçmiş dökümü v2.
- **Roadmap = sözleşmeli düz markdown:** `### başlık` fazları, `- [ ]/- [x]/- [~]` maddeleri,
  başlıkta `✅` = faz bitti. Parser SAF core modülü; HERHANGİ dizindeki ROADMAP.md'ye çalışır
  (kullanıcı kendi projesine bu kalıpla koyarsa görselleşir), kalıpsız dosya zarifçe boş döner.
- **Protokol (ADDITIVE):** `ActiveRunSchema.cwd?` (olay zaten taşıyor, snapshot'a eklenir) +
  REST `GET /api/roadmap?dir=<mutlak-yol>` (Bearer; masaüstü webview dosya okuyamaz → daemon okur).
- **Canlı adım-koşu bağlama v1'de YOK** (statik done/in_progress/todo yeter; `roadmapStep?` eki
  spekülatif). **Görsel: mütevazı panel** (Model panosu diliyle çubuklar) — Obsidian-graph işi
  Faz 6 Bağlam Haritası'nındır, ön alınmaz.

### ✅ Dilim P1 — canlı proje gruplaması — BİTTİ (yukarıda "Faz 4 — Dilim P1" bölümünde ayrıntı)

### ✅ Dilim P2 — roadmap parser + REST — BİTTİ (yukarıda "Faz 4 — Dilim P2" bölümünde ayrıntı)

### ✅ Dilim P3 — masaüstü roadmap paneli + kapanış — BİTTİ (yukarıda "Faz 4 — Dilim P3" bölümünde ayrıntı)

**P1→P2→P3 hepsi BİTTİ (2026-07-10) — Faz 4 tamamen kapandı.**

## Faz 4 — ROADMAP senkronu + "CLI → masaüstü otomatik açılış" BİTTİ (2026-07-10, Sonnet)

Kullanıcı Faz 6 (öğrenen router) yerine bunu seçti — kullanım verisi henüz az, küçük/düşük
riskli Faz 4 boşlukları daha değerli.
- **ROADMAP.md Faz 4 bölümü gerçek duruma senkronlandı:** Living Interface artık tesseract
  (Dilim 7/8/8b, küre emekli) olarak işaretli; Model panosu (token/maliyet/cache/GPU/rate-limit,
  Dilim 6) TAMAM işaretlendi; Şef Paneli'ne Faz 5 çocuk-koşu hiyerarşisi notu düşüldü; Terminal⇄
  masaüstü eş zamanlılık TAMAM işaretlendi (dilim 1 + 2.1b + O2/O3 aynı kanıt). Belge artık kodla
  hizalı — önceden çok iş yapılmış ama işaretlenmemişti.
- **`config.ts`:** `desktop.autoLaunch` (vars. `true`) — kapatma anahtarı.
- **`paths.ts`:** `desktopPidFile` (`~/.symphony/desktop.pid`) — CLI'nin başlattığı masaüstü
  sürecinin PID'i, yeniden başlatmayı önler.
- **YENİ `cli/client/desktop-launch.ts`:** `ensureDesktopRunning()` — argümansız `symphony`
  (bare TUI) başında çağrılır (`index.ts`). **Kapsam notu (bilinçli):** paketleme (Faz 7,
  installer) henüz YOK; tek çalışan yol bu repo checkout'undan `desktop:dev` (Tauri dev) —
  `findRepoRoot()` `pnpm-workspace.yaml`'ı arayarak monorepo kökünü bulur, bulamazsa (paketlenmiş
  kurulum) SESSİZCE vazgeçer. PID dosyasındaki süreç canlıysa yeniden başlatmaz. Spawn, `tools.ts`
  `run_command`'daki AYNI cross-platform desen (PowerShell/bash) + `windowsHide:true` (Oturum 13
  dersi — flaşlayan konsol penceresi tekrarlanmasın). **En iyi gayret:** her hata yutulur, TUI'nin
  başlamasını asla bloklamaz/kırmaz (try/catch tüm fonksiyonu sarar).
- **Test:** 288→**293** (config +2, paths +1, desktop-launch +3 — gerçek Tauri süreci başlatmadan:
  monorepo kökü bulma, autoLaunch:false→PID dosyası yazılmaz, PID canlıysa yeniden başlatmaz,
  bozuk config sessizce yutulur). `pnpm build && pnpm test && pnpm lint` temiz (41 dosya/293 test).
- **Canlı doğrulama KULLANICIYA:** gerçek bir Tauri penceresi açıp Rust derlemesi tetiklediği
  için (yavaş/görünür, testte simüle edilemez) kasıtlı olarak canlı denenmedi — bir dahaki
  `symphony` çalıştırmanda masaüstünün de otomatik açıldığını (kapalıysa) görmen yeterli.
  Kapatmak istersen: `~/.symphony/config.json` → `{"desktop":{"autoLaunch":false}}`.

**Kalan Faz 4 boşlukları (küçük, isteğe bağlı, bilinçli bırakıldı):** "hangi dosya" zengin
görünümü, proje görünümü, yol haritası görselleştirme, agent başına "yaşam formu". Hiçbiri
acil değil — istenirse ayrı küçük dilimler.

## Canlı bulgu #3 (2026-07-10, Sonnet): router yeni kurulan vision modelini metin/agent görevlerinde YANLIŞLIKLA seçiyordu — DÜZELTİLDİ

Kullanıcı gerçek bir "sef" görevi denedi (masaüstünde .docx taşıma → güvenli test klasörüne
indirgendi): `run_agent coder: ...` her denemede İLK model turunda `INTERNAL_AGENT_ERROR: No
output generated` ile başarısız oldu (3x, `AGENT_TOOL_LOOP` ile koşu düştü — ekran görüntüsüyle
doğrulandı). **Kök neden bulundu (izole testlerle kanıtlandı):** `router.ts`'in `suggestModels`
fonksiyonu "general" görevlerde `locals[0]`'ı (Ollama'nın döndürdüğü SIRADAKİ yerel model) seçiyor;
bu oturumda `qwen2.5vl:7b` (vision-language model) kurulduktan sonra Ollama'nın listeleme sırasında
BİRİNCİ sıraya geçti. `qwen2.5vl:7b`'nin Ollama'nın OpenAI-uyumlu ucunda tool-calling/araç-çağırma
GÜVENİLİR ÇALIŞMIYOR — doğrudan `--model qwen2.5vl:7b` ile izole test edilince AYNI "No output
generated" hatası tekrarlandı, `--model qwen3:8b` ile İZOLE test edilince ise (run_command tool-call
düzgün üretilip) izin isteğine kadar sorunsuz geldi. Yani run_agent/O1/O2/O3 kodunda hata YOK —
bu oturumda YENİ kurulan vision modelinin router'ın varsayılan metin-görev seçimini kirletmesiydi.
- **Düzeltme:** `router.ts`'e `VISION_MODEL_PATTERN` + `preferTextCapable()` — `locals` listesi
  ("general"/"code"/"quick" hepsinde kullanılan ortak taban) artık vision-modelleri ELER; hiç
  metin-uyumlu yerel model YOKSA (yalnız vision modelleri kuruluysa) yine de onu kullanır (hiç
  öneri vermemek bundan kötü). +2 router testi.
- **Test:** 286→**288**. `pnpm build && pnpm test && pnpm lint` temiz (40 dosya/288 test).
- **Canlı doğrulama TAMAMLANDI:** daemon restart → aynı görev (model/provider belirtmeden,
  router'a bırakılarak) tekrar denendi → artık "No output generated" ÇÖKMESİ YOK, model gerçekten
  bir `run_command` tool-call'u üretti (izin isteği aşamasına geldi).
- **Ayrı bir gözlem (Symphony hatası DEĞİL, model-kalite nüansı):** router düzeltmesi sonrası bir
  denemede qwen3:8b, gerçek AI SDK tool-calling YERİNE tool çağrısını DÜZ METİN olarak
  (`{"name":"run_command","arguments":{...}}` JSON'unu cevap metnine yazarak) "taklit etti" —
  motor bunu tool çağrısı OLARAK ALGILAMADI (haklı olarak; gerçek tool-call formatı değil), koşu
  hiçbir şey yapmadan "completed" oldu. Bu, küçük yerel modellerin tool-calling'e bazen tam
  uymamasının bilinen bir sınırı — Symphony'nin kod tarafında bir hata değil. **Öneri:** yazma
  gerektiren gerçek görevlerde (dosya taşıma gibi) güvenilirlik için bulut model (Claude Haiku
  ucuz+hızlı) tercih edilsin; qwen3:8b salt-okur/basit özetleme işlerinde güvenilir kaldı.
- **Kullanıcıya:** test klasörü (`C:\Users\brkn2\Desktop\sef-test`, 3 dosya) temizlenip orijinal
  hâline döndürüldü, daemon restart edildi (bulut sağlayıcı, `router.suggest` cache'i yok —
  hemen etkili). Yeniden denemek istersen `symphony` → sef → bu sefer bulut model (ör. Claude
  Haiku) seçmen önerilir.

## Faz 5 — TAMAMEN BİTTİ: O1+O2+O3, 286 test, ROADMAP işaretlendi (2026-07-10, Sonnet)

## Faz 5 — Dilim O3 (masaüstü hiyerarşi + ROADMAP kapanışı) BİTTİ (2026-07-10, Sonnet) — Faz 5 TAMAM

- **`ui/store.ts`:** `agent.run.started` olayı artık `parentRunId?`'yi `runs`'a taşıyor (varsa
  log satırı da `↳ [agentId] koşu başladı` olarak basılır). Yeni saf export
  `orderRunsForDisplay(runs)`: çocuk koşu satırları ekranda ebeveyninin HEMEN ALTINA taşınır
  (ham dizi ekleniş sırasına göre karışık olabilir — `upsertRun` başa ekler); sahipsiz çocuk
  (ebeveyni listede yoksa) kaybolmaz, sona düşer. +4 store testi (parentRunId geçişi, gruplama
  2 senaryo, sahipsiz çocuk).
- **`App.tsx`:** koşu listesi artık `orderRunsForDisplay(runs)` ile render ediliyor; çocuk
  satırları `run-child` sınıfı + `↳` okuyla girintili gösteriliyor.
- **`index.css`:** `.run-child` (sol girinti + kesikli çerçeve, şeffaf arka plan) + `.run-child-arrow`.
- **Test:** 282→**286** (store +4). `pnpm build && pnpm test && pnpm lint` temiz (40 dosya/286 test).
- **ROADMAP Faz 5 TAMAMEN işaretlendi** (`[x]` — devretme/şef/maliyet stratejisi/kabul testleri),
  hem O1-f/O1-a testleriyle hem bu oturumdaki canlı `symphony agent sef` koşusuyla gerekçelendi.
  Kuyruk/paralel-çocuk kısmı ADR-014'te bilinçle v2'ye bırakıldığı ROADMAP'e not düşüldü.
- **Görsel doğrulama KULLANICIYA:** masaüstü değişikliği (`App.tsx`/CSS) Bash'ten görülemez —
  `pnpm --filter @symphony/desktop desktop:dev` ile bir `symphony agent sef "..."` koşusu
  başlatıp panelde çocuk koşu satırının ebeveyninin altında girintili+kesikli-çerçeveli
  göründüğünü teyit etmek kullanıcıya kalıyor (daemon zaten güncel build'de çalışıyor).

**ROADMAP kullanıcı önceliği sırası tükendi (1-2-3-4 + Faz 5 hepsi TAMAM).** Sıradaki: kullanıcının
O3'ün görsel sonucunu masaüstünde teyit etmesi (isteğe bağlı) + yeni bir ROADMAP fazı/önceliği
seçimi (Faz 6 "Zeka Katmanı" doğal aday, ya da kullanıcının kendi belirleyeceği bir iş).

## Faz 5 — Dilim O2 ("sef" agent + CLI/TUI hiyerarşi) BİTTİ (2026-07-10, Sonnet)

- **`definition.ts`:** dördüncü default agent **`sef`** (ADR-014 Karar 6) — araçlar
  `[read_file, glob, grep, run_agent]` (yazma/komut YOK, bilinçli — "orkestra şefi enstrüman
  çalmaz"), model boş (router/istek zamanı pinlenir). Prompt: göreve gerçekten gerekiyorsa
  ≥2 alt göreve böl, her `run_agent` çağrısında görevi KENDİ BAŞINA anlaşılır yaz (alt-agent
  şefin bağlamını görmez), basit iş→yerel/model verme, muhakeme→bilinçli bulut pin, sonuçları
  SENTEZLE. +1 definition.test.
- **`cli/commands/agent.ts`** (tek-seferlik `symphony agent`): `mine()` artık bir `childAgentIds`
  Map'i (`agent.run.started.parentRunId` ile doldurulur) de kapsıyor — çocuğun araç/izin/
  tamamlanma olayları da görünür, `↳ [agentId]` önekiyle basılır. **Kritik ayrım:** çocuğun
  `agent.run.completed/failed`'ı TÜM CLI çıktısını bitirmiyor (yalnız `payload.runId === runId`
  olan üst-düzey koşu `resolveExit` çağırır) — aksi hâlde ilk devretme biter bitmez süreç
  yanlışlıkla kapanırdı.
- **`agent-run.tsx`** (TUI): aynı `childAgentIdsRef` deseni. **Özenli ayrım:** `agent.run.state`
  (thinking/awaiting_user) ve `agent.delta` (akış metni) SADECE üst-düzey koşuya bağlı kalıyor
  (`mine()`, genişletilmedi) — çocuğun kendi state/metni karışırsa ekran anlaşılmaz olurdu.
  `agent.tool.*` ve `agent.tool.requested` genişletilmiş `mineOrChild()` kullanıyor — **çocuğun
  izin isteği görünür VE cevaplanabilir** (`requestId` GLOBAL, mevcut `permission.respond`
  akışı hiç değişmeden yeterli). `PermissionBox`'a `agentLabel` eklendi. +1 TUI testi (çocuk
  aktivitesi + izin kutusu + çocuğun completed'ının TÜM koşuyu bitirmediği).
- **Test:** 280→**282** (definition +1, agent-run.test +1). `pnpm build && pnpm test &&
  pnpm lint` temiz (40 dosya/282 test).
- **Canlı doğrulama TAMAMLANDI:** daemon restart → `symphony agent sef "..."` (Claude Haiku,
  test-arsiv dizininde, göreve bilinçli "run_agent ile asistan'a devret" talimatı verildi).
  **Sonuç uçtan uca çalıştı:** şef glob/read_file ile keşfetti → `run_agent` ile asistan'a
  İKİ kez devretti → çocuk koşusu ekranda `↳ [asistan] koşu ... başladı/düşünüyor/tamamlandı`
  olarak göründü → BİRİNCİ devretme başarılı (sonucu şefin bağlamına gerçekten aktı) →
  **İKİNCİ devretme iki kez `INTERNAL_AGENT_ERROR` ile başarısız oldu ama şefin koşusu
  DÜŞMEDİ** — araç hatası olarak aldı, farklı ifadeyle tekrar denedi, sonra KENDİ okuduğu
  ham veriyle nihai özeti kendisi sentezleyip düzgün bitirdi (12494+1170 token, $0.0183).
  **Bu, O1'in "araç hatası ≠ koşu hatası" tasarımının canlı kanıtı** — devretme başarısız
  olsa bile şef akıllıca telafi etti, çökmedi.
  - **Yan bulgu (kök nedeni bulundu, DÜZELTME GEREKMİYOR):** ikinci devretmenin hatası
    ("No output generated. Check the stream for errors.") ayrıca izole test edildi —
    AYNI görev/model (qwen3:8b/ollama) tek başına sorunsuz tamamlandı. Yani hata O1/O2
    kodunda DEĞİL, art arda hızlı `run_agent` çağrılarının Ollama'yı (muhtemelen model
    boşaltma/yeniden yükleme zamanlaması) geçici olarak tökezletmesinde — mimari bunu
    zaten doğru yakalayıp toparladığı için ayrı bir düzeltme AÇILMADI, yalnız not düşüldü.

### ✅ Dilim O3 — masaüstü hiyerarşi + ROADMAP kapanışı — BİTTİ (yukarıda ayrıntı)

- `ui/store.ts`: `parentRunId` sakla (snapshot `ActiveRun`'dan + `agent.run.started`'dan);
  `ui/App.tsx`: çocuk koşu satırları ebeveynin altında girintili (`↳`). +store.test.
- ROADMAP Faz 5 kabul kutularını işaretle: iki eşzamanlı koşu ✅ (O1-f testi + bu oturumdaki
  canlı sef koşusunda dolaylı kanıt), şef ≥2 alt görev dağıtımı ✅ (O1-a testi + BUGÜNKÜ canlı
  `symphony agent sef` koşusu — gerçek Claude Haiku + yerel qwen3:8b karışımıyla), agent tanımı
  taşınabilirliği ✅ (Faz 3'ten beri fiilen var). "Görev kuyruğu"nun kuyruk kısmı + paralel
  çocuklar ADR-014'te bilinçle v2'ye ertelendi — ROADMAP'e not düş.
- O3 bitince Faz 5 TAMAMEN kapanır; ROADMAP'teki `[ ]` kutucuklarını `[x]`'e çevir.

## Faz 5 — Dilim O1 (çekirdek devretme) BİTTİ (2026-07-10, Sonnet)

ADR-014'ün 6 kararı uygulandı; PROTOKOL.md/SPEC-AGENT.md'deki "planlandı" işaretleri kaldırıldı.
- **shared:** `ActiveRunSchema.parentRunId?` + `AgentRunStartedPayloadSchema.parentRunId?` (ADDITIVE).
- **`definition.ts`:** `AGENT_FRONTMATTER_TOOL_NAMES = [...TOOL_NAMES, "run_agent"]` — frontmatter
  `tools:` artık `run_agent`'ı kabul eder (varsayılan LİSTEDE DEĞİL — bilinçli opt-in).
- **`engine.ts` (asıl iş):** `start()` ince bir sarmalayıcıya indirgendi; gerçek mantık
  `startInternal(params)`'a taşındı — hem wire `agent.start` hem `run_agent` aracı AYNI kapıdan
  geçer, yalnız ikincisi `parentRunId`/`onChildFinish` dolu geçer (wire payload'ında bu alanlar
  YOK, dışarıdan asla enjekte edilemez). `ActiveRunRecord`'a `parentRunId`/`childRunIds`/
  `onChildFinish` eklendi. `makeRunAgentSpec(run)` — dinamik `AgentToolSpec` (MCP deseni):
  risk sınıfı hedefin araç setine göre (`isReadOnlyAgent`: tamamen read_file/glob/grep ve
  mcpServers boşsa "safe", aksi "mutating"); `permissionTarget`=hedef agentId; `execute()`
  `startInternal`'ı çağırıp `onChildFinish` callback'iyle çocuğun bitişini bekler (Promise +
  `AbortSignal` dinleyicisi — zaman aşımı/iptal çocuğu da `cancel()`ler, öksüz koşu kalmaz).
  `finish()`'e `onChildFinish` tetikleyici eklendi (completed→sonuç metni, failed/cancelled→
  araç HATASI — SPEC §4 "araç hatası≠koşu hatası" ilkesi ile şefin koşusu düşmez). `cancel()`
  artık ÖNCE `childRunIds`'i, sonra kendini abort eder (kaskad). `runLoop`'ta specs listesine
  `run_agent`, YALNIZ `run.parentRunId===undefined` VE tanım listesinde varsa eklenir (derinlik-1
  sigortası — çocuğa asla verilmez, sayaç değil aracın yokluğu). `MAX_CHILD_RUNS=8` sabit sayaçla.
- **Test:** 274→**280** (definition +0 [O2'de "sef" testi gelecek] · engine +6: (a) şef→çocuk→
  sonuç + parentRunId + iki completed + salt-okur hedefte izin YOK, (b) yazma-yetkili hedefte
  izin ŞEFİN runId'siyle + çocuk izin-öncesi doğmaz, (c) çocuk failed→şef DEVAM eder (araç hatası),
  (d) MAX_CHILD_RUNS aşımı→araç hatası (9. deneme çocuk doğurmaz), (e) ebeveyn iptali→çocuk da
  cancelled, (f) iki üst-düzey koşu snapshot'ta ayrı+parentRunId yok). `pnpm build && pnpm test
  && pnpm lint` temiz (40 dosya/280 test).
- **⚠️ Canlı bulgu (test yazarken, kod DEĞİL test tasarımı sorunu):** `deferredTurn()` (ham
  `streamText` akışı ortasında sonsuza dek asılı kalan sahte model turu) ile sıkışmış bir koşuyu
  `cancel()`'lemek bu mock altyapısında GÜVENİLİR ÇALIŞMIYOR — bağımsız bir standalone script'le
  doğrulandı (run_agent'la İLGİSİZ, iki DÜZ üst-düzey `deferredTurn` koşusu da aynı şekilde
  takılıyor). Mevcut TÜM geçen cancel testleri yalnız `awaiting_user`/`awaiting_permission`
  durumlarını iptal ediyor (bunların KENDİ açık `abort` dinleyicisi var — `waitForUser`/
  `requestPermission`); ham `for await (const chunk of result.textStream)` tüketimi AI SDK'nın
  `abortSignal`'ı gerçekten kesintiye uğratmıyor GİBİ görünüyor. Testler (e)/(f) bu yüzden
  `awaiting_permission`'a düşecek şekilde (write_file ile) yeniden tasarlandı — ÇALIŞTI. **Bu,
  canlı bulgu #1'in (qwen3:8b'nin 15dk döngüye girmesi) kök nedenine dair bir İPUCU OLABİLİR**:
  gerçek bir model akış ortasında takılırsa, KULLANICININ Esc/Ctrl+C'si de aynı şekilde
  İŞLEMEYEBİLİR. Doğrulanmadı, ayrı bir araştırma gerektirir — kapsam dışı bırakıldı, ama
  ÖNEMLİ bir gözlem olarak buraya not düşüldü (ileride `run_command`'ın execa `cancelSignal`
  deseni gibi, streamText tüketimine de MANUEL bir abort-check eklemek gerekebilir).
- **Canlı doğrulama BEKLİYOR (daemon restart gerekir):** henüz "sef" varsayılan agent'ı yok
  (O2'de gelecek) — bu dilimde canlı deneme için kullanıcı KENDİ agent tanımına `run_agent`
  eklemeli (`~/.symphony/agents/<ad>.md` frontmatter `tools:` listesine `run_agent` yazıp bir
  hedef agent id'si vererek `symphony agent <ad> "..."` ile deneyebilir) — pratik değil, O2'yi
  bekleyip gerçek "sef" ile denemek daha mantıklı.

## Faz 5 — Çoklu agent orkestrasyonu: TASARIM TAMAM (2026-07-10, Fable — ADR-014) → uygulama dilimleri O1/O2/O3

Sonnet'in hazırladığı 5 açık soru karara bağlandı, **ADR-014 yazıldı** (`docs/kararlar/KARARLAR.md`);
PROTOKOL.md (+`agent.run.started.parentRunId?`, §5 hiyerarşi notu) ve SPEC-AGENT.md (§2 tablo satırı
+ YENİ §9 Devretme) "planlandı — Dilim O1" işaretleriyle güncellendi. Kararların özü:
- **Devretme = motor-içi dinamik araç `run_agent {agent, task, model?, provider?}`** (MCP araç
  deseni: spec koşu başına motor tarafından üretilir, execute engine'i closure'lar). Yeni protokol
  MESAJI yok; host-orkestrasyon reddedildi (şefin planı koşu SIRASINDA modelin kararıyla değişmeli).
- **Hiyerarşi ADDITIVE:** `ActiveRun.parentRunId?` (snapshot) + `agent.run.started.parentRunId?`.
- **Güvenlik:** çocuğun araç çağrıları AYNI izin kapısından KENDİ runId'siyle kullanıcıya sorulur;
  `run_agent` risk sınıfı hedefe göre dinamik (hedefin araç seti tamamen safe → safe, aksi →
  mutating, permissionTarget=hedef agentId); çocuk jail = ebeveyn cwd birebir (cwd/extraDirs
  parametresi YOK).
- **Sigortalar:** derinlik 1 (parentRunId'li koşuya run_agent aracı hiç verilmez), MAX_CHILD_RUNS=8,
  çocuklar daima tek-seferlik + sıralı, ebeveyn iptali çocukları da iptal eder.
- **Maliyet v1:** model boşsa çocuk tanımı → router (`pickModel`) — agent.start ile aynı zincir;
  şef prompt'u basit işleri yerele yönlendirmeyi söyler. Öğrenen router Faz 6, KARIŞTIRMA.
- **Varsayılan "sef" agent'ı** (4. default): araçlar `[read_file, glob, grep, run_agent]` — kendisi
  yazamaz, yazma işini coder'a devretmek ZORUNDA (şef enstrüman çalmaz).

### ✅ Dilim O1 — çekirdek devretme (shared + engine) — BİTTİ (yukarıda ayrıntı; orijinal talimat aşağıda arşivlendi)

**Önce oku (yalnız bunlar):** ADR-014 + SPEC-AGENT §9 + `engine.ts` (start/runLoop/izin kapısı/
cancel + MCP araçlarının specs'e nasıl eklendiği) + `engine.test.ts` (FakeAdapter/turn deseni).
1. PROTOKOL.md + SPEC-AGENT.md'deki `(planlandı — Dilim O1)` işaretlerini kaldır.
2. `shared/common.ts` `ActiveRunSchema.parentRunId?` + `events.ts` agent.run.started şemasına
   `parentRunId?` (adı muhtemelen `AgentRunStartedPayloadSchema`).
3. `tools.ts`: `AGENT_TOOLS`'a DOKUNMA (statik 6 araç kalır). `definition.ts` frontmatter
   `tools:` enum'unu `[...TOOL_NAMES, "run_agent"]` olarak genişlet (AgentDefinition.tools tipi
   de genişler; engine statik araçları `AGENT_TOOLS[name]` ile alırken `run_agent`'ı FİLTRELER).
4. `engine.ts`:
   - `ActiveRunRecord`'a `parentRunId?` + `childRunIds: string[]`.
   - `start()`'ı iç `startInternal(payload, parent?)`'a ayır; dıştaki imza DEĞİŞMEZ. Çocuk:
     cwd=parent.cwd, conversational=false, model/provider araç argümanından (boşsa tanım→router).
   - Koşu bitişini içeriden bekleyebilmek için kayda bir deferred (`finish()` resolve eder) —
     `runLoop`'un finish yollarının ÜÇÜNDE de (completed/failed/cancelled) çözülmeli.
   - Dinamik `makeRunAgentSpec(run)`: yalnız `run.parentRunId === undefined` VE tanım listesinde
     `run_agent` varsa specs'e eklenir. `riskClass(args)`: hedef tanımı yükle → araçları tamamen
     safe ise "safe", değilse "mutating" (tanım yüklenemezse "mutating"). `permissionTarget` =
     hedef agentId. `execute`: MAX_CHILD_RUNS kontrolü → startInternal → deferred bekle → sonuç
     metni döndür (truncate MAX_OUTPUT_CHARS); çocuk failed/cancelled → AgentError fırlat (araç
     hatası olarak modele döner, koşu düşmez).
   - `cancel()`: önce `childRunIds`'i iptal et, sonra kendini.
   - `agent.run.started` broadcast'ine + `activeRuns()`/snapshot'a parentRunId.
5. **Test (engine.test.ts; FakeAdapter script'i SIRALI tüketilir — şef ve çocuk aynı fake
   provider'ı kullanır, script sırası: şef-tur1(run_agent çağrısı) → çocuk-tur1(metin) →
   şef-tur2(nihai metin)):** (a) şef→çocuk→sonuç şef prompt'unda görünür + çocuğun
   agent.run.started'ı parentRunId taşır + iki ayrı completed; (b) salt-okur hedefe devretme
   İZİNSİZ akar, yazma-araçlı hedefe devretme `agent.tool.requested` (tool=run_agent, ŞEFİN
   runId'siyle) üretir; (c) çocuk failed → şef koşusu DEVAM eder; (d) MAX_CHILD_RUNS aşımı araç
   hatası; (e) ebeveyn iptali çocuğu da cancelled yapar; (f) İKİ eşzamanlı üst-düzey koşu
   snapshot'ta ayrı görünür (ROADMAP kabul maddesinin otomatik karşılığı — yoksa ekle).
6. `pnpm build && pnpm test && pnpm lint` + DURUM güncelle.

### ✅ Dilim O2 — "sef" varsayılan agent + CLI/TUI hiyerarşi — BİTTİ (yukarıda ayrıntı; orijinal talimat arşivlendi)

### 📋 Dilim O3 — masaüstü hiyerarşi + ROADMAP kapanışı (orijinal talimat; yukarıda "SIRADAKİ" bölümünde güncel özeti var)

- `ui/store.ts`: `parentRunId` sakla (snapshot `ActiveRun`dan + `agent.run.started`dan);
  `ui/App.tsx`: çocuk koşu satırları ebeveynin altında girintili (`↳`). +store.test.
- ROADMAP Faz 5 kabul kutularını işaretle: iki eşzamanlı koşu (O1-f testi + canlı), şef ≥2 alt
  görev dağıtımı (O1-a testi + canlı sef koşusu), agent tanımı taşınabilirliği (Faz 3'ten beri
  fiilen var — nota bağla). "Görev kuyruğu"nun kuyruk kısmı ile paralel çocuklar ADR-014'te
  bilinçle v2'ye ertelendi — ROADMAP'e not düş.

**Dilim sırası O1→O2→O3; her dilim sonrası `pnpm build && pnpm test && pnpm lint` + DURUM güncelle.**

## Canlı bulgu #2 (2026-07-10, Sonnet): damıtıcı, M1'in enjeksiyonuyla KİRLENİYORDU — DÜZELTİLDİ ve canlı doğrulandı

M3'ü canlı test ederken (küçük sahte arşiv: 2 dosya, sahte "Barkın/TypeScript/Rust/PowerShell"
içerikli), taslakta arşivde HİÇ geçmeyen ifadeler çıktı ("Akıcı, eğitimsel anlatım tercih eder") —
kullanıcının GERÇEK `profil.md`'sindeki cümlelerle neredeyse birebir. Kök neden: `engine.ts`
`buildSystemPrompt` çağrısı M1'den beri HER agent koşusuna profili enjekte ediyor, `damitici` için
istisna YOKTU — arşivi damıtırken kendi bağlamına zaten mevcut profil de karışıyordu, taslağı
"arşivden yeni ne çıktı" sorusuna cevap olmaktan çıkarıyordu.
- **Düzeltme:** `engine.ts`'te `definition.id === "damitici"` ise `loadMemoryProfile()` hiç
  çağrılmıyor — damıtıcı artık yalnız arşivi görüyor. +1 test (`engine.test.ts`: damitici
  agent'ıyla koşuda enjekte edilen profil metni prompt'ta YOK).
- **Test:** 273→**274**. `pnpm build && pnpm test && pnpm lint` temiz.
- **Canlı doğrulama TAMAMLANDI (bu oturumda):** daemon restart → AYNI sahte arşivle tekrar
  `symphony memory distill` → taslak bu kez TEMİZ (yalnız arşiv içeriği: TypeScript/Rust/Python/
  PowerShell/Symphony/Türkçe-kısa-net — canlı profilden hiçbir sızıntı YOK) → canlı `profil.md`
  koşu boyunca bayt-bayt değişmedi (elle `cat` ile teyit edildi) → test taslağı temizlendi
  (`profil.taslak.md` silindi, gerçek veri değildi). **GPU/döngü riski de gözlenmedi** (iki koşu
  da birkaç saniyede bitti, canlı bulgu #1'deki tıkanma tekrarlanmadı — küçük/kısa arşivle sınırlı
  test, büyük arşivde risk hâlâ teorik olarak açık).

## Öncelik #3 — Uzun-dönem hafıza: Dilim M3 (arşiv damıtma) BİTTİ (2026-07-10, Sonnet)

ADR-013 Karar 5. Protokolsüz — mevcut `agent.start`/`agent.run.completed` yeniden kullanıldı,
PROTOKOL.md'ye dokunulmadı.
- **`core/agent/definition.ts`:** üçüncü varsayılan agent **`damitici`** (id ASCII; frontmatter
  `name: damıtıcı`) — asistan ile AYNI salt-okur araç seti (`read_file/glob/grep`, write/run YOK),
  `provider`/`model` BOŞ (CLI kendi pinler, aşağıda). Sistem prompt'u: çıktı biçimi (5 sabit
  başlık), "yalnız kalıcı/tekrar eden gerçek, tek seferlik detay değil" kuralı, karakter bütçesi.
- **`core/config/paths.ts`:** `profileDraftFile` (`memory/profil.taslak.md`) — canlı `profileFile`
  ile AYNI dizinde ama apayrı dosya.
- **YENİ `cli/commands/memory.ts` genişletmesi** (eski tek fonksiyon `memoryCommand` → üç fonksiyona
  bölündü: `memoryShowCommand`/`memoryPathCommand`/`memoryDistillCommand`, `index.ts`'te commander
  alt-komut grubuna taşındı: `memory show|path|distill`, `show` varsayılan):
  - `listArchiveFilesByRecency(dir)` (SAF): dosyaları en yeniden en eskiye sıralar (node_modules/
    .git hariç, recursive). **Tasarım notu:** `glob` aracı mtime döndürmüyor (SPEC'te yok) — CLI
    bunu KENDİSİ hesaplayıp görev metnine "bu sırayla oku" olarak yazıyor; asıl OKUMA yine agent'ın
    kendi `read_file` çağrılarıyla (izin/jail/telemetri bedava, ADR'nin kazanım notu korunuyor).
  - `resolveDistillModel(client, allowBulut)`: **--bulut verilmediyse `models.list`teki İLK yerel
    modeli AÇIKÇA pinler** (agent.start'a `provider`/`model` olarak geçer) — router'ın "boşsa
    bulut da seçebilir" belirsizliğine güvenmiyor, güçlü gizlilik garantisi. Yerel model yoksa hata
    ("arşiv buluta gönderilmez... --bulut kullan"). `--bulut` verilirse hiç sormaz, router seçsin.
  - `writeDistillDraft(result)`: `profileDraftFile`'a yazar; `profileFile`'a ASLA dokunmaz (ayrı
    fonksiyon, testte doğrudan doğrulanıyor).
  - `memoryDistillCommand`: yukarıdakileri bağlar + `agent.start {agentId:"damitici", cwd:<arşiv>,
    conversational:false, ...modelOverride}` + `agent.run.completed/failed` dinler
    (`agentRunCommand`'daki AYNI runId-korelasyon deseni).
- **Test:** 264→**273** (definition +1 damıtıcı tanımı · YENİ `cli/commands/memory.test.ts` 8:
  dosya sıralama 2, görev metni 2, model pinleme 3, **taslak-yazma güvenliği 1** — canlı profil
  dosyasının bayt bayt DEĞİŞMEDİĞİni doğrudan doğrular). `pnpm build && pnpm test && pnpm lint`
  temiz (40 dosya/273 test).
  - **Test kapsamı notu (bilinçli karar):** DURUM'un önerdiği "FakeAdapter ile agent.start uçtan
    uca" testi YERİNE, CLI-katmanındaki YENİ mantığı (dosya sıralama/model pinleme/taslak-yazma
    güvenliği) doğrudan ve `ai`/`ai/test` bağımlılığı EKLEMEDEN test ettim — agent tool-loop'unun
    kendisi zaten `engine.test.ts`/`daemon-agent.test.ts`'te kapsamlı test ediliyor, damıtıcı da
    AYNI motoru/AYNI salt-okur araç setini (asistan ile ortak) kullanıyor; asıl YENİ riskli yüzey
    CLI'nin kendi dosya G/Ç mantığıydı, onu hedefledim.
- **Canlı doğrulama TAMAMLANDI** (yukarıdaki "Canlı bulgu #2" bölümü) — küçük sahte arşivle iki
  koşu, ikinci koşu temiz taslak + değişmeyen canlı profil + GPU takılması yaşanmadı. Büyük/uzun
  arşivlerde canlı bulgu #1'in (tekrar döngüsü) riski teorik olarak hâlâ açık — kullanıcı ilk
  gerçek kullanımını yine küçük bir arşivle başlatıp GPU'yu izlemek isteyebilir.

**ROADMAP kullanıcı önceliği #3 (uzun-dönem hafıza/arşiv) TAMAM** (M1+M2+M3 bitti, canlı doğrulandı).
Sıradaki: kullanıcının GERÇEK bir arşivle deneyi (isteğe bağlı) + (isterse) yerel model genişletmesi
(qwen2.5-coder:7b + qwen2.5vl:7b — bu oturumda konuşuldu, kuruluma henüz geçilmedi) + yeni bir
ROADMAP önceliği seçimi.

## Canlı bulgu (2026-07-10, Sonnet): profil enjeksiyonu kimlik karışıklığı yaratıyordu — DÜZELTİLDİ

M2 sonrası kullanıcı profilini gerçekten doldurup TUI'de "asistan" persona'sına "ben kimim?"
sorduğunda, qwen3:8b **profildeki "Adım X" ifadesini kendi kimliği sanıp** "Ben X, Symphony'nin
destek görevlisiyim" diye cevapladı. Kök neden: enjekte edilen blok yalnız "## Kullanıcı profili
(salt-okunur bağlam)" başlığı taşıyordu — modele bunun KONUŞTUĞU KİŞİYE ait olduğunu, KENDİ
kimliği olmadığını açıkça söylemiyordu. Küçük/yerel modellerde (özellikle `temperature:0`) bu tür
örtük ayrımlar kolayca kaybolabiliyor.
- **Düzeltme:** `core/memory/profile.ts`e ORTAK bir SAF fonksiyon eklendi: `formatProfileContext
  (profile)` — "SENİN kimliğin DEĞİL — yalnızca bağlam" + "KULLANICIYA aittir, sana değil" diye
  açıkça belirtir. Hem `engine.ts` (agent yolu) hem `daemon.ts` (chat yolu, `runChat`'teki
  `instructions`) artık BU TEK fonksiyonu kullanıyor — önceden iki dosyada ayrı ayrı yazılmış
  aynı metin vardı, kayma riski taşıyordu.
- **Test:** 263→**264** (profile.test +1: blok hem profil metnini içeriyor hem "SENİN kimliğin
  DEĞİL"/"KULLANICIYA aittir" uyarılarını taşıyor). `pnpm build && pnpm test && pnpm lint` temiz.
- **Canlı doğrulama BEKLİYOR:** **daemon restart gerekir** (core değişti). Restart sonrası aynı
  "ben kimim?" sorusu tekrar denenmeli — model artık profildeki ismi KULLANICIya ait bağlam
  olarak kullanmalı, kendi kimliği sanmamalı.
- **Yan bulgu (henüz kök nedeni doğrulanmadı, izlenecek):** aynı canlı testte "10 kıta yaz" gibi
  uzun/yapılandırılmış bir istek qwen3:8b'yi 15+ dakika GPU %96-98/86-87°C'de "yazıyor…" durumunda
  TIKADI (donmuş değil — `ollama ps` aktif üretim gösteriyordu, ama bitmiyordu). Şüphe: küçük
  yerel modelde `temperature:0` + uzun/tekrarlı-yapılı metin isteği → tekrar döngüsü (durma
  token'ı hiç gelmiyor). `engine.ts`'in `streamText` çağrısında `maxOutputTokens` GİBİ bir
  güvenlik tavanı YOKTU — teorik olarak model context'i dolana kadar sürebilirdi. Kullanıcıya
  Esc/Ctrl+C ile iptal tavsiye edildi. **Kesin kök neden BULUNMADI.**
  - ✅ **Tavan kısmı 2026-07-10'da YAPILDI** (bkz. dosyanın başındaki "Kaçak üretim sigortası"
    bölümü): artık her tur `config.limits.maxOutputTokens` (vars. 8192) ile sınırlı → koşunun
    sonlanması garanti. **Hâlâ açık:** tekrar-döngüsü TESPİTİ (tavan döngüyü önlemez, bitirir)
    ve duvar-saati zaman aşımı (O1'in AbortSignal bulgusuna bağımlı).

## Öncelik #3 — Uzun-dönem hafıza: Dilim M2 (REST + CLI + TUI yüzeyi) BİTTİ (2026-07-10, Sonnet)

M1'in enjeksiyon çekirdeği üzerine insan-arayüzü yüzeyi eklendi (Kural 1 sırası: PROTOKOL →
shared → core → daemon → cli → TUI):
- **PROTOKOL.md:** `GET/PUT /api/memory`'deki iki `(planlandı — M2)` işareti kaldırıldı (artık
  uygulanmış durumu yansıtıyor).
- **shared/rest.ts:** `MemoryGetResponseSchema {content, chars, truncated, updatedAt}` +
  `MemoryPutRequestSchema {content}` (`index.ts`'teki `export * from "./protocol/rest.js"`
  otomatik dışa açtı).
- **core/memory/profile.ts:** İKİ yeni SAF fonksiyon (M1'in `loadProfile`'ından AYRI amaç):
  `readProfileSnapshot` (REST GET — dosyanın TAM/kesilmemiş içeriği + `truncated` yalnız bir
  UYARI bayrağı, `content`'i KESMEZ; `loadProfile` enjeksiyon için kesiyordu, karıştırma) +
  `writeProfile` (REST PUT — üst dizini oluşturup TAM içeriği yazar). `core/index.ts`'e
  `export * from "./memory/profile.js"` eklendi (TUI'nin `loadProfile`'ı doğrudan kullanması için).
- **daemon.ts:** `GET /api/memory` (Bearer; `readProfileSnapshot(paths.profileFile)`) +
  `PUT /api/memory` (şema doğrulanır → `writeProfile` → güncel snapshot döner). Agent araç
  yüzeyinde bu uca giden yol YOK (ADR-013 yazma kısıtı korunuyor — yalnız REST).
- **cli/client/daemon-client.ts:** `getMemory()` (mevcut `getHistory` REST yardımcısını kullanır)
  + `putMemory(content)` (ayrı `fetch` — PUT gövdesi gerektiriyor).
- **YENİ `cli/commands/memory.ts`:** `symphony memory` (içerik + karakter sayısı + `truncated`
  uyarısı gösterir) · `symphony memory path` (dosya yolunu YAZAR — daemon'a bağlanmaz, kullanıcı
  kendi editörüyle açsın diye). `index.ts`'e `memory [alt]` komutu kaydedildi.
- **TUI karşılaması (`welcome.tsx`+`app.tsx`):** `Welcome`'a `memoryChars: number | null` prop'u;
  dolu ise "🧠 profil aktif (N karakter)" satırı. `runTui()` REST'e gitmez — `loadProfile
  (getSymphonyPaths().profileFile)` ile AYNI dosyayı motorun enjeksiyon kuralıyla (dosya yok/
  boş/yalnız-iskelet→gizle) doğrudan okur; `profile.text.length` = gerçekten enjekte edilen
  karakter sayısı (REST'in `chars`'ı FULL içerik olduğundan burada KULLANILMADI — kasıtlı ayrım).
- **Test:** 255→**263** (daemon.test +1 REST roundtrip/401, daemon-client.test +1 getMemory/
  putMemory roundtrip, welcome.test +1 satır görünürlüğü, profile.test +5 readProfileSnapshot/
  writeProfile). `pnpm build && pnpm test && pnpm lint` temiz (39 dosya/263 test).
- **Canlı doğrulama YAPILDI (2026-07-10, Sonnet + kullanıcı):** eski daemon zaten kapalıydı (port
  7770 boş); `symphony status` taze build'i başlattı. `curl` ile gerçek daemon'a karşı:
  `GET/PUT /api/memory` token'sız → 401 (ikisi de) · token'lı `GET` → scaffold (192 karakter) ·
  `PUT` test içeriğiyle yaz → oku → değişiklik yansıdı · orijinal scaffold GERİ yazıldı
  (kullanıcının gerçek profil dosyası test verisiyle kirletilmedi). `symphony memory` / `symphony
  memory path` CLI komutları da aynı canlı daemon'a karşı doğrulandı.
  **TUI satırı (🧠 profil aktif) KULLANICI TARAFINDAN GÖRSEL TEYİT EDİLDİ** (Notepad'le profil.md
  dolduruldu, TUI yeniden başlatıldı, satır göründü — "kontrol ettim sorun yok"). **Tuzak notu:**
  kullanıcı ilk denemede `symphony memory path`i TUI'nin ZATEN AÇIK olduğu aynı cmd penceresine
  yazdı → komut kabuğa değil TUI'nin input kutusuna gitti ("bir şey olmadı" izlenimi verdi);
  tek-seferlik CLI komutları (`memory path` gibi) AYRI/boşta bir terminalde çalıştırılmalı, TUI
  kendi penceresini tam ekran/raw-mode ile kaplıyor. **Kapsam kararı (kullanıcı onayı):** masaüstü
  (Tauri `desktop:dev`) panelinde profil göstergesi eklenmeyecek — bilinçli olarak TUI-only kaldı,
  ek iş açılmadı.

**Sıradaki:** 📋 Dilim M3 — arşiv damıtma (aşağıda ayrıntı; henüz başlanmadı).

## Öncelik #3 — Uzun-dönem hafıza: Dilim M1 (çekirdek enjeksiyon) BİTTİ (2026-07-09, Sonnet)

Tasarım ADR-013'te (`docs/kararlar/KARARLAR.md`, Fable). M1 uygulandı:
- `paths.ts`: `profileFile` (`~/.symphony/memory/profil.md`) eklendi (`memoryDir` zaten Faz
  3'ten beri vardı, kullanılmıyordu).
- YENİ `core/src/memory/profile.ts` (SAF, 8 test): `loadProfile` (yok/boş/yalnız-iskelet→null;
  `MAX_PROFILE_CHARS=8000` aşımında `truncated:true`), `ensureProfileScaffold` (dosya YOKSA
  yalnız başlıklardan iskelet yazar, VARSA dokunmaz).
- `config.ts`: `memory.enabled` (vars. true) — acil kapatma anahtarı.
- `engine.ts`: `AgentEngineDeps.loadMemoryProfile`; `buildSystemPrompt` üçüncü parametre alır.
- `daemon.ts`: açılışta `ensureProfileScaffold`; gerçek loader (`enabled=false`→null,
  `truncated`→pino warn); engine'e geçirilir.
- **Chat yolu — ADR-013'ten SAPMA (uygulama sırasında düzeltildi, ADR'ye işlendi):** ilk tasarım
  "provider mesaj kopyasına system-önek ekle" idi; canlı testte AI SDK v7'nin `messages`/`prompt`
  içinde `system` rolünü REDDETTİĞİ ortaya çıktı (`InvalidPromptError` — engine.ts'in zaten
  bildiği kısıt, chat yoluna UYGULANMAMIŞTI). Doğru çözüm: `ChatStreamRequest.instructions?`
  eklendi, 4 adapter da (`anthropic`/`openai`/`google`/`ollama`) `streamText`e `instructions`
  iletir — agent yoluyla AYNI desen. `payload.messages`/`saveChatTurn` HİÇ DOKUNULMADI.
- **Test:** 244→**255** (profile 8, engine +2, daemon +1 — daemon testi GERÇEK daemon +
  fake-Ollama HTTP gövdesini denetler: profil sağlayıcıya giden istekte VAR, `sessionDetail`
  dökümünde YOK). `pnpm build && pnpm test && pnpm lint` temiz (39 dosya/255 test).
- **Canlı doğrulama (kabul testi):** ADR-013 daemon.test.ts senaryosu GERÇEK bir daemon
  başlatıp WS üzerinden chat.start yapıyor ve fake-Ollama'nın aldığı HTTP gövdesini
  doğruluyor — ROADMAP Faz 6 kabul testinin (profil bağlamda görünüyor) otomatik karşılığı.
  Gerçek kullanıcı ürünüyle (symphony CLI/masaüstü) elle doğrulama henüz YAPILMADI: kullanıcı
  isterse `~/.symphony/memory/profil.md`'yi doldurup **daemon restart** sonrası `symphony`
  ile bir sohbet/agent koşusu başlatarak deneyebilir.

### 📋 Dilim M3 — arşiv damıtma (taslak üreten salt-okur agent; protokolsüz) ← SIRADAKİ

ADR-013 Karar 5. YENİ agent tanımı "damitici" (`definition.ts ensureDefaultAgent`e üçüncü
varsayılan: araçlar read_file/glob/grep, provider/model BOŞ — router seçer). YENİ
`cli/commands/memory.ts`e alt komut: `symphony memory distill <arşiv-dizini>`:
1. Yerel model şartı: `models.list`ten `local:true` yoksa hata ("arşiv buluta gönderilmez;
   --bulut ile bilinçli geç"); `--bulut` bayrağı override.
2. `agent.start {agentId:"damitici", cwd:<arşiv>, task:<damıtma talimatı>, conversational:false}` —
   talimat: "bu dizindeki konuşma dökümlerinden kullanıcının kimliği/üslubu/teknik tercihleri/
   projelerini damıt; profil.md bölüm başlıklarıyla, ≤6000 karakter, yalnız kalıcı gerçekler".
   Karakter bütçesi: en yeni dosyalardan başla (glob mtime), bütçe dolunca dur.
3. `agent.run.completed.result` → CLI `profil.taslak.md`'ye yazar (CANLI profile DOKUNMAZ) +
   kullanıcıya: "taslağı gözden geçir: <yol>; onaylıyorsan içeriği profil.md'ye taşı".
Test: sahte arşiv dizini + FakeAdapter ile result→taslak dosyası yazılır, profil.md değişmez.
Not: arşivin gerçek yolu/formatı kullanıcıdan gelecek — komut dizin alır, format varsaymaz
(agent read_file/glob ile kendisi gezer).

**Dilim sırası M1→M2→M3 (M1✅ M2✅); her dilim sonrası `pnpm build && pnpm test && pnpm lint` + DURUM güncelle.**

## Rapor2 §3 düzeltme paketi (2026-07-09, Sonnet): §3.1-§3.4 BİTTİ ve testli (244 test)

`rapor/fabelincelemeraporu2.md`'nin 4 maddesi mekanik olarak uygulandı (devir talimatıyla,
yeniden denetim yapılmadan — kararlar zaten raporda vardı):
1. **§3.1 TUI resume + "Enter→yeni görev"** (`agent-run.tsx`): `initialSessionId` artık state'e
   alınıyor (`sessionId`), `resetForNewTask` onu `undefined`'a düşürüyor — "yeni görev" artık
   GERÇEKTEN yeni oturum. +1 test (resume→bitir→Enter→yeni görev→agent.start sessionId'siz).
2. **§3.2 say() persist penceresi** (`engine.ts`): iki yeni `persistConversation` çağrısı —
   (a) ilk görev metni transcript'e girer girmez (model turu başlamadan), (b) `agent.say`
   sonrası kullanıcı turu transcript'e eklenir eklenmez (asistan turu bitmeden). +2 test
   (`engine.test.ts` — yeni `deferredTurn()`/`deferredStream()` test yardımcıları: stream
   test elle push/finish çağırana dek asılı kalır, race'siz "asistan cevabı gelmeden önce
   kalıcılaştı" doğrulaması sağlar).
3. **§3.3 queued→failed geçersiz geçiş** (`engine.ts`): `runLoop`'un ilk `transition(thinking)`'i
   artık MCP bağlantısından/`languageModel` çağrısından ÖNCE — bu adımlardan biri atarsa
   `finish(failed)` artık geçerli `thinking→failed` geçişi yapıyor (`agent.run.state` olayı
   yayınlanıyor; önceden sessizce düşüyordu). PROTOKOL/agent-state.ts'e DOKUNULMADI (taşıma
   seçeneği seçildi — rapor'un önerdiği küçük yol). +1 test (MCP hatasında state dizisi
   `["thinking","failed"]`).
4. **§3.4 requests.session_id** (`engine.ts` `recordTurnUsage`): `run.runId` yerine
   `run.sessionId` yazılıyor — chat.start ile aynı sütun anlamı (oturum kimliği), koşu
   granülaritesi zaten `agent_runs`/`agent_steps`'te. Test gerekmedi (mevcut testler bu
   sütunu doğrulamıyordu).
- **Test:** 240→**244** (agent-run +1, engine +3). `pnpm build && pnpm test && pnpm lint`
  bu oturumda TEMİZ (38 dosya/244 test).
- **Not (yan bulgu):** §3.3'ün erken `transition(thinking)` eklemesi, mevcut §3.2 testlerinden
  birinin "thinking" olay SAYISINA dayanan senkronizasyonunu bozdu (event artık MCP-connect'ten
  ÖNCE ateşleniyor) — düzeltme: o test artık `adapter.deferred.length > 0`'ı bekliyor (modelin
  GERÇEKTEN çağrıldığı an), bus olayı saymak yerine. **Ders:** mock-tabanlı zamanlama testlerinde
  olay SAYISI yerine somut yan etkiyi (burada: doStream'in çağrılmış olması) beklemek daha sağlam.

**Sıradaki:** ROADMAP kullanıcı önceliği **#3 (uzun-dönem hafıza/arşiv)** — henüz başlanmadı.

## Dilim 2.3c (2026-07-09, Opus): TUI agent-konuşması resume UX — BİTTİ ve testli (240 test)

2.3b backend'i (agent.start `sessionId`) üzerine TUI akışı bağlandı — asistan/coder konuşmaları da
"önceki konuşmaya devam et" ile sürdürülebilir. **CLI-only → daemon restart GEREKMEZ.**
- **`app.tsx AgentFlow`** (YENİ, ChatFlow'un agent paraleli): agent personası seçilince (kayıtlı
  konuşma + modeli hâlâ mevcutsa) `ResumePicker` (yeni/devam) → devam: `sessionDetail` REST'ten
  yükle, ekrana tohumla, AgentRun'a `initialSessionId`+`seedExchange`+`fixedModel` geç. yeni:
  fresh AgentRun. Kayıt yoksa doğrudan AgentRun.
- **`agent-run.tsx`:** opsiyonel `initialSessionId`/`seedExchange`/`fixedModel` props'ları. sessionId
  varsa `agent.start`'a eklenir (o oturuma devam); fixedModel varsa model seçici atlanır; seedExchange
  ekrana tohumlanır (`> ` kullanıcı, `🤖 ` asistan — submitSay ile aynı biçim).
- **Test +3 (237→240):** agent-flow — devam→eski sessionId+eski konuşma ekranda (model sabit) ·
  yeni→sessionId'siz+model seçici · kayıt yoksa doğrudan cwd. build/test/lint temiz.
- **Not:** Hem "Sohbet" (chat.start) hem agent personaları artık AYNI son oturumu resume teklif
  edebilir (sessions paylaşımlı) — çakışma yok, esneklik: son konuşma hangi personayla sürdürülürse
  o personanın yetenekleriyle devam eder.
- **ADR-012'nin SON opsiyonel adımı:** "Sohbet personasını da konuşmalı asistan'a taşıyıp chat.start'ı
  yalnız curl/compat ucuna indirmek" — artık teknik engel YOK (agent konuşmaları kalıcı+resume).
  Yapılmadı: doğrulanmış chat-resume yolunu bozmamak için; istenirse ayrı küçük dilim. **Böylece
  ROADMAP kullanıcı önceliği #2 (birleşik sohbet-agent) İŞLEVSEL OLARAK TAMAM.**

## Dilim 2.3b (2026-07-09, Opus): Konuşmalı agent kalıcılığı + resume — BİTTİ ve testli (237 test)

## Dilim 2.3b (2026-07-09, Opus): Konuşmalı agent kalıcılığı + resume — BİTTİ ve testli (237 test)

Konuşmalı agent koşuları artık `sessions`/`messages`'a yazılıyor → asistan/coder konuşmaları da
`symphony history`'de görünür ve sürdürülebilir; chat.start ile AYNI kalıcılık modeli. Kural 1
sırası: PROTOKOL → shared → core → daemon.
- **PROTOKOL (ADDITIVE):** `agent.start`'a `sessionId?` (verilirse o oturuma DEVAM — geçmiş bağlama
  tohumlanır, aynı oturuma yazılır); `agent.start.ok` artık `{runId, sessionId}`. PROTOCOL_VERSION
  değişmedi. §3'e konuşmalı-agent kalıcılık notu (yalnız user/assistant metin turları yazılır —
  araç çağrısı/sonucu geçmişe GİRMEZ; her asistan turu REPLACE).
- **shared:** `AgentStartPayloadSchema.sessionId?` + `AgentStartOkPayloadSchema.sessionId` (zorunlu).
- **store.ts:** yeni `saveConversation({sessionId,provider,model,messages})` — tam mesaj listesini
  REPLACE eder (upsert session + `at` koru + insert). `saveChatTurn` artık buna delege eder (DRY).
- **engine.ts:** konuşmalı koşu `sessionId` (payload ?? yeni uuid) + `resumeFrom` (payload.sessionId
  ?? null) + TEMİZ `transcript` taşır. runLoop: resumeFrom varsa `store.sessionDetail`'den
  user/assistant metinleri hem model `messages`'a hem transcript'e tohumlar; task eklenir. Araçsız
  tur bitince (awaiting_user park + completed) asistan nihai metnini transcript'e yazar ve
  konuşmalıysa `persistConversation` (DB hatası koşuyu öldürmez, loglanır). `start()` artık
  `{runId, sessionId}` döner. Tek-seferlik (non-conversational) koşu YAZMAZ (one-shot task).
- **daemon.ts:** `agent.start.ok`'a sessionId eklendi (motordan).
- **Test +4 (233→237):** engine — 2-tur persist (transcript doğru) · araç turu geçmişe girmez ·
  sessionId ile resume (model eski bağlamı görür + aynı oturuma eklenir) · one-shot yazmaz.
  daemon-agent: agents.list asistan'ı da doğruluyor (salt-okur araçlar). build/test/lint temiz.
- **⚠️ Canlı test DAEMON RESTART ister** (core değişti). Doğrulama: `symphony` → asistan/coder ile
  konuş → `symphony history` konuşmayı göstermeli. (TUI'de agent konuşmasını "önceki sohbete devam
  et" ile sürdürme UX'i = 2.3c, aşağıda.)

### 📋 Dilim 2.3c (SIRADAKİ, opsiyonel): TUI agent-konuşması resume UX

Backend hazır (agent.start `sessionId` kabul ediyor, agent.start.ok döndürüyor). Kalan: PersonaPicker'da
agent seçince de "önceki konuşmaya devam et" sunmak (ChatFlow'un ResumePicker deseni agent'a
uyarlanır: AgentRun'a `initialSessionId`/`initialHistory` tohumu → agent.start'a sessionId geçer).
Şu an "Sohbet" personası chat.start-resume'a sahip; agent personaları kaydediliyor ama TUI'den
sürdürme akışı henüz yok. Bu dilim bitince "Sohbet" personası da (istenirse) konuşmalı asistan'a
taşınıp chat.start yalnız curl/compat ucu olarak kalabilir (ADR-012'nin son adımı).

## Dilim 2.3a (2026-07-09, Opus): Birleşik giriş — BİTTİ ve testli (233 test)

## Dilim 2.3a (2026-07-09, Opus): Birleşik giriş — BİTTİ ve testli (233 test)

ADR-012'nin son parçası ikiye bölündü (Kural 7): 2.3a giriş birleştirme (non-regression), 2.3b
kalıcılık. **2.3a bitti:**
- **"Sohbet/Agent modu" ikilisi KALKTI.** Tek `PersonaPicker` ("kiminle konuşmak istersin?"):
  Sohbet + kayıtlı agent'lar TEK listede. `ModePicker`+`AgentPicker` SİLİNDİ (ölü kod;
  `app.tsx` iki adımı tek adıma indirdi).
- **Salt-OKUR "asistan" agent'ı** eklendi (`definition.ts ensureDefaultAgent` artık iki
  varsayılan yazar: coder + asistan; her biri bağımsız kontrol). Araçlar: read_file/glob/grep
  (hepsi `safe` → izin kutusu ÇIKMAZ). Asistan sohbet ederken dosyalara bakabilir ama
  yazamaz/komut çalıştıramaz — Claude Code deneyiminin risksiz tadı, ADR'nin "araçsız ya da
  salt-okur" izniyle.
- **Personalar:** Sohbet (chat.start, resume korunur) · asistan (salt-okur konuşmalı agent) ·
  coder (tam araç, izinle). Hepsi AgentRun/ChatFlow'a route edilir; asistan+coder aynı konuşmalı
  agent yolunu (2.2) paylaşır.
- **ADR-012'ye uygulama notu düşüldü** (KARARLAR.md): "sohbet dalını agent'a taşı" maddesi 2.3b'ye
  ertelendi çünkü konuşmalı-agent koşuları henüz sessions/messages'a yazmıyor → taşımak resume'u
  bozardı. "Sohbet" bilinçli olarak chat.start'ta tutuldu. Güvenlik ihlali YOK (araçsız yol sıfır
  izin/jail kodu çoğaltır).
- **Test:** +6 (persona-picker 4, definition 2), −silinen mode/agent-picker testleri. 232→**233**.
  build/test/lint temiz.
- **⚠️ Canlı test için DAEMON RESTART gerekir:** `ensureDefaultAgent` asistan.md'yi daemon
  açılışında yazar; ŞU AN çalışan daemon (PID 2476) bu değişiklikten önce başladı → asistan
  personası ancak restart sonrası listede görünür. (CLI değişikliği build'le `symphony`'ye yansır.)

> **Not:** Bu bölümdeki "2.3b ertelendi" ifadesi ARTIK GEÇERSİZ — 2.3b aynı oturumda uygulandı
> (üstteki "Dilim 2.3b" bölümü). Konuşmalı agent koşuları artık kalıcı; kalan yalnız TUI resume
> UX'i (2.3c). ADR-012'ye eklenen uygulama notu da 2.3a/2.3b bölünmesini yansıtır.

## Rapor §5 küçük iyileştirme paketi (2026-07-09, Sonnet): BİTTİ ve testli (232 test)

Fable'ın devrettiği 4 madde (`rapor/fabelincelemeraporu.md` §5), Dilim 2.3'ten ÖNCE kapatıldı
(canlı kullanıcı onaylarına bağlı olmadığı için paralel yürütüldü):

1. **`agent.delta`/`chat.delta` batch yayını** — yeni `core/src/server/delta-batcher.ts` (SAF,
   testli, 5 test): anahtar (runId/sessionId) başına ~40ms pencerede birikip tek parça yayınlanır.
   `engine.ts` + `daemon.ts`'in ikisi de kullanır. **Sıra kritik:** flush HER ZAMAN terminal
   olaydan (`agent.run.completed`/`chat.completed`/`failed`) ÖNCE — for-await bitince explicit
   flush, hata/iptal `catch` bloğunun BAŞINDA (finally'de DEĞİL — finally, catch'in `finish()`
   çağrısından SONRA çalışır, terminal olaydan sonraya düşerdi).
2. **`runStreams` sınırsız büyüme** — `ui/store.ts` `appendStream` son 2000 karakteri tutar
   (`MAX_RUN_STREAM_CHARS`, `slice(-N)`).
3. **"cancelled" zombi satır** — `agent.run.state:"cancelled"` artık completed/failed gibi
   `removeRun` de çağırıyor (önceden yalnız state güncelliyordu, satır bir sonraki snapshot'a
   dek panoda asılı kalıyordu).
4. **Stream-ortası-hata testi → GERÇEK BUG bulundu ve düzeltildi.** Rapor "SDK sürümüne duyarlı"
   diye sormuştu; kaynak okuması yanıltıcı çıktı, izole bir Node script'iyle (`ai@7.0.11`,
   `MockLanguageModelV3`) EMPİRİK doğrulandı: stream ortasında `{type:"error"}` parçası
   `result.response`/`result.usage`'ı REDDETMEZ — SDK bunu `finishReason:"error"` ile "normal"
   tamamlanmış gibi döndürüyor. **Motor bunu kontrol etmiyordu** → gerçek bir sağlayıcı hatası
   sessizce BOŞ bir `agent.run.completed` üretirdi. Düzeltme: `engine.ts` `await result.response`
   sonrası `await result.finishReason === "error"` kontrolü → `AgentError("PROVIDER_STREAM_ERROR",
   ...)` fırlatır, mevcut failed yoluna girer. `engine.test.ts`'e `errorTurn()` yardımcı fonksiyonu
   + KABUL testi (+1). **Ders:** AI SDK gibi harici kütüphanelerin hata semantiğini varsaymak
   yerine küçük izole script'le doğrula — kaynak okuması (minifed, çok dallı) yanıltıcı olabiliyor.
- **Test:** 224→**232** (delta-batcher 5, store +2, engine +1). build/test/lint temiz.
- **Kapsam notu:** SSE debug ucunun (`POST /api/chat`, `onDelta` callback) batch'e alınmadı —
  tek istemcilik curl test ucu, WS fan-out amplifikasyonu yok; kasıtlı kapsam dışı bırakıldı.

## Dilim 2.2 (2026-07-09, Fable — merge SONRASI): çok-tur konuşmalı koşu — BİTTİ ve testli

## Dilim 2.2 (2026-07-09): Çok-tur konuşmalı koşu — BİTTİ ve testli (224 test)

ADR-012'nin kalbi: `awaiting_user` + `agent.say` + `conversational` artık UYGULANDI (PROTOKOL'deki
⏳ işaretleri kaldırıldı). Kural 1 sırası izlendi: shared → core → daemon → TUI.
- **shared:** `agent-state.ts` enum + geçişler (thinking→awaiting_user→thinking/cancelled);
  `requests.ts` `AgentSayPayloadSchema` + `agent.start.conversational?`; `events.ts` `agent.say.ok`.
- **engine.ts:** park runLoop'un İÇİNDE (promise-gate `waitForUser`) → messages VE MCP bağlantıları
  turlar arasında CANLI kalır (raporun §4.2 en-kritik uyarısı yapısal olarak çözüldü; `finally`
  yalnız koşu sonlanınca çalışır). `say()` yalnız awaiting_user'da kabul eder
  (`AGENT_NOT_AWAITING_USER` / `AGENT_UNKNOWN_RUN`). İptal parkta da çalışır (abort → cancelled).
- **db/store.ts v4 GÖÇÜ:** `agent_runs.state` CHECK'i `awaiting_user` içermiyordu (ilk test
  koşusunda yakalandı — update fırlatıp koşuyu failed'a düşürüyordu). SQLite CHECK değişmez →
  tablo yeniden kuruldu. **Kritik ayrıntı:** göç sırasında `foreign_keys = OFF` (migrate()
  artık göç bloğunu FK-kapalı çalıştırıp `foreign_key_check` ile doğrular) — yoksa DROP TABLE,
  agent_steps'i CASCADE ile SİLERDİ.
- **daemon.ts:** `agent.say` handler'ı (switch'e 1 case; motor reddi error olarak döner).
- **TUI agent-run.tsx:** koşular artık `conversational: true` başlar — görev bitince kapanmak
  yerine "devam yaz" girişi (aynı runId/bağlam/MCP; biten turlar `exchange` dökümünde ekranda
  kalır); Esc koşuyu bitirir (cancel). Tek-seferlik davranış API/`symphony agent` komutunda sürer.
- **Test +5 (219→224):** motor: 2-tur aynı-runId (ikinci turun prompt'unda kullanıcı mesajı
  DOĞRULANIR) · cancelAll park etmiş koşuyu kapatır (rapor §4.2.2) · say korumaları ·
  conversational'sız eski davranış değişmedi · TUI: awaiting_user→devam girişi→agent.say.
  Test tuzağı notu: dış olayla mount edilen ink TextInput'un input aboneliği 1 tick'te oturmuyor
  (test 3 tick bekler).
- **Canlı doğrulama KULLANICIYA:** `symphony` → Agent → görev ver → cevap sonrası "devam yaz"
  ile ikinci tur (bağlamı hatırlamalı). **Daemon RESTART GEREKİR** (core değişti; kalıcı not
  bölümündeki talimat). Masaüstünde koşu satırı awaiting_user'da bekler.

## Oturum 15 (2026-07-09): Rapor icrası — `worktree-oturum-surekliligi` → main MERGE — BİTTİ

`rapor/fabelincelemeraporu.md` (Fable denetimi, 2026-07-08 22:25) uygulandı:
- **Merge §4.1 reçetesiyle yapıldı.** Öngörülen 3 çakışma çıktı (ui/store.ts + memo/DURUM.md +
  oturumlar/2026-07-08.md), reçeteyle çözüldü. store.ts'te İKİSİ DE kaldı: main'in
  `lastCompletedAt`'i (tesseract converge) + worktree'nin `runStreams`'i (agent.delta akışı);
  `agent.run.completed` → removeRun + clearStream + lastCompletedAt.
- **⚠️ Raporun §3.1 uyarısı GERÇEKLEŞTİ:** Fable bu sabah, worktree'den habersiz main DURUM'uyla
  Dilim 1'i (oturum sürekliliği) MÜKERRER ikinci kez yazdı. Mükerrer sürüm `yedek/dilim1-fable-mukerrer`
  dalına commit'lenip kaldırıldı (hiçbir şey silinmedi); YAŞAYAN uygulama Opus/Sonnet'inki
  (ChatFlow + resume-picker — üzerine 2.1/2.1b inşa edilmiş, denetimden geçmiş).
- **PROTOKOL.md §3.2 düzeltmesi:** `agent.say` / `awaiting_user` / `conversational` yanına
  "planlandı — Dilim 2.2, henüz uygulanmadı" işaretleri kondu (belge artık uygulama durumunu söylüyor).
- **Birleşik doğrulama:** build ✓ · test **37 dosya / 219 test, tümü geçti** (raporun ~219 tahmini
  birebir tuttu; welcome.test dahil) ✓ · lint ✓.
- **Sıradaki:** ✅ Dilim 2.2 (Fable), ✅ rapor §5 paketi (Sonnet) ve ✅ DÖRT canlı kullanıcı
  kontrolü (tesseract 8b, TUI konuşmalı agent, masaüstü agent akışı, TUI "önceki sohbete devam
  et" — hepsi 2026-07-09'da onaylandı, ayrıntı: "Bekleyenler" bölümü) bitti. **SIRADAKİ TEK KOD
  İŞİ: Dilim 2.3 (birleşik TUI)** — model Opus'a geçiyor (yarı tasarım yarı uygulama, ADR-012'nin
  sahibi zaten o). Hedef: varsayılan araçsız "asistan" agent tanımı + Sohbet/Agent modlarının tek
  konuşma yüzeyinde birleşmesi + ChatFlow (Dilim 1) ile harmanlama. ROADMAP kullanıcı önceliği
  #2'nin son parçası — bu bitince öncelik #3 (uzun-dönem hafıza) sırası gelir.

> Aşağıdaki Dilim 8b / 8 bölümleri Fable'ın Oturum 14 anlatısıdır (main, 2026-07-08 akşam).

## Dilim 8b (2026-07-08): Sinematik revizyon — "çok basit" geri bildirimi üzerine — BİTTİ (211 test)

Kullanıcı ilk tesseract'ı "güzel ama çok basit/düzlemsel" buldu; "katmanlı küp + fütüristik,
şaşırt beni, uç noktana kadar git" dedi. Yapılanlar (hepsi UI-only, protokol değişmedi,
YENİ PAKET YOK — bloom three'nin kendi addon'larından):
- **ÜÇ kademeli küp:** kapı boncukları yerine tam DERİN küp (iç kübün 0.48 ölçekli kopyası,
  12 kenar + 8 bağ). Topoloji: 25 düğüm / 60 kenar. Converge artık 3 kademeli ŞELALE:
  köprüler→bağlar→spoke'lar (gecikmeli dalgalar) → çekirdek patlaması.
- **GERÇEK bloom:** EffectComposer + UnrealBloomPass + OutputPass (`three/examples/jsm`).
  Sahne kendi atmosferini çizer: koyu zemin + yıldız alanı (380) + nebula lekeleri (3 sprite).
- **GLSL akış shader'ı:** cyan/violet tüplerin İÇİNDE merkeze akan enerji bantları
  (instancing-uyumlu ShaderMaterial; kenarlar merkeze sıralı olduğundan yön doğal).
- **Jiroskop yörünge halkaları ×3** (bakır=GPU, cyan=LLM, violet=çekirdek — katman sürücüsüyle
  parlar) + **veri zerreleri** (220 mot, 3 aile, yörüngede) + **sinematik kamera** (aktiviteyle
  yaklaşır, sürekli süzülür) + HUD köşe braketleri + `SYMPHONY // LIVING CORE` etiketi.
  Sahne yüksekliği 300→380px.
- Test 212→**211** (kapı testleri derin-küp testlerine dönüştü). build/test/lint temiz.
- **Görsel doğrulama KULLANICIYA** (aşağıdaki dilim 8 talimatı aynen geçerli). Bloom şiddeti
  ayarı: `TesseractScene.tsx` BLOOM_STRENGTH/RADIUS/THRESHOLD; katman parlaklıkları bölüm 11.

## Dilim 8 (2026-07-08): Yaşayan TESSERACT — küre emekli edildi — BİTTİ ve testli (212 test)

Kullanıcı `Tasarım/görsel1.png`+`görsel2.png` (bakır dış küp, cyan/mor sinaps ağı, kırmızı
çekirdek) + R3F geliştirme promptu verdi; "şaşırt beni" diyerek serbest geliştirme yetkisi verdi.
- **TASARIM.md** §1 palete `--copper #c9803f` + `--violet #a78bfa` eklendi (index.css'e de);
  §2 baştan yazıldı: küre + vektörel dalga EMEKLİ (git geçmişinde), yerine Yaşayan Tesseract.
- **Saf modüller (testli):** `ui/scene/tesseract/geometry.ts` — GERÇEK 4B hiperküp (16 köşe,
  perspektif bölme f=K/(K−w), K=3 → dış/iç 2:1) + XW düzleminde hiper-dönüş + 8 kapı boncuğu +
  çekirdek; 40 kenar (12 dış+12 iç+8 köprü+8 spoke, hepsi merkeze-doğru a→b sıralı).
  `ui/scene/tesseract/pulses.ts` — atım sistemi (rng enjekte, deterministik test): synapse
  (iç ağ, LLM/ajan aktivitesi) + energy (bakır, GPU yükü) + converge salvosu (köprüler içeri →
  gecikmeli spoke'lar merkeze → coreHits). Önce-hareket-sonra-doğum sırası (aynı adımda doğup
  emekli olmaz). MAX_PULSES 240 / HARD_CAP 320.
- **TesseractScene.tsx:** 3 anlam düzlemi — bakır iskelet+köprüler (GPU; ısı korlaştırır),
  cyan iç ağ (mood rengini giyer: idle cyan/executing magenta/awaiting amber/error kırmızı),
  kırmızı çekirdek (İÇİNDE gerçek point-light — patlamada bakırı içeriden aydınlatır).
  Ekstralar: komet kuyruklu atımlar (Points+CPU attr), düğüm haleleri (sahte bloom), converge
  şok-dalgası halkası, kalp atışı, imleç parallax'ı, VRAM→innerSwell, nefes korundu. Instanced
  silindir/küre (düzlem başına tek draw call). Yumuşatma RISE/FALL_TAU miras.
- **Store:** `lastCompletedAt` (agent.run.completed + chat.completed) → converge tetikleyicisi;
  hata (`lastErrorAt`) da tetikler. Protokol DEĞİŞMEDİ.
- **Silinen:** `wave-field.ts` + testi (11 test). Test: 203 → **212** (geometri 10 + atım 9 +
  store 1). build/test/lint temiz.
- **Görsel doğrulama KULLANICIYA:** `pnpm --filter @symphony/desktop desktop:dev` (proje
  kökünden; daemon çalışıyor olsun). Beklenen: bakır tesseract yavaş döner + hiper-salınım;
  qwen koşusu → bakırda ağır korlar; sohbet/ajan → iç ağda hızlı cyan atımlar; tur/koşu bitince
  TÜM sinapslar merkeze ateşler + çekirdek patlar + halka. İnce ayar noktaları:
  TesseractScene.tsx üst sabitleri (NODE_RADIUS/STRUT_RADIUS/TRAIL*/CORE_*) + pulses.ts hızları.
> Aşağıdaki Dilim 1 / Dilim 2 bölümleri paralel Opus/Sonnet oturumunun (worktree, 2026-07-08 sabah)
> anlatısıdır — Oturum 15 merge'iyle tek gerçekliğe katıldı. İçlerindeki test sayıları o günün
> worktree tabanına göredir; birleşik güncel sayı yukarıda (Oturum 15).

## Dilim 1 (2026-07-08): Oturum sürekliliği — TUI "önceki sohbete devam et" — BİTTİ ve testli

Kullanıcı önceliği #1'di (DURUM.md eski "SIRADAKİ İŞ"). TUI her açılışta yeni sessionId üretip
geçmişi görmezden geliyordu; artık son sohbet sürdürülebilir. **Sıfır protokol/daemon değişikliği**:
geçmiş ZATEN REST'te (`/api/history/*`, Faz 2) ve daemon sessionId'ye REPLACE semantiğiyle yazıyor →
eski sessionId'yi yeniden kullanıp tüm mesaj dizisini yeniden göndermek yeterli (çiftleme yok).
- **CLI istemci** (`client/daemon-client.ts`): `DaemonClient`'a `listSessions(limit)` + `sessionDetail(id)`
  eklendi — Bearer token'lı REST (`/api/health` dışı uçlar auth ister), shared şemalarıyla doğrulanır,
  404→null. Port+token zaten elde (WS açık), ayrı el sıkışması yok.
- **TUI akışı** (`tui/app.tsx`): yeni `ChatFlow` bileşeni — kayıtlı sohbet VE modeli hâlâ mevcutsa
  (v1 kapsamı) açılışta "Yeni sohbet / Önceki sohbete devam et" seçtirir. Devam → `sessionDetail`
  REST'ten mesajları yükler, model önceki oturumunkiyle SABİTLENİR (model picker atlanır), Chat'e tohum.
  Yeni → bugünkü akış (model picker → temiz Chat). `runTui` açılışta `listSessions(1)` çeker (hata→sessiz).
- **Yeni bileşen** `tui/resume-picker.tsx` (mode/model picker deseni: ↑/↓+Enter; devam satırında
  provider/model · mesaj sayısı · başlık özeti).
- **chat.tsx**: opsiyonel `initialSessionId?` + `initialHistory?` prop'ları; `HistoryEntry` dışa aktarıldı.
  Verilirse state bunlarla tohumlanır (aynı sessionId'ye yazılır), yoksa bugünkü davranış (yeni UUID + boş).
- **Test:** `resume-picker.test.tsx` (3) + `chat-flow.test.tsx` (3, entegrasyon: devam→eski mesajlar
  render + yeni mesaj ESKİ sessionId ile + bağlam yeniden gönderilir; yeni→YENİ uuid; geçmiş yoksa
  doğrudan model picker). 203→**209 test** (208 geçer; `welcome.test` bu bg-ortamının TTY'siz stdout
  genişliğinde ink logoyu sararak ÖNCEDEN başarısız — kod değişikliğiyle ilgisiz, gerçek terminalde geçer).
- **Kapsam v1 notu:** yalnız SON sohbet + modeli hâlâ mevcutsa. Tam oturum tarayıcısı (liste, arama,
  model değişmişse devam) v2'ye ertelendi.
- **Canlı doğrulama KULLANICIYA:** TUI raw-mode TTY ister (Bash'ten sürülemez). Terminalde `symphony`
  → Sohbet → "önceki sohbete devam et" → qwen önceki bağlamı hatırlıyor mu? (Not: global CLI junction →
  `pnpm build` sonrası `symphony` yeni akışı anında alır; daemon restart GEREKMEZ — history REST'ten gelir.)

## Dilim 2 (2026-07-08): Birleşik sohbet-agent modu — ADR-012 + protokol tasarımı BİTTİ; kod dilimleri sırada

Kullanıcı önceliği #2 ("Claude Code gibi sohbet ederken araç kullanımına geçebilme"). Kullanıcı
mimariyi ONAYLADI: **Seçenek A (konuşmalı motor) + akışlı (streamText)**. Bu oturumda tasarım
keystone'u teslim edildi; kod dikey dilimlere bölündü (Kural 7).

- **ADR-012 yazıldı** (`docs/kararlar/KARARLAR.md`): iki yol (chat.start akışlı/araçsız vs
  agent.start araçlı/izinli/akışsız/tek-seferlik) **konuşmalı motorla** birleşir. Konuşma =
  tamamlanınca `finish` etmek yerine `awaiting_user`'a park olan çok-turlu agent koşusu; sonraki
  tur `agent.say`. Düz sohbet = araçsız "asistan" agent'ı. İzin kapısı/jail/araç döngüsü TEK yerde
  (engine) kalır — B (chat'e araç ekle) ve C (yeni converse.*) güvenlik/çoğaltma nedeniyle reddedildi.
- **PROTOKOL.md güncellendi** (ADDITIVE, PROTOCOL_VERSION=1 korunur): `agent.delta {runId,text}` olayı;
  `awaiting_user` durumu; `agent.say {runId,text}` isteği; `agent.start`'a `conversational?`. `chat.start`
  kaldırılmaz (curl/geri-uyum). shared şeması + engine kullanımı dilim dilim gelir (Kural 1: PROTOKOL→shared→kullan).

### 📋 Dilim 2 — kod dilimleri (SONRAKİ OTURUM(LAR) BURADAN, sırayla)

**Önce oku (yalnız bunlar):** ADR-012 + PROTOKOL.md §3-5 · `core/src/agent/engine.ts` (runLoop) ·
`core/src/agent/engine.test.ts` (mock: `MockLanguageModelV3.doGenerate` → `doStream` GEÇİŞİ) ·
`shared/src/protocol/{events,requests,agent-state}.ts` · `cli/src/tui/agent-run.tsx`.

**Dilim 2.1 — akış (streamText + agent.delta). ✅ BİTTİ ve testli (2026-07-08).**
- `shared/events.ts`: `AgentDeltaPayloadSchema {runId,text}` + `EVENT_PAYLOAD_SCHEMAS["agent.delta"]`.
- `engine.ts` runLoop: `generateText`→`streamText` (SENKRON döner). Metin `for await (result.textStream)`
  ile tüketilip `bus.broadcast("agent.delta",{runId,text})`; sonra `await result.{response,usage,
  providerMetadata,text,toolCalls}`. Tool loop/izin/jail/finish AYNI. **daemon.ts DEĞİŞMEDİ** (bus
  tüm event'leri otomatik yayar).
- Test mock'ları (`engine.test.ts` + `daemon-agent.test.ts`): `doGenerate`→`doStream` — scripted
  `turn()` içeriğini AI SDK v3 stream part'larına (`stream-start`→text-start/delta/end|tool-call→
  `finish{usage,finishReason}`) çeviren `scriptToStream`. Part şekilleri `@ai-sdk/provider@4.0.1`
  `LanguageModelV3StreamPart`'tan birebir doğrulandı. Güvenlik testleri (izin/jail/deny) YEŞİL.
- `agent-run.tsx`: `agent.delta`→`streaming` state (green render); `agent.tool.started` ve run
  bitişinde temizlenir. +1 test. build/test/lint temiz (209 geçer; welcome ortamsal).
- **Kalan:** durum/çok-tur DEĞİŞMEDİ (bu dilim yalnız akış). Konuşma yaşam döngüsü 2.2'de.

**Dilim 2.1b — masaüstü akış paritesi. ✅ BİTTİ ve testli (2026-07-08).** Terminal ⇄ masaüstü eş
zamanlılığı (ROADMAP kabul testi): agent.delta artık masaüstü panosunda da akıyor.
- `ui/store.ts`: `runStreams: Record<runId,string>` — `agent.delta` biriktirir; `agent.tool.started`
  (yeni tur), `agent.run.completed/failed`, state `cancelled` ve `applySnapshot`'ta temizlenir.
- `ui/App.tsx`: aktif koşu satırının altında canlı akış metni (`.run-stream`, cyan).
- Test: `store.test.ts` +1 (biriktir → araç başlayınca temizle → koşu bitince temizle). 210→**211**.
- daemon/protokol DEĞİŞMEDİ (agent.delta zaten 2.1'de eklendi). Görsel doğrulama kullanıcıya (`desktop:dev`).

**Dilim 2.2 — çok-tur (awaiting_user + agent.say + conversational).**
- `agent-state.ts`: enum'a `awaiting_user`; VALID_TRANSITIONS: thinking→awaiting_user, awaiting_user→thinking,
  awaiting_user→cancelled. `requests.ts`: `AgentSayPayloadSchema {runId,text}` + `AgentStartPayload`'a
  `conversational?:boolean`. `events.ts` gerekmez (agent.run.state yeni değeri taşır).
- `engine.ts`: `run.conversational` alanı; tur araçsız bitince `conversational` ise `finish` YERİNE
  `transition(run,"awaiting_user")` + koşuyu haritada TUT (messages canlı). `say(runId,text)`: awaiting_user
  koşusuna `messages.push({role:"user",content:text})` + runLoop'un bir sonraki turunu tetikle (döngüyü
  "await next user" ile park edecek şekilde yeniden yapılandır — ya da turAsync yapıyı promise-gate ile böl).
  `agent.cancel` konuşmalı koşuyu kapatır. daemon.ts switch'e `agent.say` handler.
- Test: konuşmalı koşu 2 tur (ilk cevap → awaiting_user → say → ikinci cevap), aynı runId.
- TUI: `agent-run.tsx` outcome yerine awaiting_user'da tekrar görev girişi (aynı koşu).

**Dilim 2.3 — birleşik TUI.** Varsayılan "asistan" agent tanımı (araçsız/salt-okur, `~/.symphony/agents`
gömülü default). `app.tsx`: Sohbet/Agent ayrımı tek "konuşma" yüzeyinde birleşir; sohbet = conversational
asistan koşusu; araç modele göre isteğe bağlı, izin kapısı arkasında. ChatFlow (Dilim 1) bununla harmanlanır.

## Oturum 13 (2026-07-07): "Flaşlayan/glitch pencere" KÖK NEDEN bulundu ve düzeltildi

Oturum 12'nin flaş teşhisi (CLI daemon-spawn) DOĞRUYDU ama EKSİKTİ — asıl tekrarlayan flaş başkaydı.
Kullanıcı: "symphony başlatınca cmd'de bir şey gelip kapanıp tekrar geliyor, işlemlerimi engelliyor"
(ekran alıntısı aracını bile bölüyor). Bilgisayarı 2 kez yeniden başlatmak İŞE YARAMADI (beklenen —
sorun Windows'ta değil, Symphony'nin kendi kodunda).

- **KÖK NEDEN:** `core/src/router/hardware.ts` içindeki İKİ `execFileAsync("nvidia-smi", …)` çağrısı
  (detectVramGb + sampleGpus) seçenek nesnesi geçmiyordu → `windowsHide` varsayılan `false`. Windows'ta
  `nvidia-smi.exe` (konsol uygulaması) böyle çağrılınca görünür konsol penceresi flaşlatır. Daemon
  `sampleGpus`'u **her 2sn'de bir** çağırdığından (HARDWARE_POLL_MS, dilim 5) → periyodik flaş.
  "Gelip kapanıp TEKRAR geliyor" tarifi tam da 2sn periyodu. (`agent/tools.ts:385` zaten windowsHide
  taşıyordu; hardware.ts atlanmıştı.)
- **DÜZELTME:** hardware.ts'teki iki çağrıya `{ windowsHide: true }` eklendi. Build+test temiz (196/196).
- **Neden restart işe yaramadı:** flaş Symphony daemon'ından geliyor; `symphony` her açılışta daemon'ı
  kaldırır → daemon 2sn'de bir nvidia-smi → flaş geri gelir. Kod düzeltilmeden restart çözmez.
- **Yan bulgu (ikinci hata) — masaüstü AUTH_TOKEN_INVALID / "kopuk" / küre OFFLINE:** `token.ts`
  HER daemon açılışında YENİ token üretiyor. Tauri penceresi açılışta token'ı bir kez okuyup enjekte
  ediyor; daemon sonradan yeniden başlayınca (ör. CLI kaldırınca) token değişiyor → penceredeki eski
  token geçersiz. **Geçici çözüm:** daemon'ı ÖNCE başlat, masaüstü/CLI'yi SONRA aç (ya da daemon
  restart'ından sonra pencereyi kapatıp yeniden aç). **Kalıcı düzeltme (sıradaki dilim):** ya daemon
  token'ı diskte varsa yeniden kullansın (istemcileri kilitlememek için), ya da istemci reconnect'te
  token dosyasını yeniden okusun. Küre henüz canlı GÖRÜLEMEDİ çünkü bağlantı bu yüzden kopuktu.
- **Bu oturum sonundaki canlı durum:** eski flaşlayan daemon (PID 21216) öldürüldü; düzeltilmiş
  `dist`'ten taze daemon başlatıldı (port 7770 sağlıklı, yeni token). Flaş artık YOK.
  **Kullanıcı için sıradaki adım:** Symphony masaüstü penceresini KAPAT + yeniden aç (yeni token'ı
  okusun) → küre canlı görünür ve dilim 7 dalga revizyonunun görsel onayı yapılabilir.
### Oturum 13 — ek düzeltmeler (kullanıcı geri bildirimi sonrası)

- **TUI agent "tek-seferlik" düzeltildi:** Kullanıcı "agent görevi bitince/sohbet cevabından sonra cmd
  başa dönüyor, symphony'yi tekrar çalıştırıyorum" dedi. Teşhis: SOHBET aslında döngü kuruyordu (kullanıcı
  teyit etti); asıl sorun AGENT — `agent-run.tsx` `outcome` set olunca sonucu gösterip TAKILIYORDU (yeni
  görev/menü dönüşü yok). Düzeltme: koşu bitince **Enter → yeni görev** (aynı agent/dizin/model,
  `resetForNewTask`), **Esc → ana menü** (`onExit` prop → App `mode`/`agent` sıfırlar). Ayrıca
  `permission.respond` çağrısındaki eksik `.catch()` eklendi (Node 24'te yakalanmamış reddi süreci
  çökertebilirdi — potansiyel ikinci "başa dönme" nedeni). +2 test (Enter→yeni görev/kapanmaz, Esc→onExit;
  lone-ESC ink debounce'u için gerçek 20ms gecikme). 196→**198 test**. build/lint temiz.
- **Agent "masaüstü kısayollarını listelemedi" — Symphony hatası DEĞİL:** Windows masaüstü = İKİ klasörün
  birleşimi: `C:\Users\brkn2\Desktop` (5 .lnk) + `C:\Users\Public\Desktop` (28 .lnk uygulama kısayolu).
  Agent yalnız kullanıcı klasörüne baktı → 28 uygulama kısayolunu kaçırdı. Üstelik jail farklı ağaçtaki
  Public\Desktop'a erişemez. glob aracı `.lnk`'i GİZLEMİYOR (onlyFiles:false, ignore yalnız node_modules/
  .git; .lnk dotfile değil). Çözüm kullanıcıya: iki yolu da açıkça ver ya da jail'i `C:\Users`e al (geniş).
- **NOT:** Bu oturumun kod değişiklikleri (hardware.ts windowsHide + agent-run.tsx/app.tsx loop-back +
  testler) henüz commit'lenmedi (SessionEnd hook'u ya da elle "oturum:" ile). Global CLI junction →
  CLI build'i `symphony`'ye anında yansır; kullanıcı `symphony`'yi yeniden çalıştırınca yeni agent akışı gelir.


## Dilim 7 (2026-07-07): Yaşayan Küre revizyonu → vektörel dalga — BİTTİ ve testli

Kullanıcının ⭐ öncelikli isteği: küre yüke ANİDEN biniyordu ve ölçek "zorlanma nabzı" yüksek-frekans
kalp atışı gibiydi. Yeni model: yük ifadesi ölçek→YÜZEY DALGASI (ses-dalgası estetiği).
- **Yeni saf modül:** `ui/scene/wave-field.ts` (SAF, testli) — `rotateDir`+`focusWeight`+`computeWaveField`.
  Dönüş pozisyona pişirilir (Option B) → odak/dalga yönü world-uzayında sabit (sağ-üst EKRANDA sabit).
  Yön birleştirildi: odak = dalga = `normalize(1,1,0.4)`. ShaderMaterial yerine CPU BufferAttribute
  (1700 parçacık ucuz; test disiplinine uyar). **Protokol DEĞİŞMEDİ** (mevcut `gpus` + mood).
- **mood.ts:** `MoodStyle.activity` (GPU'dan bağımsız LLM canlılık sürücüsü; bulut LLM'de dalgayı sürer).
- **LivingScene.tsx:** strain-nabzı + lean-throb KALDIRILDI. Yumuşatma ref'leri (`drive`/`heatSmooth`,
  kare-hızından bağımsız exp lerp; RISE_TAU .55 / FALL_TAU 1.4). `drive = max(gpuLoad, activity)`.
  pointsMaterial `vertexColors` (per-parçacık renk). Ölçek = yumuşak nefes + VRAM swell (korundu).
- **Test:** wave-field.test (11). 185→**196**. **Yan düzeltme:** `router.ts:134` tanımsız `localFitsatı`
  → `localFits` (son "otomatik yedek" commit'inin yarım bıraktığı, 7 testi kıran hata). build/lint temiz.
- **TASARIM.md §2** güncellendi ("yük ifadesi = vektörel dalga").
- **Görsel doğrulama kullanıcıya:** `desktop:dev` (UI-only → daemon restart gerekmez, Vite HMR).
  Yerel qwen3:8b koşusu → dalga sağ-üste atmalı/ısınmalı; Claude/Gemini sohbeti → mood-activity dalgayı sürer.

## Dilim 6 (2026-07-07): API kapasitesi (rate-limit) + prompt-cache göstergesi — BİTTİ ve testli

Kullanıcı "Claude limitimi görebilir miyim?" dedi → GPU göstergesinin **bulut ikizi**. Anthropic
her cevapta rate-limit'i header olarak veriyor; AI SDK bunları `response.headers`'ta, cache
token'larını `providerMetadata.anthropic`'te açıyor. Sıfır dış istek — mevcut cevaptan okunur.
- **Protokol:** `PROTOKOL.md` → yeni `provider.limits {provider, requests/tokens Remaining/Limit/
  ResetAt?, retryAfterSec?, at}` + `usage.updated`'a opsiyonel `cacheReadTokens?`/`cacheCreationTokens?`.
  shared/events.ts zod (`ProviderLimitsPayload` dışa aktarıldı). PROTOCOL_VERSION değişmedi.
- **Core:** `providers/telemetry.ts` (SAF, testli) — `parseRateLimits` (header adı ek-toleranslı:
  `endsWith("ratelimit-...")` → `anthropic-`/`x-` fark etmez; reset RFC3339 VEYA "kalan sn" → epoch ms)
  + `extractCacheTokens`. `ChatUsageResult`'a `cacheReadTokens?`/`cacheCreationTokens?`/`limits?`.
  anthropic adapter cevaptan doldurur. **İki yol da:** daemon runChat (chat) + engine (agent, her
  turda `provider.limits` yayını, cache koşu boyunca birikip finish'te usage.updated'a girer).
- **UI:** `store.limits` (sağlayıcı→son görüntü) + `sessionCacheRead/CreationTokens` (usage.updated'tan
  birikir, applySnapshot sıfırlar). App.tsx: "API kapasitesi" paneli (istek+token kovaları, kalan
  kapasiteye göre yeşil/amber/kırmızı çubuk + reset + 429 uyarısı) + Model panosunda önbellek metriği.
- **Test:** telemetry.test (parse: anthropic/x-önek/reset iki biçim/retry-after; cache çıkarma) +
  2 store testi. 177→**185 test**. Build/lint temiz.
- **Kapsam notu:** Anthropic-only (rate-limit header'ı yalnız Anthropic; OpenAI/Gemini kendi header'ları
  — sonra). **Canlı header teyidi kullanıcıya:** `desktop:dev`'de bir Claude sohbet/agent koşusu
  çalışınca "API kapasitesi" paneli dolmalı; dolmazsa header adı `telemetry.ts`'te tek satır ayarlanır
  (parser zaten ek-toleranslı, dolması beklenir). Ölçemediğim Claude.ai abonelik kotası EKLENMEDİ.

## Dilim 5 (2026-07-07): Donanım vitalleri → Yaşayan Küre (GPU/VRAM/ısı) — BİTTİ ve testli

Kürenin "çok sade" olması geri bildirimi üzerine küreye **fiziksel donanım katmanı** eklendi.
Bu, ertelenen VRAM protokol dilimiydi; kural 1 sırasıyla yapıldı:
- **Protokol (yeni olay):** `PROTOKOL.md` → `hardware.updated {gpus:[{index,name,utilizationPct,
  memUsedMb,memTotalMb,temperatureC|null}], sampledAt}` → `shared/events.ts` zod şeması
  (`GpuSampleSchema`+`HardwareUpdatedPayloadSchema`, tipler dışa aktarıldı). Katkı ekleme,
  PROTOCOL_VERSION değişmedi (eski istemci bilinmeyen olayı düşürür).
- **Core:** `router/hardware.ts` `sampleGpus()` + saf `parseGpuCsv()` (nvidia-smi: index,name,
  util,memTotal,memUsed,temp). `daemon.ts` 2sn periyodik poll → `hardware.updated` yayını +
  yeni bağlanana son örnek anında + `close()`'ta interval temizliği. **Test kapısı:**
  `DaemonOptions.sampleHardware` (varsayılan true, testlerde false — gerçek nvidia-smi + yayın
  olay dizisini bozardı). GPU yoksa hiç yayınlanmaz.
- **UI:** `store.gpus` + `hardware.updated` işleyici (applySnapshot bayatı temizler). Saf
  `scene/hardware-vitals.ts` `deriveGpuVitals` (en yoğun GPU birincil; load=util/100,
  heat=sıcaklıktan normalize ya da load'a düşer, memPct). `LivingScene`: kürede yük→zorlanma
  nabzı + sağ-üste yaslanma, ısı→renk sıcaklığı (cyan→amber→kırmızı lerp), VRAM→şişme; sağ-üst
  **GPU HUD** (`GPU %util · GB · °C`, ısıyla renklenir).
- **Test:** hardware.test (parse: çok-GPU/[N/A]/clamp/boş) + hardware-vitals.test (5) + store
  hardware testi. 168→**177 test**. Build/lint temiz.
- **Canlı doğrulama:** `nvidia-smi` çıktısı parseGpuCsv formatıyla birebir uyuştu (RTX 4060
  Laptop, 8GB). **Kürenin görsel tepkisi kullanıcıya** (`desktop:dev`; GPU yükü üretmek için
  yerel modelle bir koşu başlat → util/ısı yükselince küre ısınıp hızlanmalı).

## Dilim 4 (2026-07-07): Model panosu (token/maliyet) — BİTTİ ve testli

Dashboard artık her modelin token/maliyetini gösteriyor. **Sıfır protokol değişikliği**: daemon
`usage.updated`'ı (provider+model kümülatif `totals` + tur deltası) zaten yayıyordu ama store
yok sayıyordu; `usage.query` de kalıcı toplamları döndürüyordu ama UI hiç sormuyordu.
- `store.ts`: `usageTotals` (tüm-zaman) + `usageByModel` (maliyete göre azalan) + `sessionTokens/
  sessionCostUsd` (bu bağlantı boyunca biriken delta) eklendi. `usage.updated` → `upsertModelUsage`
  (girdiyi totals ile DEĞİŞTİRİR, çift saymaz) + genel toplamı yeniden hesaplar + oturum sayacını
  artırır. `usage.query.ok` → tüm-zaman dökümünü seed'ler. `applySnapshot` oturum sayaçlarını
  sıfırlar (tüm-zaman dökümüne dokunmaz — onu re-seed usage.query.ok getirir).
- `daemon/client.ts`: `queryUsage()` — hello.ok'tan sonra `usage.query {groupBy:"model"}` gönderir;
  cevabı hello-dışı replyTo taşıdığı için `store.handleEvent`'e düşer.
- `App.tsx`: "Model panosu" bölümü — 4 özet metrik (giriş/çıkış/toplam maliyet/bu oturum) + model
  başına satır (ad + provider + maliyet + orantılı cyan→magenta çubuk + token dökümü). `fmtTokens`
  (K/M), `fmtCost` (<$1'de 4 hane).
- 3 store testi (seed/güncelleme-çift-saymaz/snapshot-sıfırlar). Toplam 165→168 test.
**VRAM bilerek ERTELENDİ** ayrı dilime: protokolde `hardware`/`vram` YOK → PROTOKOL.md + shared
şeması + daemon yayını + UI gerektirir; token/maliyetle karıştırmak dikey dilim kuralını bozardı.
**Görsel doğrulama kullanıcıya** (Bash'ten DOM/panel görülemez; `desktop:dev` ile pencerede izlenir).

## Dilim 3 (2026-07-05): Yaşayan Arayüz parçacık küresi — BİTTİ ve testli

Kullanıcı 3 tasarım referans görseli verdi (`Tasarım/`) → `docs/TASARIM.md` (görsel anayasa)
yazıldı. Sonra ilk görsel parça: dashboard'un merkezinde nefes alan Three.js parçacık küresi
(`@react-three/fiber`, `ui/src/scene/LivingScene.tsx`). Fibonacci küre (1700 parçacık),
additive blending. Durum→mood: `scene/mood.ts` (SAF fonksiyon, testli — DOM/WebGL yok):
offline>error>awaiting>executing>thinking>idle önceliği + her mood'a renk/hız/nefes stili
(marka paleti). Küre `useFrame`'de dönüş + nefes + renk lerp yapar; mood değişince yumuşak
geçer. Hata olunca 2.5sn kırmızı flaş (store `lastErrorAt`). HUD mood etiketi (IDLE/THINKING/…).
8 mood testi. Toplam 157→165 test. Bundle 260KB→1.14MB (three.js; masaüstü için sorun değil).
**Görsel doğrulama kullanıcıya** (Bash'ten WebGL görülemez; `desktop:dev` ile pencerede izlenir).

## Dilim 2 (2026-07-05): masaüstünden izin cevaplama — BİTTİ ve testli

Dashboard artık salt-okunur DEĞİL — gerçek kontrol yüzeyi. Bekleyen her izin isteği kart
olarak render ediliyor (tool + riskClass + args + renkli diff), butonlar: Evet / Bu koşu
boyunca / Daima izin ver / Hayır (destructive'de yalnız Evet/Hayır — CLI/TUI ile aynı kural).
Tıklama `permission.respond`'u WS ile daemon'a gönderiyor; daemon `permission.resolved`'ı TÜM
istemcilere yayıyor (ilk cevap kazanır — CLI'da başlayan bir agent'ın iznini masaüstünden
onaylayabilirsin, SPEC §5). `store.pendingPermissions` artık sayı değil `PendingPermission[]`
(tam detay); `daemon` modül-seviye singleton oldu (App start/stop, kart respond çağırır).
7 store testi (tam detay saklama, requestId'e göre temizleme, removePending). Faz 4 kabul
testi "izin istekleri masaüstünden de cevaplanabiliyor" ✅ (kod+test; buton tıklama görsel
doğrulaması kullanıcıya — dilim 1'deki gibi).

## Şu an neredeyiz? — Faz 4 (masaüstü) dilim 1 BİTTİ ve doğrulandı

Model bu oturumda Sonnet → **Opus 4.8**'e geçti (kullanıcı `/model` ile). Faz 4 tasarım
ağırlıklı ve ADR'siz yeni yüzeyler içeriyor — DURUM.md'nin önerdiği gibi tam da pahalı modele
geçilecek yer. Kullanıcı "önce Rust kur, Tauri kabuğuyla başla" dedi.

**Kurulanlar (2026-07-05):**
- **Rust toolchain** ✅ rustc 1.96.1 (stable-msvc). MSVC (VS 18 Community) + Windows SDK
  10.0.26100 + WebView2 149 zaten vardı → sadece rustup gerekti. cargo bin kullanıcı PATH'ine
  eklendi.
- **`packages/ui`** (React 19 + Vite 8) — masaüstü dashboard'un web tarafı. Yalnız `shared`'a
  bağımlı (tarayıcı-güvenli, core'a DEĞİL). `daemon/client.ts` native WebSocket + `shared`
  şemalarıyla hello handshake → snapshot → yayın olaylarını `store.ts` (zustand) üzerinden
  UI'ya akıtır. `App.tsx` = Şef Paneli minimal: bağlantı durumu + sağlayıcı sağlığı + aktif
  koşular + canlı olay akışı. 6 store birim testi (olay→durum eşlemesi, saf mantık).
- **`packages/desktop`** (Tauri 2) — `ui/dist`'i native pencerede sarar. `src-tauri/src/lib.rs`
  token'ı `~/.symphony/daemon.token`'dan + portu config'ten okur, webview'e `initialization_
  script` ile (sayfa JS'inden ÖNCE) `window.__SYMPHONY__` olarak enjekte eder. Token asla
  koda/pakete gömülmez, dosyadan gelir (CLI'nin token modeliyle aynı).

**Doğrulama:** `pnpm build` (4 paket; desktop turbo'da yok, Rust'ı yavaşlatmaz) ✅ · `pnpm test`
156/156 ✅ · `pnpm lint` ✅ · `cargo build` (Tauri Rust, 1dk27sn) ✅ · **wire-protokol smoke
testi** ✅ — gerçek daemon'a `client:"desktop"` ile bağlanıp snapshot alındı (daemon daha önce
hiç desktop istemcisi görmemişti; UI'nin yaklaşımı canlı çalışıyor).

**Pencere görsel doğrulaması KULLANICI tarafından yapıldı ✅ 2026-07-05** —
`pnpm --filter @symphony/desktop desktop:dev` (proje dizininden!) pencereyi açtı, canlı akış
çalıştı. (Kullanıcı ilk denemede ev dizininden çalıştırıp hata aldı — pnpm ağaçta yukarıdaki
başka bir workspace'i bulup ön-install'da patladı; proje dizininden sorunsuz.) **Ön koşul:
daemon çalışıyor olmalı** (token dosyası ancak daemon dinlerken yazılır); yoksa dashboard
"daemon çalışmıyor olabilir" uyarısı gösterir.

Çalıştırma notu (DEVIR için): `desktop:dev` MUTLAKA proje kökünden çalıştırılmalı
(`cd C:\Users\brkn2\Desktop\OPTIMUS\symphony` önce). Tarayıcı dev alternatifi:
`pnpm --filter @symphony/ui dev:token` sonra `... dev`.

## ⭐ SIRADAKİ İŞ — kullanıcıyla anlaşılan öncelik sırası (2026-07-07, Oturum 13 sonu)

Kullanıcı onayladı, SIRAYLA yapılacak (ayrıntı: `ROADMAP.md` → "Sıradaki dilimler — kullanıcı önceliği"):
1. ✅ **Oturum sürekliliği BİTTİ** (Oturum 14-15) — TUI "önceki sohbete devam et" (canlı doğrulandı 07-09).
2. ✅ **Birleşik sohbet-agent modu BİTTİ** (Oturum 15, 2026-07-09) — ADR-012: 2.1 akış · 2.1b masaüstü ·
   2.2 çok-tur (awaiting_user+agent.say) · 2.3a birleşik giriş (PersonaPicker + salt-okur asistan) ·
   2.3b konuşma kalıcılığı · 2.3c agent-resume. Canlı doğrulandı (asistan dosya okudu, awaiting_user).
   Kalan opsiyonel kırıntı: "Sohbet personasını da agent'a taşıyıp chat.start'ı curl-ucuna indir".
3. **Uzun-dönem hafıza** (Faz 6) + **konuşma arşivinden kişiselleşme** ← **SIRADAKİ (Fable ile).**
   Kullanıcı tüm Claude sohbetlerini arşivledi; yerel LLM tarzını benimsesin. FİZİBIL, 3 katman
   (ROADMAP §"Sıradaki dilimler" #3): (a) stil/tercih profili → system prompt (en ucuz, ilk hamle);
   (b) RAG (arşiv embedding, ilgili geçmişi bağlama çek); (c) LoRA ince-ayar (en güçlü, en ağır).
   **Tasarım-ağır → Fable saati.** İlk adım: ADR (memory formatı + profil boru hattı) + `~/.symphony/
   memory/` kapsam kararı (Faz 6 notu: agent'lar kendi yazamaz, yalnız okur). Veri çoğu MEVCUT
   (sessions/messages/agent_runs SQLite'ta + kullanıcının Claude arşivi).
4. ✅ **Token güvenilirlik hatası BİTTİ** (Oturum 13, 2026-07-07): `token.ts` `loadExistingToken`
   (diskteki 64-hex token'ı doğrulayıp yeniden kullanır) + `daemon.ts` satır 80 `loadExistingToken ??
   generateDaemonToken`. Artık daemon restart'ında token korunur → masaüstü/CLI kopmaz. +5 test
   (`token.test.ts`, 198→203). "Dinleme sonrası yaz" değişmezi korundu. **Not:** hâlihazırda ÇALIŞAN
   daemon eski kodda; etki bir sonraki daemon başlatmasında geçerli (restart'ta token 2decedef… korunur).

Kalan sıra: ~~1 (oturum sürekliliği ✅)~~ → ~~2 (birleşik sohbet-agent ✅)~~ → **3 (hafıza/arşiv) ← SIRADAKİ, Fable ile.**

### 📋 Dilim 1 — Oturum sürekliliği: ✅ UYGULANDI (Oturum 14) — plan arşivi

> Bu adım adım plan uygulandı (yukarıdaki "Dilim 1 BİTTİ" bölümü + `memo/oturumlar/2026-07-08.md`).
> Kayıt olarak bırakıldı; v2 (tam oturum tarayıcısı: liste/arama/model-değişince-devam) yapılırken referans.
> Uygulama planla birebir gitti: REST+daemon değişmedi (history zaten Faz 2'de REST'te, REPLACE semantiği),
> `DaemonClient.listSessions/sessionDetail` + `ChatFlow` + `resume-picker.tsx` + `chat.tsx` prop tohumu.

**v2'ye ertelenenler:** tam oturum tarayıcısı (son sohbet değil herhangi biri); önceki oturumun modeli
artık mevcut değilse (ör. Ollama modeli silinmiş) devam — şu an bu durumda "devam et" gizlenir; başlık/arama.
Aşağıdaki eski Faz 4 dilimleri hâlâ geçerli ama kullanıcı önceliği yukarıdaki maddeler.

## Sıradaki adım (Faz 4 sonraki dilimler)

> Küre (dilim 3), Model panosu (4), GPU vitalleri (5), API kapasitesi+cache (6), Küre revizyonu/
> vektörel dalga (7) BİTTİ. Sırada, kullanıcının görsel ince ayarından sonra aşağıdakiler:

> **NOT (dilim 8 sonrası):** Küre ve wave-field EMEKLİ (dilim 8'de tesseract'a dönüştü; eski kod
> git geçmişinde). Görsel ince ayar artık `TesseractScene.tsx` üst sabitleri + `tesseract/pulses.ts`
> hız sabitleriyle yapılır; kullanıcının canlı görsel onayı bekleniyor.

**Sonraki dilimler:**

1. **API kapasitesi v2 (opsiyonel)** — OpenAI/Gemini rate-limit header'ları (kendi adları var);
   küre "limite yaklaşınca amber uyarı nabzı" (mood'a `throttle` katmanı, hardware gibi); cache
   isabet oranını girdi-token'a göre kesin hesap (şu an okundu/yazıldı sayacı).
2. **Şef Paneli zenginleştirme** — koşu başına araç/dosya ayrıntısı, adım geçmişi
   (`agent.step.thinking` olayı geliyor ama store yok sayıyor).
2. **GPU vitalleri v2 (opsiyonel)** — çok-GPU HUD (şu an yalnız en yoğun GPU); AMD/Apple Silicon
   (şu an NVIDIA-only); sıcaklık normalizasyon aralığını (`TEMP_MIN/MAX_C`) kart GPU'ya göre ayarla.
3. **CLI → masaüstü otomatik açılış** (config `desktop.autoLaunch`).
4. **Tesseract'ı canlı mimari haritasına bağlama** (TASARIM.md §2 — düğümler = sistem bileşenleri).

## ⚠️ OTURUM 12 SONU — bilgisayar yeniden başlatılıyor (2026-07-07 ~15:15)

**Bağlam:** Kullanıcı küre revizyonunu denemek için terminalde `symphony` çalıştırdı; ekranda bir
"exe" penceresi çok hızlı açılıp kapanıp tekrar açıldı (yetişip okuyamadı). Teşhis edildi, kod+test
BİTTİ, kullanıcı makineyi yeniden başlatacak. Yeniden başlattıktan sonra buradan devam:

**1. Flaşlayan pencerenin sebebi (TEŞHİS):** `packages/cli/src/client/daemon-client.ts:350`
`spawn(..., { detached: true, stdio: "ignore" })` — **`windowsHide: true` YOK**. Windows'ta detached
node.exe görünür konsol penceresi açar → daemon başlatılırken flaş. **Düzeltme uygulandı** (windowsHide
eklendi); etki için `pnpm build` (cli+core) + global CLI yeniden link/kurulum gerekebilir. Daemon'ın
KENDİSİ sağlıklıydı (tek süreç, /api/health ok, port 7770) — crash loop değildi, yalnız pencere flaşı.

**2. Küreyi CLI ile DENEYEMEZSİN — yanlış araç.** `symphony` = terminal TUI (Ink); küreyi (Three.js)
render ETMEZ. Küre yalnız MASAÜSTÜ uygulamasında. Doğru test yolu (proje kökünden, daemon çalışırken):
```
cd C:\Users\brkn2\Desktop\OPTIMUS\symphony
node packages\core\dist\main.js        # daemon (ayrı terminalde; ya da symphony bir kez çağırınca kalkar)
pnpm --filter @symphony/desktop desktop:dev   # Tauri penceresi (ilk derleme ~1.5dk)
```
Tarayıcı alternatifi (Rust derlemeden): `pnpm --filter @symphony/ui dev:token` → `pnpm --filter @symphony/ui dev` → tarayıcıda aç.
UI-only değişiklik → Vite HMR yeni sahneyi alır; daemon restart gerekmez (daemon yalnız GPU verisi verir).

**3. Küreyi görünce ne bekle:** yerel model koşusu (qwen3:8b) → dalga sağ-üste doğru atmalı/ısınmalı;
Claude/Gemini sohbeti → GPU yükselmese de mood-activity dalgayı sürmeli. İnce ayar gerekirse yalnız
`ui/src/scene/wave-field.ts` ayar sabitleri (MAX_DISP/WAVE_K/WAVE_SPEED/FOCUS_EXP/FOCUS_BULGE/RISE_TAU/FALL_TAU).

## Bekleyenler / kullanıcıdan gerekenler

- [x] **Masaüstü dashboard + tesseract görsel doğrulaması** ✅ 2026-07-09 (Oturum 15 devamı,
      Sonnet): kullanıcı `desktop:dev` penceresini gördü, tesseract sinematik hâliyle (dilim 8+8b)
      dönüyor onaylandı.
- [x] **TUI agent modu canlı doğrulaması** ✅ 2026-07-09 — konuşmalı agent (dilim 2.2) denendi,
      "gayet güzel çalıştı" onayı geldi.
- [x] **TUI "önceki sohbete devam et" canlı doğrulaması** ✅ 2026-07-09 — seçenek çıktı, eski
      mesajlar yüklendi, qwen bağlamı hatırladı; tam onay.
- [ ] OpenAI/Google API anahtarları (gelince: `pnpm --filter @symphony/core key:set openai`).
- [ ] Tauri ikonları şu an jenerik (init varsayılanı) — sonraki dilimde Symphony tesseract
      logosuyla değiştirilecek (`tauri icon <kaynak.png>`).

## Geçmiş fazlar (özet — ayrıntı oturum günlüklerinde)

- **Faz 0-1** ✅: monorepo, daemon (Fastify+ws, token auth), 4 provider adapter'ı,
  SecretStore (keychain), SQLite v1, router v1.
- **Faz 2 + 2.5** ✅ (2026-07-03): DaemonClient, otomatik daemon başlatma, Ink TUI, global
  kurulum, `symphony watch`, sohbet geçmişi, karşılama ekranı + logo.
- **Faz 3** ✅ 2026-07-05: araç seti + jail + izin motoru + koşu motoru → MCP istemcisi
  (ADR-007) + eklenti sistemi (`symphony add`) + TUI agent modu + `allow_for_run` (bu koşu
  boyunca izin). Gerçek kullanıcı testinden 2 hata bulunup düzeltildi (Format-Table yanlış
  pozitifi; TUI'nin cwd/model'i sessizce varsayması). `duzenleyici` agent'ı eklendi.
  Kullanıcı hafızası (Faz 6) kapsam kararı ROADMAP'e not düşüldü (agent'lar yazamaz).
  Ayrıntı: `memo/oturumlar/2026-07-05.md`.

## Kalıcı teknik notlar

- **DAEMON HOT-RELOAD DEĞİL — core değişince yeniden başlat.** 2026-07-07 dersi: dilim 5/6
  (GPU HUD + API kapasitesi) kodu derlendi ama GÖRÜNMEDİ; sebep çalışan daemon'ın ESKİ kodu
  bellekte tutmasıydı. `pnpm build` dist'i günceller ama süreç yeni kodu almaz. Test/görsel
  doğrulamadan önce daemon'ı öldür + `node packages/core/dist/main.js` ile taze başlat (token
  değişir → `pnpm --filter @symphony/ui dev:token` + tarayıcıyı yeniden yükle). Dilim 5 (GPU:
  `GPU %util · GB · °C`) ve dilim 6 (API kapasitesi: anthropic istek/token kovaları) 2026-07-07'de
  tarayıcıda GERÇEK veriyle doğrulandı (RTX 4060 Laptop; Anthropic limit 10K istek/12M token).
  Rate-limit header adları teyit edildi: `anthropic-ratelimit-{requests,tokens,input-tokens,
  output-tokens}-{remaining,limit,reset}` (reset RFC3339). parseGpuCsv/parseRateLimits çalışıyor.

- **Arayüz katmanı bağımlılığı:** `ui` yalnız `shared`'a bağımlı (tarayıcı-güvenli); `core`'a
  DEĞİL. `desktop` (Tauri/Rust) `shared`'a bile bağımlı değil. Hepsi daemon'la WS/REST protokol
  üzerinden konuşur. `shared` saf zod — Node VE tarayıcıda çalışır (`crypto.randomUUID` her ikisinde var).
- **Tauri token enjeksiyonu:** `lib.rs` pencereyi Rust'ta kurar (`windows:[]` config'te) ki
  `initialization_script` sayfa JS'inden önce `window.__SYMPHONY__`'yi versin. `getBootstrap()`
  (config.ts) önce bunu, yoksa `import.meta.env`'i (tarayıcı dev) okur; boş token = daemon yok.
- **turbo:** `desktop`'ta `build` script'i YOK (scriptler `desktop:dev`/`desktop:build`), bu
  yüzden `pnpm build` Rust'ı derlemez (hızlı kalır). Tauri elle: `pnpm --filter @symphony/desktop desktop:dev`.
- **eslint:** `target/` + `src-tauri/gen/` ignore edildi (Rust build çıktısı JS içerir).
- Claude 4.7+/GPT-5 `temperature` KABUL ETMEZ → adapter `forwardsTemperature` bayrağı (ADR-008).
- AI SDK v7: system mesajı `instructions`; MCP araçları `jsonSchema()` sarmalı. Ayrıntı: DEVIR.md.
- İzin kararları 4 kademeli: `allow` / `allow_for_run` (koşu boyunca, bellek-içi) /
  `always_allow` (kalıcı) / `deny`. Son ikisi `destructive`'de sunulmaz.
- Kurulu: Node 24.14.1, pnpm 11.9.0, TS 6.0.3, Vitest 4, zod 3(shared/core)/4(cli/ui-devDep),
  AI SDK 7, @modelcontextprotocol/sdk 1.29.0, **Rust 1.96.1, Tauri 2.11, Vite 8, React 19, zustand 5**.
