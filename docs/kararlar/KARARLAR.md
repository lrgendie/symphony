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

## ADR-015 — Proje görünümü + yol haritası görselleştirme: cwd-türevi proje, sözleşmeli markdown, panel (2026-07-10, Fable)
**Bağlam:** ROADMAP Faz 4'ün son iki maddesi: "Proje görünümü: hangi projede hangi agent ne
yapıyor" + "Yol haritası görselleştirme: ROADMAP/plan dosyalarından üretilen interaktif faz-adım
grafiği; hangi adımda hangi agent çalışıyor canlı görünür". Mevcut altyapı: `agent.run.started`
olayı `cwd` taşıyor ama `ActiveRun` (snapshot) taşımıyor; SQLite `agent_runs` her koşunun
cwd'sini zaten kalıcı tutuyor; bu deponun ROADMAP kalıbı (`### Faz N` + `- [ ]/- [x]/- [~]`)
tutarlı ve parse edilebilir.

**Karar 1 — "Proje" = koşunun `cwd`'sinden OTOMATİK türetilir; kayıt defteri YOK (v1).**
Gruplama anahtarı cwd'nin kendisi (jail kökü — koşunun zaten değişmez gerçeği), görünen ad =
son dizin adı (basename), tam yol soluk alt bilgi. Sıfır kurulum, sıfır yeni dosya/komut.
*Reddedilen:* `~/.symphony/projects.json` kayıt defteri (ad+yol) — isimlendirme hoş ama yeni
dosya + CRUD komutu + Faz 7 sync sorusu getirir; kazanım küçük. Geri dönüş: basename çakışması
gerçek hayatta karışıklık yaratırsa v2'de isteğe bağlı adlandırma eklenir (türetme temel kalır).

**Karar 2 — Kapsam v1 = yalnız CANLI görünüm.** Proje görünümü, mevcut "Aktif koşular"
panelinin cwd'ye göre GRUPLANMASIDIR (proje başlığı altında koşu satırları; Faz 5 çocuk-koşu
girintisi grup İÇİNDE aynen sürer). ROADMAP maddesinin özü ("hangi projede hangi agent ne
yapıyor") canlıyla karşılanır. Geçmiş koşuların projeye göre dökümü (agent_runs zaten cwd
tutuyor → REST `/api/history` deseniyle sorgulanabilir) bilinçle v2 — yeni uç + UI yüzeyi
büyütür, canlı görünümün değerini beklemeye gerek yok.
**Protokol dokunuşu (ADDITIVE, PROTOCOL_VERSION=1):** `ActiveRunSchema.cwd?` — olay zaten
taşıyor, yalnız snapshot'a ekleniyor; masaüstü yeniden bağlanınca da gruplayabilsin diye.

**Karar 3 — Yol haritası YALNIZ bu deponun kendi kalıbını hedefler (sözleşmeli düz markdown).**
Sözleşme (parser'ın tek varsayımı): `### <başlık>` fazları açar; gövdedeki `- [ ]` todo,
`- [x]` bitti, `- [~]` devam sayılır; faz başlığındaki `✅` fazın kendisini bitti işaretler.
Parser SAF bir core modülüdür (`core/src/roadmap/parse.ts`, testli) ve girdisi HERHANGİ bir
dizindeki `ROADMAP.md`'dir — yani kullanıcı KENDİ projesine bu kalıpla bir ROADMAP.md koyarsa
o da görselleşir; kalıba uymayan dosya zarifçe "faz bulunamadı" döner (hata değil).
*Reddedilen:* her formatı anlayan genel ayrıştırma (LLM-destekli dönüştürme dâhil) — sınırsız
girdi uzayı, v1'i belirsizleştirir. Gerekirse v2: "agent'a roadmap'ini bu kalıba çevirt".
**REST (ADDITIVE):** `GET /api/roadmap?dir=<mutlak-yol>` (Bearer) → `{ phases: [{ title, done,
total, state: "done"|"in_progress"|"todo" }] }`; `<dir>/ROADMAP.md` yoksa 404. Masaüstü webview
dosya sistemine dokunamaz → daemon okur (loopback+token; CLI'nin zaten okuyabildiği dosya —
yeni yetki yüzeyi değil). Cevap şeması `shared/rest.ts`'e (history deseni).

**Karar 4 — Canlı "hangi adımda hangi agent" bağlaması v1'de YOK.** Görselleştirme statik
faz durumunu gösterir (done/in-progress/todo — `[~]` kalıpta zaten var). Koşu→adım bağlamak
için metin eşleştirme kırılgan, `agent.start.roadmapStep?` protokol eki ise gerçek talep
doğmadan spekülatif. Panel, aktif koşuları ZATEN aynı proje başlığı altında gösterdiğinden
"bu projede şu an kim çalışıyor + proje nerede duruyor" bilgisi yan yana düşer — v1 için yeter.

**Karar 5 — Görsel yön: mütevazı PANEL, interaktif GRAF DEĞİL.** Faz satırları + ilerleme
çubukları, mevcut Model panosu görsel diliyle (çubuk/metrik desenleri hazır). "Obsidian-graph
benzeri" büyük görselleştirme Faz 6 "Bağlam Haritası"nın işidir — roadmap paneli onu ÖN ALMAZ;
Bağlam Haritası tasarlanırken roadmap verisi o grafiğe bir katman olarak taşınabilir.
TASARIM.md'ye tek paragraflık not düşülür (dilim P3).

**Dikey dilimler (Kural 7):** P1 canlı proje gruplaması (ActiveRun.cwd? + UI grupla) →
P2 roadmap parser + REST → P3 masaüstü roadmap paneli + TASARIM notu + ROADMAP kapanışı.
Adım adım talimat `memo/DURUM.md`'de; uygulama Sonnet'te.

**Geri dönüş koşulu:** cwd-türevi gruplama gerçek kullanımda anlamsız gruplar üretirse
(ör. hep aynı tek dizinden çalışılıyorsa panel değer katmaz) P1 geri alınmaz ama v2 adlandırma
öne çekilir; parser sözleşmesi kullanıcının gerçek proje roadmap'lerini karşılayamazsa Karar 3
genişletmesi (dönüştürücü agent) yeniden değerlendirilir.

## ADR-016 — Faz 6 Zeka Katmanı: skor-destekli router v2, geri bildirim, deterministik rapor, bağlam haritası (2026-07-10, Fable)
**Bağlam:** ROADMAP Faz 6 — "öğrenen router v2", "otomatik şeffaf öneri", "kullanıcı hafızası",
"kendini geliştirme döngüsü (haftalık rapor)", "geri bildirim sinyalleri", "Bağlam Haritası".
Kullanıcı sıralamayı bağladı: **önce router zekası, sonra harita; açık geri bildirim DAHİL.**
Mevcut zemin: router v1 zaten "v2 skorları buraya oturur, arayüz aynı kalır" öngörüsüyle SAF
yazılmış (`router.ts`); öğrenmenin hammaddesi SQLite'ta birikmiş durumda (`requests`: model
başına tur gecikmesi/hata/maliyet; `agent_runs`: görev metni + completed/failed + maliyet).

**Karar 1 — Öğrenme verisi = MEVCUT tablolar; sorgu-zamanı agregasyon; fiziksel skor tablosu YOK.**
`store.routerStats(sinceMs)`: SQL'le çek, görev türünü TS'te `classifyTask(agent_runs.task)` ile
sorgu zamanında sınıflandır, `(provider, model, taskKind)` başına `{runs, ok, avgTurnMs,
avgCostUsd, iyi, kötü}` döndür. Gerekçeler: (a) kişisel kullanım hacminde satır sayısı küçük —
TS'te sınıflandırmak ucuz; (b) sınıflandırıcı geliştikçe GEÇMİŞ veri de yeni kurallarla yeniden
yorumlanır (sütunda donmuş `task_kind` bunu yapamaz); (c) göç yok, bakılacak ikinci gerçek yok.
İnce kurallar: **hız metriği `requests.duration_ms`'ten gelir** (`agent_runs` süresi insan
beklemesini — awaiting_permission/awaiting_user — içerir, model hızını ölçmez); **cancelled
koşular skora GİRMEZ** (kullanıcı vazgeçti — ne başarı ne başarısızlık); pencere son 30 gün
(sabit; config anahtarı gerçek talep doğarsa eklenir).
*Reddedilen:* ayrı skor tablosu/materialization — senkron tutulacak ikinci gerçek + göç, kazanım yok.

**Karar 2 — Router v2 = kural İSKELETİ + skor DÜZELTMESİ; deterministik, LLM/bandit YOK.**
`RouterContext.stats?` opsiyonel alan (SAF fonksiyon korunur; testte sahte stats). Kurallar:
- **MIN_SAMPLES = 3:** aynı görev türünde aynı model için ≥3 koşu yoksa o model hakkında kanıt
  YOK sayılır → v1 davranışı BİREBİR (soğuk başlangıç garantisi; ilk kurulum asla bozulmaz).
- **Skor formülü (Laplace düzeltmeli + açık geri bildirim 2× ağır):**
  `effOk = ok + 2·iyi`, `effRuns = runs + 2·(iyi+kötü)`, `score = (effOk + 1) / (effRuns + 2)`.
  Bir "kötü" işareti iki başarısız koşuya denk — açık sinyal örtükten güvenilir öğretmendir.
- **v2 YENİ aday üretmez** — v1'in ürettiği öneri listesini yeniden sıralar + gerekçelendirir:
  kanıtlı ve `score < 0.5` olan öneri listenin SONUNA iner (demote); kanıtlı ve en yüksek skorlu
  (≥ 0.5) öneri BAŞA çıkar (promote); reason string kanıtı GÖSTERİR ("son N koşuda %X başarı,
  ort. Ys/tur, ort. $Z/koşu") — ROADMAP kabul maddesinin ("gerekçesini gösteriyor") karşılığı.
  Kanıt yoksa v1 reason aynen kalır.
Tüketiciler: daemon `router.suggest` işleyicisi + engine `pickModel` — ikisi de
`store.routerStats()` geçirir. **Protokol DEĞİŞMEZ** (`reason` alanı zaten zorunlu) → Z1 protokolsüz.
*Reddedilen:* bandit/RL ya da LLM-hakem skorlama — tek kişilik veri hacminde istatistiksel
anlamı yok, determinizmi ve test edilebilirliği öldürür.

**Karar 3 — Faz 6 "kullanıcı hafızası" maddesi ADR-013 ile KAPANDI; RAG yine ertelendi.**
Profil enjeksiyonu + REST yüzeyi + damıtıcı (M1-M3) kabul maddesini ("hafızaya yazılan tercih
yeni oturumda agent bağlamında görülüyor") zaten karşılıyor — Faz 6'da yeni hafıza işi YOK,
ROADMAP maddesi nota bağlanır. Bağlam Haritası v1 kenarları embedding GEREKTİRMEZ (Karar 6) →
ADR-013'ün RAG geri dönüş koşulu ("kullanıcı 'şunu konuşmuştuk'u arıyorsa") aynen açık kalır.

**Karar 4 — Geri bildirim = `feedback.submit` (ADDITIVE WS isteği) + `feedback` tablosu (göç v5).**
Payload: `{ subject: "run"|"chat", id, verdict: "good"|"bad", note? }` → `feedback.submit.ok {}`
(wire değerleri tanımlayıcıdır → İngilizce; kullanıcıya görünen her şey Türkçe). `id` doğrulanır
(`agent_runs`/`sessions`'ta yoksa `VALIDATION_FEEDBACK_SUBJECT_UNKNOWN`). Tablo:
`feedback(id, at, subject_kind, subject_id, verdict, note)`. Yüzeyler v1: (a) TUI'de agent koşusu
bitince tek tuşluk opsiyonel satır (g=iyi / k=kötü, herhangi başka girişte sessizce geçilir —
akışı ASLA bloklamaz), (b) `symphony feedback <runId> iyi|kötü [-n not]` (geçmişten işaretleme).
Masaüstü yüzeyi v2 (protokol hazır, eklemesi ucuz). Skora bağlanma: Karar 2 formülündeki iyi/kötü.
*Reddedilen:* beğeni/geri-alma olaylarını örtük yakalama (ROADMAP "çıktıyı geri alma" sinyali) —
geri-alma mekanizması yok; uydurma vekil sinyal (ör. dosyayı elle değiştirdi = kötü) yanıltıcı.

**Karar 5 — Haftalık rapor = deterministik agregasyon; LLM YOK; REST `GET /api/report` (ADDITIVE).**
`GET /api/report?from=<ms>&to=<ms>` (Bearer) → JSON: toplam token/maliyet (gün ve model kırılımı),
model×görev-türü başarı tablosu (**Karar 1'deki routerStats ile AYNI kaynaktan — ikinci gerçek
üretme**), en sık hata kodları (telemetry), geri bildirim özeti, eşik-tabanlı bulgular. CLI
`symphony report [--from --to]` (vars. son 7 gün): JSON'u Türkçe markdown'a çevirir,
`~/.symphony/reports/YYYY-Www.md`'ye yazar + stdout'a basar. "Öneri" cümleleri deterministik
eşiklerden üretilir (ör. kanıtlı `score<0.5` model+tür çifti → "X, Y işlerinde son N koşuda %Z
başarı — bu tür için bulut önerilir"). **Lokallik kabul maddesi:** rapor/skor yolunda HİÇBİR
provider çağrısı yoktur; test bunu doğrular (rapor üretimi adapter/fetch çağırmaz).
Zamanlanmış üretim YOK — daemon'a zamanlayıcı açmak Faz 8'in haftalık döngüsüyle birleşir;
v1'de komut isteğe bağlı koşar (raporun penceresi haftalık → kabul maddesi karşılanır).
*Reddedilen:* rapor taslağını LLM'e yazdırmak — deterministik sayıların üstüne halüsinasyon
riski eklemek; istenirse v2'de damıtıcı deseniyle (taslak dosyası + insan onayı) gelir.

**Karar 6 — Bağlam Haritası v1 = MEVCUT verinin deterministik grafı; embedding YOK;
REST `GET /api/context-map` (ADDITIVE); masaüstünde AYRI görünüm; d3-force.**
- **Düğümler:** `sessions` (sohbet), `agent_runs` (koşu), koşu cwd'lerinden türetilen sanal
  PROJE düğümleri (ADR-015 Karar 1'in basename kuralı). `limit` parametresi, vars. son 500.
- **Kenarlar v1 (deterministik):** koşu→proje (cwd) + aynı-gün zamansal komşuluk (aynı takvim
  günü içinde ardışık öğeler zayıf kenarla — "compound" hissinin kaynağı). Model bağı kenar
  DEĞİL görsel kanal (düğüm rengi/filtre) — her şeyin tek modele bağlandığı çöp graf önlenir.
  Ebeveyn-çocuk koşu kenarı v1'de YOK: `agent_runs`'ta parent sütunu yok; gerçek talep doğarsa
  v6 göçüyle gelir (canlı olaydaki `parentRunId` DB'ye yazılmıyor — bilinçli sınır, not düşüldü).
- **Cevap:** `{ nodes: [{id, kind: "session"|"run"|"project", label, at, meta}], edges:
  [{from, to, kind: "project"|"same_day"}] }` — kurucu SAF core modülü (`core/src/context-map/`),
  testli; daemon yalnız sarar.
- **Görsel (TASARIM §3 bağlayıcı):** masaüstünde dashboard'dan AYRI görünüm (sekme/geçiş);
  2D kuvvet-yönlü yerleşim; tıkla→detay (oturum dökümü mevcut history REST'inden; koşu detayı
  v1'de `meta`dan). Bağımlılık: **d3-force** (yalnız simülasyon; render bizim) —
  GEREKSINIMLER.md'ye işlenir. *Reddedilen:* tesseract sahnesine (three.js) bindirmek — sahne
  sanattır, harita okunabilir bir araçtır; 2D'de etkileşim ucuz, okunabilirlik yüksek.
  *Reddedilen:* embedding'li anlamsal kenarlar — ADR-013'teki RAG erteleme gerekçesi aynen.

**Dikey dilimler (Kural 7; sıra kullanıcı kararı — önce zeka, sonra harita):**
Z1 routerStats + router v2 karışımı + tüketiciler (protokolsüz) → Z2 geri bildirim (PROTOKOL +
göç v5 + TUI/CLI yüzeyi) → Z3 rapor (REST + CLI markdown) → Z4 bağlam haritası verisi (REST +
SAF kurucu) → Z5 masaüstü harita görünümü (d3-force + TASARIM §3). Adım adım talimat
`memo/DURUM.md`'de; uygulama Sonnet'te.

**Geri dönüş koşulları:** skor düzeltmesi kötü öneriler üretirse `stats` geçirilmez (arayüz
opsiyonel — tek satırla v1'e dönüş); geri bildirim tuşu sürtünme yaratırsa TUI satırı kalkar,
komut kalır; harita 500 düğümde performansı boğarsa limit düşürülür, sanallaştırma v2'ye.

## ADR-017 — Faz 7 Paketleme ve Taşınabilirlik: npm yayını, installer'lar, sync, update/rollback, rehber (2026-07-10, Fable)
**Bağlam:** ROADMAP Faz 7 — installer'lar, CLI dağıtımı, `symphony sync`, otomatik güncelleme,
PDF rehber. Faz 8'in ön koşulu: kendini geliştirme döngüsünün dört sigortasından üçü hazır
(test ✅, telemetri ✅, onay kapısı ✅), **rollback bu fazın işi**. Kullanıcı kararları
(2026-07-10): 4 platform installer CI ile hazırlansın (Mac erişimi ileride doğabilir), sync
kapsamı = ayarlar+agent+hafıza (geçmiş DB HARİÇ), güncelleme manuel `update`+`rollback`
(arka plan otomatiği YOK), CLI dağıtımı = **halka açık npm yayını**. Mevcut zemin şaşırtıcı
ölçüde hazır: CLI daemon'ı `require.resolve("@symphony/core/daemon")` ile başlatıyor (repo
yoluna bağımlı DEĞİL — kurulu node_modules'ta da çalışır); tek eksik yayın metadata'sı ve
`private:true` bayrakları. npm kontrolü (2026-07-10): `@symphony/*` paketleri YOK (404);
scope'un sahiplenilebilirliği ancak yayın anında (npm login ile org denemesi) netleşir.

**Karar 1 — Yayın birimi: ÜÇ paket (`shared`+`core`+`cli`), lockstep tek sürüm; scope yayın
anında bağlanır.** CLI, core+shared'a workspace bağımlılığıyla yayınlanır (pnpm publish
`workspace:*`'ı gerçek sürüme çevirir); tek pakete bundle'lama REDDEDİLDİ (better-sqlite3/
keytar native modülleri bundler'a girmez, üç paket yayını daha dürüst). Sürüm tek kaynaktan:
kök `package.json.version` → build sırasında koda gömülmez, `DAEMON_VERSION` core'un kendi
package.json'ından okunur (hardcoded "0.1.0" kalkar). `ui`/`desktop` npm'e YAYINLANMAZ
(masaüstü dağıtımı installer'ın işi). Scope: yayın oturumunda önce `@symphony` org'u denenir
(ücretsiz, public); ALINMIŞSA kullanıcının npm kullanıcı-scope'u ya da uygun bir org adı
seçilir ve üç paketin adı repo çapında mekanik olarak yeniden adlandırılır — iç `@symphony/*`
adı yayın adından ayrışmaz (publishConfig ile ad değiştirme pnpm'de kırılgan, REDDEDİLDİ).
*Reddedilen:* tek-dosya binary (pkg/bun compile) — native modüller kırar, DEVIR.md tuzak listesi.

**Karar 2 — Installer'lar: Tauri bundler, 4 hedef GitHub Actions matrix'inde, İMZASIZ v1.**
Windows x64 (.msi, lokal de derlenebilir/test edilir) + Windows ARM64 + macOS Intel + macOS
Apple Silicon (.dmg) `.github/workflows/release.yml`'de tag (v*) tetiklemeli derlenir,
GitHub Releases'a artifact olarak yüklenir. Code signing v1'de YOK (SmartScreen/Gatekeeper
uyarısı kabul edilir — kişisel kullanım; sertifika edinilirse ayrı dilim). macOS paketleri
Mac erişimi doğana dek DOĞRULANMAMIŞ sayılır (Releases notuna yazılır). Masaüstü kabuk
kurulu sürümde token'ı zaten `~/.symphony/daemon.token`'dan okur — installer'a özel daemon
işi yok; CLI'nin `desktop-launch.ts`'i kurulu uygulamayı bilinen kurulum yolundan
(`%LOCALAPPDATA%/Programs` vb.) ya da `config.desktop.appPath`'ten bulacak şekilde genişler
(bugünkü "yalnız repo checkout" sınırı kalkar).

**Karar 3 — `symphony sync`: `~/.symphony` İÇİNDE git deposu, açık BEYAZ LİSTE, uzak repo
kullanıcının verdiği herhangi bir git URL'i.** Senkronlanan: `config.json`, `providers.json`,
`agents/`, `memory/`, `mcp-servers.json`. ASLA senkronlanmayan (`.gitignore` + savunma
katmanı olarak beyaz liste dışı her şey): `daemon.token`, `data/` (SQLite — makineye özgü,
binary çakışması riski), `logs/`, `desktop.pid`, `reports/` (türetilmiş). Anahtarlar zaten
keychain'de (ADR-006) — sync anahtarsız güvenli (satır 82'deki öngörü). Akış: `symphony sync`
= add+commit (varsa) → `pull --rebase` → push; rebase çakışmasında işlem DURUR ve kullanıcıya
dosya yolu + çözüm talimatı basılır (otomatik çakışma çözümü YOK — config dosyasında sessiz
yanlış birleştirme kabul edilemez). Kimlik doğrulama sistemin git credential helper'ına
bırakılır (yeni auth sistemi YAZILMAZ). Uygulama `simple-git` ile (GEREKSINIMLER envanterinde
zaten planlıydı). *Reddedilen:* DB'yi de senkronlamak (kullanıcı kararı; bozulma riski).

**Karar 4 — Güncelleme/rollback: manuel `symphony update` + `symphony rollback`; güncelleyici
= CLI'de küçük, bağımsız komut çifti; daemon kendini GÜNCELLEYEMEZ.** `update`: registry'den
son sürümü sorar → `npm i -g <cli>@<yeni>` çalıştırır → başarılıysa `~/.symphony/versions.json`'a
`{previous, current, at}` kaydı düşer → daemon'ı yeniden başlatır. `rollback`: versions.json'daki
`previous`'a aynı yolla döner (ROADMAP kabulü: "güncelleme tek komutla geri alınabiliyor").
"Güncelleyici çekirdek ayrı ve dokunulmaz" ilkesinin v1 karşılığı: update/rollback mantığı
agent araç yüzeyinden ERİŞİLEMEZ (Faz 8'in Doktor agent'ı yama ÖNERİR, uygulama daima bu
insan-tetiklemeli komuttan geçer) ve bu iki komutun kendisi minimal tutulur (npm'e delege).
Masaüstü güncellemesi v1'de installer'ı yeniden çalıştırmaktır; Tauri updater plugin
REDDEDİLDİ (imza+manifest altyapısı ister, arka plan otomatiği kullanıcı kararına aykırı).

**Karar 5 — Rehber: `docs/REHBER.md` kaynak markdown; PDF `md-to-pdf` devDependency'siyle
`docs:pdf` script'inden derlenir.** İçerik iskeleti: sistem nedir → mimari şema (paket grafiği
+ daemon merkezli model) → kod haritası (BAGLAM.md'nin okuyucu-dostu hâli) → agent/araç/izin
sistemi → protokol özeti → komut başvurusu → kurulum+sync+update. Belge kodla birlikte büyür;
PDF teslimi "tüm sistem tamamlanınca" (ROADMAP) — script şimdiden çalışır durumda olur.
*Reddedilen:* pandoc (harici binary kurulumu ister, npm envanteri dışı).

**Dikey dilimler (Kural 7; sıra bağımlılığa göre):**
F1 paketlenebilir çekirdek (sürüm tek-kaynak + metadata + `pnpm publish --dry-run` temiz) →
F2 npm yayını (scope bağlama KULLANICIYLA + gerçek yayın + temiz makine simülasyonu kabulü) →
F3 Windows .msi (lokal tauri build + kurulu masaüstünü bulma) →
F4 `symphony sync` (beyaz liste + git akışı + ikinci-makine kabulü) →
F5 `symphony update`/`rollback` (versions.json + kabul testi) →
F6 GitHub Actions release matrix (4 platform + npm publish job) →
F7 REHBER.md + docs:pdf (BAĞIMSIZ — istenirse öne alınabilir).
Adım adım talimat `memo/DURUM.md`'de; uygulama Sonnet'te.

**Geri dönüş koşulları:** `@symphony` scope'u alınamazsa yeniden adlandırma F2 içinde tek
mekanik commit'tir (başka dilimi etkilemez); npm yayını herhangi bir nedenle istenmezse F2
"GitHub Releases tarball" yoluna düşer (F1 değişmez — metadata her iki yola da hizmet eder);
ARM64/macOS runner'ları derlemede kırılırsa matrix'ten çıkarılır, Windows x64 kalır (F6
kabulü yalnız x64 üstünden verilir); sync rebase akışı pratikte sürtünme yaratırsa
"yalnız pull ya da yalnız push" alt komutlarına ayrıştırılır (beyaz liste değişmez).
