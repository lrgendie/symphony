# 🎨 TASARIM.md — Symphony Görsel Dil ve "Yaşayan Arayüz" Anayasası

> Bu belge kullanıcının benimsediği görsel kimliğin tek kaynağıdır. Arayüz (ui/desktop)
> üzerinde çalışan HER model buraya uyar. Referans görseller: `Tasarım/` klasörü
> (tesseract logosu, "A Living Interface", bağlam haritası).
>
> **Temel ilke (ROADMAP ile ortak):** Her animasyonun bir ANLAMI vardır — durum, yük ya da
> hata gösterir; süs değildir. "Yaşayan" demek, sistemin nabzını görselle konuşması demek.

## 1. Marka kimliği — Tesseract

Logo: **küp-içinde-küp (tesseract / hiperküp)**. Boyutsal küp = katmanlı sistem; düğümler =
sinaps/nöral bağlantı noktaları; kenarlardaki ışık akışı = sinaps atımı / veri akışı.

- **Dış kafes:** cyan (elektrik mavisi) — çerçeve, bağlantı, "sağlıklı akış".
- **İç kafes:** magenta/mor — iç katman, ajan/işlem düzlemi.
- **Tek kırmızı odak düğümü:** o anki aktif nokta ya da uyarı/hata — dikkatin gittiği yer.
- **Zemin:** çok koyu lacivert/siyah + soluk PCB (devre) dokusu.

### Palet (koddaki değerler — `ui/src/index.css` ile birebir)
| Rol | Değer | Anlam |
|---|---|---|
| `--cyan` | `#22d3ee` | çerçeve, sağlıklı bağlantı, "düşünüyor" akışı |
| `--magenta` | `#e879f9` | ajan/işlem düzlemi, sohbet |
| `--red` | `#ef4444` | hata, aktif odak, "dikkat" |
| `--green` | `#34d399` | başarı, "bağlı", tamamlandı |
| `--amber` | `#fbbf24` | bekleyen izin, uyarı |
| `--bg` | `#0a0b10` | koyu zemin |

Masaüstü varsayılan olarak KOYU temadır (marka bu). Tipografi: monospace (HUD hissi);
başlıklarda kalın, büyük harf, geniş harf aralığı (display).

## 2. Yaşayan Arayüz (Living Interface) — reaktif merkez

Referans: "A LIVING INTERFACE" görseli — merkezde **nefes alan parçacık küresi**, etrafında
HUD çerçeveleme. Slogan: *"Pure motion shaped by intent. The seed of an environment that
breathes back."* (Niyetle şekillenen saf hareket; geri nefes alan bir ortamın tohumu.)

**Parçacık küresi (Three.js / @react-three/fiber):** sistemin ambiyans "canlılığı".
Durum → görsel eşlemesi (her hareketin anlamı):
- **boşta (idle):** yavaş, düzenli nefes alıp verme (breathe); cyan, düşük parlaklık.
- **düşünüyor (thinking):** yüzeyde dalgalanma/ripple; cyan → daha parlak.
- **araç çalıştırıyor (executing):** hızlanma, sıklaşan atım; magenta tonu karışır.
- **izin bekliyor (awaiting):** amber nabız — kullanıcı eylemi bekleniyor.
- **hata (failed):** kısa kırmızı flaş + dağılma, sonra toparlanma.

**Fiziksel vitaller (donanım katmanı — 2026-07-07 eklendi):** Küre iki katman sürer.
Mood (yukarıdaki) sistemin NE YAPTIĞINI; donanım vitalleri fiziksel olarak NE HİSSETTİĞİNİ
gösterir. Kaynak: `hardware.updated` olayı (yerel GPU; NVIDIA v1, nvidia-smi ~2sn). Yalnız
gerçekten ölçülen telemetri kullanılır — uydurma metrik yok (ilke: her hareketin GERÇEK anlamı).

**Yük ifadesi = vektörel dalga (2026-07-07 revizyonu).** Erken sürüm yükü bir "zorlanma nabzı"yla
(ölçek titreşimi) gösteriyordu; kullanıcı bunu yüksek-frekans kalp atışı gibi buldu ve GPU %0→%100
sıçrayınca ANİ oluyordu. Yeni model: yük artık ölçeği titretmez; kürenin YÜZEYİNDE ilerleyen bir
**ses-dalgası** olur. İlke: ham veri sert, görsel yumuşak.
- **Yumuşatma:** ham GPU yükü/ısısı sert sıçrar → yumuşatma ile hedefe hızlı-ama-yumuşak biner,
  yavaş söner (afterglow). Kare-hızından bağımsız (exp) lerp; iniş/çıkış farklı zaman sabiti.
- **Vektörel dalga:** parçacıklar radyal normal boyunca ötelenir (`r = R + genlik·dalga`); dalga,
  yüzeyde ilerleyen sinüs + harmonik. Dalga sabit bir yöne — ekran **SAĞ-ÜST**, GPU göstergesinin
  yazılı olduğu taraf — doğru rulo yapar. Küre dönerken bu bölge ekranda SABİT kalsın diye dönüş
  world-uzayında pozisyona pişirilir (parçacıklar sabit "atılım bölgesi"nin içinden akar).
- **Yönlü keskinleşme:** odak yönüne (`normalize(1,1,0.4)`) hizanın pozitif lobu üsle keskinleştirilir
  (`max(0,dot)^p`) → genlik o dar bölgede büyür, "dalga yönüne doğru sivrilir" + sabit dışa atılım.
- **Yönlü renk:** tüm küreye tek-tip değil; ısı × odak bölgesi (+ dalga tepesi) ile per-parçacık
  taban→sıcak (turuncu-kırmızı) lerp → renk sıcaklığı dalga yönüne gelir, o bölge ısınır.
- **Ortak sürücü:** dalga genliği `max(GPU yükü, LLM aktivitesi)`. Yerelde GPU yükü sürer; bulut
  LLM'de (Claude/Gemini sesli sohbet gibi) GPU yükselmez, mood aktivitesi (thinking/executing/…)
  dalgayı sürer. Kaynak: `mood.ts` `activity` alanı + `hardware-vitals.ts` `load`.
- **Renk sıcaklığı** → ÖNCELİKLE GPU kullanımına bağlı: kullanım artınca taban (cyan/mood)
  renginden amber→kırmızıya kayar, kullanım düşünce soğur. GPU sıcaklığı yalnız GERÇEKTEN
  kızışınca (termal uyarı eşiği ~72°C üstü) ek sıcaklık katar — böylece boşta ~50°C idle'da
  laptop GPU'su rengi turuncuya kaydırmaz.
- **VRAM doluluğu %** ("ön bellek şişmesi") → kürenin şişmesi (yumuşak ölçek büyümesi, kalıcı).
- **Yumuşak nefes** (mood breathe) korunur — küre daima nefes alır; yalnız yük ifadesi ölçek→dalga oldu.
- **GPU HUD (sağ-üst):** `GPU %util · kullanılan/toplam GB · °C`; çubuk ve sayı ısıyla renklenir.
- GPU yoksa (nvidia-smi başarısız/AMD/Apple) katman sessizce kapanır; küre yalnız mood ile sürülür
  (LLM aktivitesi dalgayı yine de sürer). Saf mantık: `ui/scene/hardware-vitals.ts` + `ui/scene/wave-field.ts`.

**"Mimari durum" okuması (tesseract'ın ikinci işlevi):** tesseract yalnız logo değil, sistemin
CANLI mimari haritası olabilir — düğümler = daemon / sağlayıcılar / aktif ajanlar; kenar atımı =
o an akan veri; kırmızı düğüm = hata/odak. Sağlayıcı bağlanınca düğüm yanar, ajan koşarken
kenar atımı hızlanır. (Sonraki dilim; şu an dashboard düz panellerle başladı.)

**HUD çerçeveleme:** köşe braketleri, köşelerde küçük monospace teknik etiketler
(ör. `SYS.LINK ESTABLISHED`, `PROTO v1`, koşu durumu `IDLE/THINKING/EXECUTING`), soluk ızgara.

## 3. Bağlam Haritası (Context Map) — biriken/keşfedilebilir bilgi

Referans: "Karpathy method + Claude Code on your Obsidian vault … let it compound" görseli —
zamanla **compound eden** (büyüyen), yatay akan bir nöral/lif graf.

Vizyon: kullanıcının **kişisel konuşmaları, projeleri ve geliştirmeleri** bir bağlam haritası
gibi görünür — yaşayan, interaktif, keşfedilebilir. Obsidian graph'ına benzer ama zamansal ve
akışkan; düğümler arası lifler = ilişkiler/sinapslar. Her yeni oturum/koşu haritaya eklenir,
bağlam birikir.

- **Düğümler:** sohbet oturumları (SQLite `sessions`), agent koşuları (`agent_runs`),
  projeler, kullanıcı hafızası girdileri (Faz 6 `~/.symphony/memory/`).
- **Kenarlar:** zaman, aynı proje, aynı model, atıf/ilişki.
- **Etkileşim:** yakınlaş/uzaklaş, bir düğüme tıkla → detay (o oturumun dökümü, o koşunun
  adımları); zaman ekseninde "compound" akışı.
- **Veri kaynağı:** çoğu zaten var (SQLite v2/v3: sessions, messages, agent_runs, agent_steps).
  Bu yüzden bağlam haritası büyük ölçüde MEVCUT veriyi görselleştirmektir.

Bu, ROADMAP Faz 4'teki "Yol haritası görselleştirme" ve Faz 6 "Kullanıcı hafızası" ile
akrabadır; ayrı ve büyük bir girişimdir (kendi dilimleri olacak).

## 4. Uygulama sırası (öneri)

1. **Yaşayan Arayüz parçacık küresi** (Faz 4 sonraki dilim) — dashboard'un reaktif merkezi;
   ref görsel 2'nin doğrudan hedefi, ROADMAP'te zaten var. `@react-three/fiber`.
2. **HUD kabuğu** — köşe braketleri, teknik etiketler, display tipografi (mevcut panelleri sarar).
3. **Tesseract'ı canlı mimari haritasına bağlama** — düğümler = sistem bileşenleri.
4. **Bağlam Haritası** — SQLite verisinden zamansal graf (ayrı, büyük dilim; REST/protokol
   eklemesi gerekebilir → önce PROTOKOL.md).

## 5. Değişmezler

- Marka paleti tutarlı (yukarıdaki değerler); rastgele renk eklenmez.
- Her animasyonun anlamı var; performansı boğan süs yok (60fps hedef, parçacık sayısı ayarlı).
- Koyu tema esas; metin okunabilirliği (kontrast) korunur.
- Arayüz daemon'la YALNIZ `shared` protokolüyle konuşur (yeni veri gerekiyorsa önce PROTOKOL.md).
