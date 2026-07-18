# 🎼 Symphony — Mimari ve Kullanım Rehberi

*[🇬🇧 English version](REHBER.en.md)*

> Kaynak: bu dosya (`docs/REHBER.md`). PDF'e derlemek için: `pnpm docs:pdf`
> (`docs/REHBER.pdf` üretir). Belge kodla birlikte büyür — sistem değiştikçe burası
> güncellenir; ADR-017 Karar 5'in öngördüğü gibi tam teslim sürümü tüm sistem
> tamamlanınca çıkar, ama iskelet ve içerik şimdiden gerçek ve güncel tutulur.

## 1. Symphony nedir?

Symphony; yerel (Ollama üzerinden çalışan açık modeller) ve bulut (Claude, GPT, Gemini)
büyük dil modellerini ve kod yazan/düzenleyen **agent'ları** tek bir arka plan sürecinden
(`symphonyd`) yöneten, Windows/macOS/ARM çapraz platform bir orkestrasyon sistemidir.
Terminal (`symphony` komutu) ve masaüstü uygulaması aynı daemon'a bağlanan iki eş zamanlı
arayüzdür — birinde başlattığın bir agent koşusunu diğerinde canlı izlersin.

**Temel fikir:** LLM çağrıları, agent koşuları, izin kararları, kullanım/maliyet takibi ve
model seçimi tek bir yerde (daemon) toplanır; CLI ve masaüstü yalnızca bu daemon'un
**istemcileridir**. Hiçbir arayüz kendi başına bir sağlayıcıya (Anthropic, OpenAI, Ollama...)
doğrudan bağlanmaz — hepsi daemon üzerinden geçer. Bu sayede:

- Aynı sohbeti/agent koşusunu terminalde başlatıp masaüstünde izleyebilirsin (ya da tersi).
- Kullanım/maliyet, hata telemetrisi ve model performans skorları tek bir yerde birikir.
- API anahtarları tek bir yerde (OS keychain) saklanır, hiçbir istemci koduna gömülmez.

## 2. Mimari şema

### 2.1 Paket grafiği (monorepo)

```
shared  →  core  →  ┌── cli
                     ├── ui
                     └── desktop
```

- **`shared`** — protokolün TEK kaynağı: WS/REST mesajlarının zod şemaları + ortak tipler.
  Hiçbir pakete bağımlı değildir; tarayıcıda da (ui) çalışacak kadar saftır.
- **`core`** — `symphonyd` daemon'ının kendisi: provider adaptörleri, SQLite veri katmanı,
  agent motoru (izin sistemi + araç seti), model yönlendirici, WS/REST sunucusu.
- **`cli`** — `symphony` komutu: terminal arayüzü (Ink tabanlı TUI + commander alt komutları).
  Daemon'u gerekirse otomatik başlatır (`ensureDaemonRunning`).
- **`ui`** — React+Vite masaüstü paneli. Yalnız `shared`'a bağımlıdır (core'a DEĞİL) — tarayıcı
  içinde de, Tauri webview içinde de çalışabilir.
- **`desktop`** — Tauri 2 kabuğu: `ui/dist`'i native bir pencerede paketler, daemon token'ını
  dosyadan okuyup webview'e güvenli şekilde enjekte eder.

Bağımlılık yönü **tek taraflıdır**: `shared` hiçbir paketi bilmez, `core` yalnız `shared`'ı
bilir, üst paketler `core`'u kullanır ama `core` hiçbirini bilmez.

### 2.2 Daemon merkezli çalışma modeli

```
                         ┌─────────────┐
        terminal ───WS──▶│             │◀──WS─── masaüstü (Tauri)
       (symphony)         │  symphonyd  │
                         │  (core)     │
                         └──────┬──────┘
                                │
                    ┌───────────┼───────────┐
                    ▼           ▼           ▼
              provider'lar   SQLite     ~/.symphony/
           (Anthropic/GPT/  (geçmiş,    (config, agent
            Gemini/Ollama)  telemetri,   tanımları,
                             skorlar)     hafıza, anahtar
                                          DIŞI ayarlar)
```

- Daemon `127.0.0.1:7770`de dinler (yapılandırılabilir), yalnız loopback'e bağlanır.
- Kimlik doğrulama: açılışta üretilen rastgele bir token `~/.symphony/daemon.token`'a yazılır;
  istemciler bunu REST'te `Authorization: Bearer`, WS'te ilk `hello` mesajında sunar.
- Kalıcı veri (`~/.symphony/data/symphony.db`, SQLite): sohbet geçmişi, agent koşu kayıtları,
  hata telemetrisi, kullanım/maliyet sayaçları. Bu verinin üstüne kurulan model yönlendirici,
  hangi model/sağlayıcının hangi görev türünde daha başarılı/hızlı/ucuz olduğunu öğrenir.

## 3. Kod haritası

En sık dokunulan dosyalar ve ne işe yaradıkları (tam harita, oturum-içi güncel hâliyle
`memo/BAGLAM.md`'dedir — bu bölüm o haritanın okuyucuya dönük özetidir):

| Alan | Dosya | Ne yapar |
|---|---|---|
| Protokol şemaları | `packages/shared/src/protocol/*.ts` | Her WS mesajı/olayı + REST cevabı için zod şeması |
| Daemon (tek dosya) | `packages/core/src/server/daemon.ts` | Fastify+ws sunucusu; TÜM istek işleyicileri burada |
| Agent motoru | `packages/core/src/agent/engine.ts` | Koşu döngüsü, izin kapısı, durum makinesi, iptal |
| İzin sistemi | `packages/core/src/agent/permissions.ts` | deny > allow > risk sınıfı varsayılanı |
| Araç seti | `packages/core/src/agent/tools.ts` | `read_file`/`write_file`/`edit`/`glob`/`grep`/`run_command` |
| Workspace jail | `packages/core/src/agent/jail.ts` | Agent'ın `cwd` dışına çıkamamasını garanti eder |
| Model yönlendirici | `packages/core/src/router/router.ts` + `stats.ts` | Kural + geçmiş performansa dayalı model önerisi |
| Provider adaptörleri | `packages/core/src/providers/*.ts` | Anthropic/OpenAI/Google/Ollama — tek arayüz |
| Veri katmanı | `packages/core/src/db/store.ts` | SQLite: göçler, geçmiş/telemetri/skor okuma-yazma |
| CLI giriş noktası | `packages/cli/src/index.ts` | Tüm alt komutların commander kayıtları |
| CLI-daemon köprüsü | `packages/cli/src/client/daemon-client.ts` | WS istemcisi + otomatik daemon başlatma |
| Masaüstü store | `packages/ui/src/store.ts` | WS olaylarını UI durumuna çeviren TEK yer |
| Yaşayan sahne | `packages/ui/src/scene/TesseractScene.tsx` | Sistem durumunu canlı 3B görselleştirme |

## 4. Agent, araç ve izin sistemi

Bir **agent**, `~/.symphony/agents/<ad>.md` dosyasıyla tanımlanır: hangi modeli/sağlayıcıyı
kullanacağı, hangi araçlara erişebileceği, sistem prompt'u. İki varsayılan agent hazır gelir:
`coder` (tam araç seti) ve `asistan` (salt-okur — dosya değiştiremez, komut çalıştıramaz).

**Araç seti:**

| Araç | Risk sınıfı | Ne zaman izin ister |
|---|---|---|
| `read_file`, `glob`, `grep` | güvenli | asla — otomatik izinli |
| `write_file`, `edit` | değiştirici | her zaman — birleşik diff ile |
| `run_command` | değiştirici | her zaman — komut metniyle |
| `run_agent` (başka bir agent'a devretme) | hedefe göre | hedef salt-okursa otomatik, değilse sorar |
| dosya silme / `git push` / ağ yazması | yıkıcı | her zaman — "daima izin ver" seçeneği SUNULMAZ |

**İzin akışının değişmezleri:**

1. Araç çalıştırmanın **tek kapısı** izin denetimidir — bunu atlayan bir kod yolu yoktur.
2. Karar sırası: `permissions.json`'daki `deny` kuralı > `allow` kuralı > o koşuya özgü
   geçici güven (`allow_for_run`) > risk sınıfının varsayılanı.
3. `write_file`/`edit` her zaman **birleşik diff** ile sorulur — ne değişeceğini onaylamadan
   göremeden hiçbir şey yazılmaz.
4. Agent, çalışma alanının (`cwd`) **dışına çıkamaz** — her dosya yolu çözümlenip sınır
   kontrolünden geçer; kaçış girişimi aracı çalıştırmaz.
5. Agent kendi yapılandırmasına (`~/.symphony/`) yazamaz; `permissions.json` yalnız senin
   verdiğin izin kararlarıyla güncellenir.

Bir agent başka bir agent'a görev **devredebilir** (`run_agent` aracı, Faz 5) — bu, dashboard'da
üst koşunun altında girintili "çocuk koşu" olarak görünür; kendi izin isteklerini kendisi açar.

## 5. Protokol özeti

İstemciler (CLI, masaüstü) daemon ile **yalnız** `packages/shared`'daki zod şemalarıyla
konuşur — şemasız bir mesaj gönderilemez/işlenemez. İki kanal:

- **WebSocket** (`ws://127.0.0.1:7770/ws`) — olay akışı + uzun ömürlü işlemler (sohbet,
  agent koşusu). Tüm mesajlar tek bir zarf biçimindedir: `{ id, type, ts, replyTo, payload }`.
  Her istek en az bir cevap alır (`<type>.ok` ya da `error`); olaylar `replyTo` taşımaz,
  bağlı **tüm** istemcilere yayınlanır — terminal⇄masaüstü eş zamanlılığının kaynağı budur.
- **REST** (`http://127.0.0.1:7770/api/...`) — durum sorguları ve tek seferlik komutlar:
  sağlık sondası, sohbet geçmişi, kullanıcı profili, yol haritası, kullanım raporu, bağlam
  haritası, temiz kapanış (`POST /api/shutdown`).

**Agent koşusunun durum makinesi:**

```
queued → thinking → executing_tool → thinking → ... → completed
              ↘ awaiting_permission ↗                ↘ failed
              ↘ awaiting_user ↗ (konuşmalı agent)      ↘ (her durumdan) cancelled
```

Yeniden bağlanmada olay geçmişi **tekrar oynatılmaz** (replay yok) — bunun yerine `hello.ok`
cevabı aktif koşuların/izinlerin/sağlayıcı durumunun tam bir anlık görüntüsünü (`snapshot`)
verir; kalıcı sohbet geçmişi ayrıca REST ile sorgulanır.

## 6. Komut başvurusu

```
symphony                          Argümansız: TUI (model/agent seçici + sohbet)
symphony status                   Daemon, sağlayıcı sağlığı, kullanım özeti
symphony models                   Tüm sağlayıcıların kullanılabilir modelleri
symphony watch                    Daemon olay akışını canlı izle
symphony agents                   Kayıtlı agent tanımlarını listele
symphony agent <ad> "<görev>"      Agent koşusu başlat (izinle onaylarsın)
symphony add <npm-paketi>         MCP sunucusunu araç olarak kaydet (eklenti sistemi)
symphony feedback <runId> iyi|kötü Geçmiş bir koşuyu işaretle (model yönlendiriciyi besler)
symphony report [--from --to]     Kullanım raporu (token/maliyet, başarı tablosu, bulgular)
symphony history [oturum]         Sohbet geçmişi: liste ya da tek oturumun dökümü
symphony memory show|path|distill Kullanıcı profili (kalıcı hafıza) yönetimi
symphony sync init <depo-url>     ~/.symphony ayarlarını git deposuna bağla (yeni makine)
symphony sync                     Ayarları uzak depoyla eşitle
symphony update                   npm'de yeni sürüm varsa kur, daemon'ı yeniden başlat
symphony rollback                 Son update'ten önceki sürüme dön
symphony doctor [--kod <kod>]     Tekrarlayan hatayı sandbox'ta teşhis edip yama önerisi üretir
symphony patches                  Yama önerilerini + kategori sicilini listele
symphony patch apply <id>         Yamayı canlıya al (build+test+restart; bozuksa otomatik geri alır)
symphony patch reject <id>        Yama önerisini reddet, dalını sil
symphony patch trust <kategori>   Kategoriye güven (sonraki temiz yamalar sormadan uygulanır)
symphony patch untrust <kategori> Kategoriden güveni geri çek
symphony bekci ekle <ad> <repo> <log> [--test <komut>]   Kendi projeni izlemeye al
symphony bekci liste              Kayıtlı bekçi projelerini listele
symphony doctor --proje <ad>      Bekçi projesi için AYNI teşhis/yama boru hattını çalıştır
symphony agent-oneri uygula <agentId>   Agent tanım önerisini uygula (model pinler, onay ister)
symphony harita ekle <id> [--baslik X]  Bir sohbeti/koşuyu haritaya sabitle (id ön eki yeter)
symphony harita liste             Sabitlenmiş bağlamları ve grupları listele
```

## 7. Kurulum, senkronizasyon ve güncelleme akışı

**İlk kurulum:**

```
npm install -g @lrgendie/cli
symphony
```

İlk çalıştırmada `~/.symphony/` dizini oluşturulur (config, agent tanımları, yerel veri).
API anahtarların OS keychain'inde saklanır — hiçbir zaman diske düz metin yazılmaz.
Masaüstü uygulaması kuruluysa `symphony` başlatıldığında otomatik açılır (kapatmak için
`~/.symphony/config.json` → `{"desktop":{"autoLaunch":false}}`).

**İkinci bir makineye taşınma:**

```
symphony sync init <özel-git-depo-url>
```

Ayarlar (`config.json`, `providers.json`, agent tanımları, hafıza, MCP kayıt defteri) yeni
makineye iner. **Asla senkronlanmayan:** daemon token'ı, SQLite veritabanı, loglar, PID
dosyası — bunlar makineye özgüdür ya da zaten gerekmez. Anahtarlar keychain'de kaldığı için
sync anahtarsız güvenlidir.

**Güncelleme ve geri alma:**

```
symphony update      # npm'de yeni sürüm varsa kurar, daemon'ı yeniden başlatır
symphony rollback    # bir önceki sürüme döner
```

Güncelleme npm registry'ye delege edilir; kendi otomatik-güncelleme mekanizması yoktur ve
arka planda kendiliğinden çalışmaz — her zaman senin tetiklemenle, tek komutla geri
alınabilir şekilde çalışır. Bu, kendini geliştiren agent'ların (Faz 8) ihtiyaç duyacağı
"geri alma" güvencesinin de temelidir.

## 8. Kendini geliştirme (Faz 8, ADR-018)

Symphony kendi kaynak koduna karşı çalışabilir — tamamen insan tetiklemeli, hiçbir adımı
arka planda sessizce yürümez:

1. **Teşhis:** daemon, tekrarlayan hata kodlarını deterministik bir eşikle izler (LLM'e
   "hangi hata önemli" sorulmaz). Günde bir bu tarama otomatik çalışır ve aday bulunca
   canlı log akışına bir uyarı düşer.
2. **`symphony doctor`:** seçilen hata için izole bir `git worktree` açar, teşhis dosyasını
   yazar, `doktor` agent'ını (sabit model — güvenilir araç çağrısı şart) o sandbox'ta
   çalıştırır; boru hattı build/test/lint'i **kendisi** koşturur (agent'ın "geçti" beyanına
   güvenilmez). Sonuç bir **yama önerisidir** — hiçbir şey otomatik uygulanmaz.
3. **`symphony patch apply <id>`:** öneriyi ana dala merge eder, build+test'i tekrar koşar,
   daemon'ı yeni kodla yeniden başlatır. Herhangi bir adım (test, ya da daemon'ın yeniden
   ayağa kalkması) başarısız olursa **otomatik olarak geri alır** ve eski koda döner —
   izin sistemi (jail, agent tanımları, anahtarlar, token) gibi değişmez dosyalara dokunan
   yamalar için onay hiçbir bayrakla atlanamaz.
4. **Güven merdiveni:** bir kategori (hata kodu) tekrar tekrar sağlıklı sonuç verirse
   `symphony patch trust <kategori>` ile o kategoriye güvenilebilir — sonraki temiz yamalar
   `symphony doctor` içinde sormadan uygulanır. Değişmez dosyalara dokunan kategoriler asla
   güvenilir sayılmaz.
5. **`symphony report`** artık bir "Kendini Geliştirme" bölümü de içerir: güncel tekrarlayan
   hatalar, önerilen/uygulanan/geri alınan yama sayıları, kategori sicili. Bu rapor haftada
   bir kendiliğinden de üretilir (`~/.symphony/reports/`).
6. **Agent tanım-güncelleme önerisi:** bir agent (pinlenmemişse, yani model alanı boşsa) geçmişte
   birden fazla modelle çalışmışsa ve biri açıkça daha başarılıysa, `symphony report` bunu
   "Agent Tanım Önerileri" bölümünde gösterir. `symphony agent-oneri uygula <agentId>` diff'i
   gösterip onay ister, onaylarsan yalnız o agent'ın modelini sabitler — daemon yeniden başlamaz.
   Zaten pinli bir agent için ASLA alternatif önerilmez (kanıt yok, tahmin olurdu).
7. **Bekçi modu (v1):** kendini geliştirme SENİN projelerin için de çalışır.
   `symphony bekci ekle <ad> <repo-yolu> <log-dosyası> [--test <komut>]` ile bir proje
   kaydedersin — daemon o log dosyasını 10 saniyede bir izler, `error`/`exception`/
   `traceback`/`fatal` deseni yakalarsa bir uyarı düşer. `symphony doctor --proje <ad>`
   AYNI teşhis→sandbox→yama boru hattını çalıştırır, yalnız senin projenin `repoPath`'inden
   ve senin verdiğin `--test` komutuyla (vermezsen yama testsiz/dürüstçe işaretlenir —
   asla sessizce "geçti" sayılmaz). **Şart:** `repo-yolu` gerçek bir git deposunun KÖKÜ
   olmalı — değilse kayıt reddedilir (bir üst dizinin repo olması yeterli değildir).

## 9. Bağlam Haritası (ADR-016 Karar 6 + ADR-019)

Masaüstündeki "Bağlam Haritası" sekmesi, sohbetlerini/agent koşularını **kürasyonlu, tarihsel**
bir grafta gösterir — düğümler: sohbet, koşu, proje, model (yerel/API ayrımıyla), agent, hafta;
kenarlar: agent→koşu→model üçlüsü, aynı-gün komşuluğu, kürasyon (sabitleme/bağlantı/üyelik).

- **Küratörlü sabitleme:** "bunu haritaya ekleyelim" dediğin an kalıcı bir düğüm doğar —
  masaüstünde bir düğüme tıklayıp "Haritaya sabitle" ile, **TUI'de** aktif sohbet/koşu
  ekranında `/harita [başlık]` yazıp Enter'a basarak (modele GÖNDERİLMEZ, tek satır onay
  gelir), ya da **komut satırından** geçmiş herhangi bir oturum/koşu için
  `symphony harita ekle <sessionId|runId> [--baslik X]` (id'nin ön eki yeter, `symphony
  history`teki kısa-id kolaylığıyla AYNI). Sabitlenen bir öğe bir daha ASLA otomatik silinmez
  ve haftalık katlanmadan MUAF tutulur (aşağıya bak).
- **Gruplama ve bağlama:** masaüstünde "Grupla"/"Bağla"/"Üye ekle"/"Kopar" düğmeleriyle
  düğümleri birbirine bağlayabilir ya da bir grup altında toplayabilirsin. `symphony harita
  liste` sabitlenmiş bağlamları ve grupları (ne zaman eklendiği, neyi işaret ettiği) sıralı
  gösterir.
- **Haftalık katlanma:** içinde bulunduğun ISO haftası dışındaki (ve sabitlenmemiş) öğeler
  tek tek gösterilmez — hafta başına TEK bir düğüme katlanıp haritanın alt kenarına kronolojik
  dizilir. Bu, harita büyüdükçe karman-çorman olmasını önler; geçmiş bir haftaya tıklayıp
  "Haftayı aç" ile o haftanın tam grafını (drill-down) görebilirsin. DB'den hiçbir şey
  silinmez — katlanma yalnız GÖRÜNÜM kuralıdır.
- **`symphony sync` kürasyonu TAŞIMAZ (bilinçli):** haritadaki sabitlemeler/gruplar yerel
  SQLite'ta (`~/.symphony/data/`) tutulur — bu, sync'in "veritabanı asla senkronlanmaz"
  kuralının (bkz. §7) doğal bir uzantısıdır. Çok-makine kürasyon paylaşımı ileride ayrı bir
  dışa/içe-aktarma komutuyla (JSON) gelebilir; bugün için harita her makinede kendi kürasyonunu
  tutar.
