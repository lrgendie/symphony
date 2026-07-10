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

## ADR-012 — Birleşik sohbet-agent modu: konuşmalı motor (2026-07-08, Opus)
**Bağlam:** Sohbet (`chat.start` → `runChat`, akışlı, araçsız/izinsiz/jail'siz, çok-tur istemci-sürer)
ile agent (`agent.start` → `AgentEngine`, araçlı + izin kapısı + jail, akışsız `generateText`,
TEK-seferlik task) ayrı iki yol. Kullanıcı Claude Code gibi "sohbet ederken gerektiğinde araç
kullanımına geçebilme" istiyor (ROADMAP "Sıradaki dilimler" #2 — en büyük kazanım).
**Karar:** İki yolu **konuşmalı motor** ile birleştir: bir konuşma = tamamlanınca `finish` etmek
yerine yeni bir `awaiting_user` (boşta) durumuna park olan, çok-turlu bir agent koşusudur. Sonraki
kullanıcı mesajı aynı koşuya `agent.say { runId, text }` ile girer. Düz "sohbet" = araçsız (ya da
salt-okur) bir "asistan" agent'ıyla yapılan konuşmadır; modelin bir araç çağırmaya karar vermesi =
aynı koşu, **mevcut izin kapısı + jail zaten devrede** (SPEC-AGENT §8.1'deki TEK kapı çoğaltılmaz).
Motor akışa taşınır (`generateText` → `streamText`), metin `agent.delta { runId, text }` ile yayılır.
**Neden A (ret edilen B/C yerine):**
- **B (chat.start'a araç ekle):** izin kapısı + jail'i chat yoluna kopyalar/çatallar → güvenlik-kritik
  kod ikiye bölünür (Kural 6 ihlali). Reddedildi.
- **C (yeni `converse.*` tipi):** kavramsal olarak temiz ama hem chat hem agent mantığını çoğaltma
  riski + en geniş yeni protokol yüzeyi. Reddedildi.
- **A:** araç döngüsü/izin/jail/MCP/durum makinesi/telemetri TEK yerde (engine) kalır; en çok
  yeniden kullanım, en küçük yeni güvenlik yüzeyi.
**Protokol dokunuşu (ADDITIVE, PROTOCOL_VERSION=1 korunur; tüm istemciler tek `shared` sürümü paylaşır):**
`agent.delta` olayı; `awaiting_user` durumu (thinking→awaiting_user, awaiting_user→thinking/cancelled);
`agent.say` isteği; `agent.start`'a `conversational?: boolean` (vars. false). `chat.start` KALDIRILMAZ —
curl/geri-uyum için ince, tek-seferlik, araçsız uç olarak durur; TUI "sohbet" dalı 2.3'te konuşmalı
asistan agent'ına taşınır.
**Dikey dilimler (her biri çalışan bir şey bırakır, Kural 7):**
- **2.1** `generateText→streamText` + `agent.delta` — agent cevabı token-token akar (görünür kazanım,
  streamText temelini de-riske eder). Durum/çok-tur DEĞİŞMEZ. (engine.test mock'u `doGenerate`→`doStream`.)
- **2.2** `awaiting_user` + `agent.say` + `conversational` — motor tur bitince park olur, sonraki
  kullanıcı mesajıyla devam; TUI agent koşusu çok-turlu olur.
- **2.3** Birleşik TUI — varsayılan "asistan" agent'ı (araçsız); Sohbet/Agent mod ayrımı tek konuşmalı
  yüzeyde birleşir; araç modele göre isteğe bağlı, izin kapısı arkasında.
  **Uygulama notu (2026-07-09, Opus — icra a/b'ye bölündü, Kural 7):**
  - **2.3a (BİTTİ):** "Sohbet/Agent modu" ikilisi kaldırıldı; tek `PersonaPicker` ("kiminle
    konuşmak istersin?") — Sohbet + kayıtlı agent'lar tek listede. Salt-OKUR "asistan" agent'ı
    (read_file/glob/grep, hepsi `safe` → izin sürtünmesi yok) varsayılan olarak eklendi (ADR'nin
    "araçsız ya da salt-okur" izniyle). `ModePicker`+`AgentPicker` silindi (ölü kod).
  - **2.3b (SIRADA):** ADR'nin "TUI sohbet dalı konuşmalı asistan agent'ına taşınır" maddesi
    2.3b'ye ERTELENDİ çünkü konuşmalı-agent koşuları henüz sessions/messages'a YAZILMIYOR →
    taşımak Dilim 1'in "önceki sohbete devam" özelliğini bozardı (regresyon). 2.3a'da "Sohbet"
    personası bilinçli olarak `chat.start` yolunda tutuldu (resume korunur). **Güvenlik gerekçesi
    ihlal EDİLMEDİ:** araçsız `chat.start` yolu SIFIR güvenlik kodu (izin/jail) çoğaltır — ADR'nin
    B'yi reddetme nedeni araç yolunun çatallanmasıydı, o yol tek (engine). 2.3b: konuşmalı agent
    koşularına oturum kalıcılığı + resume → tüm konuşmalar sürdürülebilir olunca "Sohbet" personası
    da konuşmalı asistan'a taşınabilir (ya da chat.start yalnız curl/compat ucu olarak kalır).
**Geri dönüş koşulu:** streamText göçü mevcut agent kabul testlerini (izin/jail/deny) kırarsa ya da
konuşma yaşam döngüsü koşu semantiğini bulanıklaştırırsa dilim geri alınır ve C (ayrı `converse.*`)
yeniden değerlendirilir. Değişmezler dokunulmaz: izin kapısı, jail, anahtar yönetimi.

## ADR-013 — Uzun-dönem hafıza: dosya-tabanlı stil/tercih profili, salt-okur enjeksiyon (2026-07-09, Fable)
**Bağlam:** ROADMAP kullanıcı önceliği #3 (Faz 6 "Kullanıcı hafızası" + konuşma arşivinden
kişiselleşme). Üç katman önerilmişti: (a) stil/tercih profili → system prompt'a enjekte,
(b) RAG (arşiv embedding + sorguda bağlama çekme), (c) LoRA ince-ayar. Kullanıcı tüm geçmiş
Claude sohbetlerini arşivledi; yerel LLM'in kullanıcıyı tanıyıp tarzını benimsemesi isteniyor.

**Karar 1 — (a) ile başla; (b) ertelendi; (c) ertelendi.**
- **(a) profil:** sıfır yeni bağımlılık (embedding/vektör DB/eğitim yok), hemen görünür kazanım,
  tam kullanıcı kontrolü (düz markdown). "Tarz benimseme"nin %80'i buradan gelir.
- **(b) RAG:** Faz 6 "Bağlam Haritası" ile aynı altyapıyı (embedding + indeks) paylaşacak —
  o işten BAĞIMSIZ şimdi kurmak altyapı kararını iki kez verdirir. Geri dönüş koşulu: profil
  "geçmişe atıf" ihtiyacını karşılayamazsa (kullanıcı 'şunu konuşmuştuk'u arıyorsa) Bağlam
  Haritası dilimiyle birlikte tasarlanır. Enjeksiyon noktası (aşağıda) RAG çıktısının da aynı
  borudan akabileceği şekilde tek yerde tutulur.
- **(c) LoRA:** en ağır (veri hazırlığı + eğitim + Modelfile/GGUF içe aktarma); profil+RAG
  yetmezse yeniden değerlendirilir. Şimdi yapılmaz.

**Karar 2 — Yazma kısıtı KORUNUR ve güçlendirilir (Faz 6 kapsam kararı, 2026-07-05):**
- Canlı profil `~/.symphony/memory/profil.md` YALNIZ insan eliyle yazılır (herhangi bir editör,
  Claude Code, ya da M2'deki REST PUT — hepsi kullanıcı eylemi).
- Agent'lar/motor profili ASLA yazamaz — arşiv damıtma (M3) dahi yalnız `profil.taslak.md`
  TASLAĞI üretir; taslağın canlıya alınması kullanıcının açık eylemidir (gözden geçir + kopyala).
  Gerekçe: kendi hafızasını kendisi genişleten agent, yanlış/yanıltıcı bir "gerçeği" sonraki TÜM
  koşulara bulaştırır; arşiv içeriğinden gelebilecek prompt-injection da insan onayı kapısında süzülür.
- Not: kullanıcı `~/.symphony`'yi bilerek jail'e verirse (extraDirs açık onaydır, SPEC §3) bu
  bilinçli karardır; motor ayrıca engellemez.

**Karar 3 — Veri katmanı DOSYA, DB değil:** `~/.symphony/memory/profil.md` (paths.ts'e girer).
Gerekçe: kullanıcı-düzenlenebilir + diff'lenebilir + Faz 7 `symphony sync` git eşitlemesiyle
bedavaya taşınır + göç gerektirmez. SQLite'a koymak düzenleme/inceleme sürtünmesi ekler, kazanım yok.
Boyut sınırı: MAX_PROFILE_CHARS ≈ 8000 (≈2K token); aşan kısım kesilir ve loglanır (hatayı yutma).
Dosya yoksa daemon açılışta BOŞ İSKELET yazar (yalnız başlıklar — ensureDefaultAgent deseni);
içerik hep kullanıcıdan.

**Karar 4 — Enjeksiyon noktası TEK ve sunucu tarafında (iki yol, tek kaynak, `instructions`):**
- Agent yolu: `engine.ts buildSystemPrompt` sonuna "Kullanıcı profili" bölümü. Engine'e dep
  olarak `loadMemoryProfile: () => string | null` verilir (testte sahtelenir).
- Chat yolu: `ChatStreamRequest`'e `instructions?: string` eklendi; `daemon.ts runChat` profili
  buradan geçirir, provider'lar `streamText({..., instructions})`e iletir. **Uygulama sırasında
  düzeltildi (2026-07-09):** ilk tasarımda "mesaj kopyasına system-önek" planlanmıştı ama AI SDK
  v7 `messages`/`prompt` alanında `system` rolünü KABUL ETMEZ (`InvalidPromptError` — engine.ts'in
  zaten bildiği kısıt, chat yoluna da UYGULANMASI gerekiyordu). Doğru yol `instructions` — agent
  yoluyla AYNI desen, dört adapter'ın (anthropic/openai/google/ollama) `streamText` çağrısına
  `instructions` iletimi eklendi. `saveChatTurn`'a giden `payload.messages` HİÇ DOKUNULMADI
  (kalıcı geçmişe system/profil asla girmez) — canlı testle doğrulandı (fake Ollama istek
  gövdesi profili İÇERİR, `sessionDetail` dökümü İÇERMEZ).
- Her koşu/istek başında dosyadan taze okunur (µs-ölçek; cache karmaşıklığı gereksiz). Profil
  stabil kaldığı sürece system-önek değişmez → Anthropic prompt-cache prefix'i bozulmaz (maliyet
  endişesi düşük). `config.json → memory.enabled` (vars. true) tek anahtarla kapatılabilir
  (kirlenmiş profil şüphesinde hızlı devre dışı bırakma).

**Karar 5 — Arşiv damıtma (M3) YENİ PROTOKOL YÜZEYİ AÇMADAN agent olarak koşar:**
`symphony memory distill <arşiv-dizini>` = salt-okur araçlı (read_file/glob/grep) bir "damıtıcı"
agent koşusu: cwd=arşiv dizini, task=damıtma talimatı, sonuç (`agent.run.completed.result`) CLI
tarafından `profil.taslak.md`'ye yazılır (CLI = kullanıcı eylemi; taslak zaten canlı değil).
Kazanım: izin sistemi/jail/telemetri/iptal bedavaya gelir; `memory.distill` diye yeni istek tipi
gerekmez. **Gizlilik varsayılanı:** damıtma YEREL model şart koşar (arşiv buluta gönderilmez);
`--bulut` bayrağıyla bilinçli override. Büyük arşivde v1 sınırı: karakter bütçesi (en yeni
dosyalardan başla); map-reduce özetleme gerekirse ayrı dilim.

**Protokol dokunuşu (yalnız M2, ADDITIVE):** REST `GET /api/memory` (profil + meta) ve
`PUT /api/memory` (tam içerik değiştirme — insan arayüzünden). M1 ve M3 protokolsüz.
PROTOKOL.md'ye "planlandı (M2)" işaretiyle şimdi yazıldı (rapor1 §3.2 dersi: işaretsiz
gelecek özellik belgelenmez).

**Dikey dilimler (Kural 7):** M1 çekirdek enjeksiyon (core-only, protokolsüz) → M2 yüzey
(REST + CLI `symphony memory` + TUI göstergesi) → M3 damıtıcı agent. Adım adım talimat:
`memo/DURUM.md`. (b)/(c) bu ADR'nin kapsamı DIŞI — geri dönüş koşulları yukarıda.

**Geri dönüş koşulu:** Profil enjeksiyonu model davranışını ölçülebilir bozarsa (kabul testleri /
kullanıcı gözlemi) `memory.enabled=false` anında kapatır; dosya-tabanlı yaklaşım çok-makine
senkronunda yetersiz kalırsa Faz 7 sync ile birlikte yeniden değerlendirilir.

## ADR-014 — Çoklu agent orkestrasyonu: motor-içi devretme aracı `run_agent` (2026-07-10, Fable)
**Bağlam:** ROADMAP Faz 5 — "şef" agent görevi alt görevlere bölüp uygun agent'lara/modellere
dağıtacak; birden çok agent paralel izlenebilecek; basit işler ucuz/yerel modele gidecek.
Mevcut altyapı zaten çok şey veriyor: `engine.runs` Map'i koşuları runId'yle bağımsız tutar
(iki `agent.start` ZATEN paralel koşar ve snapshot'ta ayrı görünür); agent tanımları dosya
olarak taşınabilir (Faz 3); kural-tabanlı router v1 var. Eksik olan tek çekirdek yetenek:
bir agent'ın BAŞKA bir agent'ı çalıştırıp sonucunu alabilmesi.

**Karar 1 — Devretme, motor-içi DİNAMİK ARAÇTIR: `run_agent { agent, task, model?, provider? }`.**
MCP araçları deseniyle birebir: araç spec'i koşu başına motor tarafından üretilir (`execute`
engine'i closure'lar), `AGENT_TOOLS` sabitine girmez ama frontmatter `tools:` enum'una girer —
yalnız listesinde `run_agent` olan agent devredebilir. Çocuk koşu = motor içinde başlatılan
normal bir agent koşusu (kendi runId'si, kendi `agent.run.*` olayları, kendi SQLite kaydı);
aracın dönüşü = çocuğun nihai `result` metni (MAX_OUTPUT_CHARS'a kırpılır). Çocuk `failed`/
`cancelled` biterse bu ARAÇ HATASIDIR, şefin koşusunu düşürmez (SPEC §4 "araç hatası ≠ koşu
hatası" — şef rota değiştirebilir; AGENT_TOOL_LOOP sigortası sonsuz denemeyi keser).
**Reddedilenler:**
- *Yeni protokol mesajı (`agent.delegate`):* devretme kararı modelin tool-loop'unun İÇİNDE
  doğar; onu istemci katmanından geçirmek hem gecikme hem yeni güvenlik yüzeyi ekler, kazanım yok.
- *Yalnız host/CLI orkestrasyonu (M3 `damitici` deseni):* "şef"i statik bir betiğe indirger —
  alt görev listesi koşu SIRASINDA modelin kararıyla değişemezdi; ROADMAP'in "üst akıl" kabul
  testi (görevi kendisi bölüp dağıtan agent) karşılanmazdı. M3'te doğru olan desen burada yanlış:
  damıtmada plan sabitti, orkestrasyonda planın kendisi zekânın çıktısı.

**Karar 2 — Hiyerarşi protokole ADDITIVE girer, PROTOCOL_VERSION=1 korunur:**
`agent.run.started` olayına ve `ActiveRun` (snapshot) şemasına `parentRunId?` alanı. Olay sırası
bus'ta sıralı olduğundan istemci, çocuğun `agent.run.started`'ını (parentRunId'li) çocuğun her
türlü sonraki olayından ÖNCE görür → istemciler "benim koşum + onun çocukları" kümesini
güvenle kurabilir. Başka mesaj/olay değişmez; `agent.start` isteğine dokunulmaz (devretme
istemciden başlatılmaz).

**Karar 3 — Güvenlik değişmezleri (SPEC §8) çocuklarda da AYNEN geçerli, TEK kapıdan:**
- Çocuğun araç çağrıları AYNI izin motorundan geçer ve KENDİ runId'siyle `agent.tool.requested`
  yayınlar; kullanıcı her istemciden cevaplayabilir. İzin isteği şefe DEĞİL kullanıcıya gider —
  şef, kullanıcının izin yetkisini devralamaz.
- `run_agent`'ın kendi risk sınıfı HEDEFE göre dinamiktir: hedef agent'ın araç seti tamamen
  `safe` sınıfındaysa (ör. asistan/damitici: read_file/glob/grep) devretme de `safe` → izin
  kutusu çıkmaz; sette `mutating`/`destructive` üretebilecek araç varsa (write_file/edit/
  run_command/MCP) devretme `mutating` → sorulur, `permissionTarget` = hedef agentId
  (kullanıcı "run_agent coder'a daima izin" kuralını kalıcılaştırabilir; `destructive` DEĞİL
  çünkü çocuğun her yıkıcı adımı zaten ayrıca soracak).
- Jail: çocuk, ebeveynin `cwd`'sini BİREBİR devralır; `run_agent` cwd/extraDirs parametresi
  ALMAZ (v1) — şef, kendi hapsinden geniş bir hapis dağıtamaz.
**Karar 4 — Derinlik ve hacim sigortaları:**
- Derinlik = 1: `parentRunId`'si olan koşuya `run_agent` aracı HİÇ verilmez (çocuk devredemez;
  sonsuz zincir yapısal olarak imkânsız — sayaç değil, aracın yokluğu).
- Koşu başına en çok `MAX_CHILD_RUNS = 8` çocuk; aşımı araç hatası döner.
- Çocuklar DAİMA tek-seferlik (`conversational` yok — `awaiting_user`'a park eden çocuk, şefin
  araç çağrısını süresiz bloklardı). Çocuklar sıralı koşar (v1; paralel çocuk v2 adayı).
- İptal zinciri: ebeveyn iptali önce çocukları iptal eder (kayıt `childRunIds` tutar);
  öksüz koşu kalmaz.
- Çocuk koşular M1 profil enjeksiyonunu NORMAL alır (damitici istisnası hariç — o kendi
  kuralını korur).

**Karar 5 — Maliyet stratejisi v1 = mevcut kural-tabanlı router + şef prompt'u; öğrenen router Faz 6'dır.**
`run_agent.model/provider` boşsa çözüm zinciri agent.start ile AYNI: çocuk tanımının model'i →
o da boşsa `pickModel(task)` (router). Şefin sistem prompt'u basit/mekanik alt görevleri yerel
modele, muhakeme isteyenleri buluta yönlendirmesini söyler ve `model`/`provider` parametreleriyle
pinleyebilir. Router v2 (geçmiş skorlardan öğrenen) bu ADR'nin kapsamı DIŞI — Faz 6.

**Karar 6 — Varsayılan "sef" agent'ı** (dördüncü default; `ensureDefaultAgent`): araçlar
`[read_file, glob, grep, run_agent]` (çalışma alanını inceleyip plan yapabilir, kendisi dosya
YAZAMAZ — yazma işini coder'a devretmek zorundadır: orkestra şefi enstrüman çalmaz), model boş
(router). Prompt: görevi ≥2 anlamlı alt göreve böl, her birine uygun agent+model seç, sonuçları
sentezle, nihai cevabı araçsız yaz.

**Ertelenenler (bilinçli, v2+):** paralel çocuk koşuları · gerçek görev kuyruğu (kapasite bekleyen
koşular) · derinlik>1 · agent'lar arası doğrudan mesajlaşma · çocuğa ayrı cwd verme.

**Geri dönüş koşulu:** `run_agent` izin/jail kabul testlerinden herhangi birini kırarsa ya da
şef koşuları maliyet görünürlüğünü bulanıklaştırırsa (kullanıcı hangi paranın nereye gittiğini
izleyemezse) dilim geri alınır; host-orkestrasyon (reddedilen 2. seçenek) yedek plandır.
