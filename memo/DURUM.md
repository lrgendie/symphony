# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-09 (Oturum 15 devamı, Opus — Dilim 2.3a+2.3b+2.3c BİTTİ: birleşik giriş + kalıcılık + agent resume)

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
