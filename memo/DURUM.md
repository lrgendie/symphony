# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-07 (Oturum 13, Opus — flaşlayan pencere KÖK NEDEN düzeltildi: daemon'ın 2sn nvidia-smi çağrısı windowsHide'sızdı; + masaüstü AUTH_TOKEN_INVALID teşhisi)

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
1. **Oturum sürekliliği** ← BURADAN BAŞLA. TUI "önceki sohbete devam et"; veri zaten SQLite'ta,
   TUI her açılışta yeni sessionId üretiyor (`cli/src/tui/chat.tsx`). Küçük dilim.
2. **Birleşik sohbet-agent modu** (ADR gerektirir — chat↔agent köprüsü + izin kapısı sohbete de).
3. **Uzun-dönem hafıza** (Faz 6) + **konuşma arşivinden kişiselleşme** (kullanıcı tüm Claude sohbetlerini
   arşivledi; yerel LLM tarzını benimsesin → önce stil profili, sonra RAG, gerekirse LoRA ince-ayar).
4. ✅ **Token güvenilirlik hatası BİTTİ** (Oturum 13, 2026-07-07): `token.ts` `loadExistingToken`
   (diskteki 64-hex token'ı doğrulayıp yeniden kullanır) + `daemon.ts` satır 80 `loadExistingToken ??
   generateDaemonToken`. Artık daemon restart'ında token korunur → masaüstü/CLI kopmaz. +5 test
   (`token.test.ts`, 198→203). "Dinleme sonrası yaz" değişmezi korundu. **Not:** hâlihazırda ÇALIŞAN
   daemon eski kodda; etki bir sonraki daemon başlatmasında geçerli (restart'ta token 2decedef… korunur).

Kalan sıra: 1 (oturum sürekliliği) → 2 (birleşik sohbet-agent) → 3 (hafıza/arşiv).

### 📋 Dilim 1 — Oturum sürekliliği: SONRAKİ OTURUM BURADAN BAŞLASIN (adım adım)

**Hedef:** TUI'de "önceki sohbete devam et" → qwen önceki konuşmanın bağlamını görsün.
**Kapsam v1:** yalnız SON sohbeti sürdür (tam oturum tarayıcısı v2'ye). Dikey dilim, küçük.

**Önce oku (yalnız bunlar):** `cli/src/tui/app.tsx` (akış) · `cli/src/tui/chat.tsx` (sessionId +
history state) · `shared/src/protocol/rest.ts` (history uç şemaları) · `core/src/db/store.ts`
(sessions/messages sorguları) · `core/src/server/daemon.ts` (REST /api/history/* handler'ları).

**Adımlar:**
1. **Protokol kontrolü (ADR/PROTOKOL gerekmez muhtemelen):** history ZATEN REST'te (`/api/history/*`,
   sessions+messages — Faz 2). Daemon sessionId'ye REPLACE semantiğiyle yazıyor → eski sessionId'yi
   yeniden kullanıp tüm mesaj dizisini göndermek yeterli. `chat.start`'a alan EKLEME (gerekmiyor).
   YALNIZCA yeni bir REST ucu yoksa (son sohbeti + mesajlarını çekmek) küçük bir ekleme gerekebilir —
   önce mevcut history uçlarının ne döndürdüğüne bak; varsa dokunma.
2. **CLI istemci:** `daemon-client.ts`'e REST'ten geçmiş çeken küçük yardımcı (token + daemon base
   URL zaten var; `fetch`). Son session + o session'ın mesajları.
3. **app.tsx akışı:** karşılama sonrası, Sohbet dalında model seçiminden önce/sonra bir adım:
   "Yeni sohbet / Önceki sohbete devam et" (yalnız kayıtlı sohbet varsa göster). Devam seçilirse
   eski `sessionId` + önceden yüklenmiş mesajları `Chat`'e prop olarak geçir.
4. **chat.tsx:** opsiyonel `initialSessionId?` + `initialHistory?` prop'ları; `useState`/`useRef`
   bunlarla tohumlanır (yoksa bugünkü davranış: yeni UUID + boş history).
5. **Test:** ink-testing-library — "devam et seçilince eski mesajlar render + yeni mesaj eski
   sessionId ile gönderilir". Gerekirse store/client birim testi. Test geçmeden dilim kapanmaz.
6. **Doğrulama:** build+test+lint; TUI raw-mode TTY istediği için canlı doğrulama KULLANICIYA
   (terminalde `symphony` → Sohbet → "önceki sohbete devam" → qwen önceki bağlamı hatırlıyor mu?).

**Tuzak:** TUI istemcisi WS; history REST'ten gelir (aynı token). `sessionId` REPLACE semantiği
nedeniyle eski oturuma yazınca mesajlar çiftlemesin — daemon zaten replace yapıyor, yeni ekleme yapma.
Aşağıdaki eski Faz 4 dilimleri hâlâ geçerli ama kullanıcı önceliği yukarıdaki maddeler.

## Sıradaki adım (Faz 4 sonraki dilimler)

> Küre (dilim 3), Model panosu (4), GPU vitalleri (5), API kapasitesi+cache (6), Küre revizyonu/
> vektörel dalga (7) BİTTİ. Sırada, kullanıcının görsel ince ayarından sonra aşağıdakiler:

> **NOT (dilim 7 sonrası):** Küre revizyonu kodu+testi BİTTİ; kullanıcının canlı görsel onayı ve
> olası ince ayarı bekleniyor (wave-field.ts ayar sabitleri: MAX_DISP/WAVE_K/WAVE_SPEED/FOCUS_EXP/
> FOCUS_BULGE/RISE_TAU/FALL_TAU). "Çok zayıf/çok abartılı/yön yanlış" gibi bir geri bildirim gelirse
> yalnız bu sabitler oynanır (matematik/mimari sağlam). Yön ekseni `FOCUS_DIR = normalize(1,1,0.4)`.

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

- [ ] **Masaüstü dashboard görsel doğrulaması** (yukarıda — Faz 4 dilim 1'in son adımı).
- [ ] TUI agent modu canlı doğrulaması (Faz 3 — hâlâ kullanıcının bir kez denemesi bekleniyor).
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
