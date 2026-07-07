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
- **GPU kullanımı %** → "zorlanma nabzı": yük arttıkça küre hızlanır ve daha güçlü/sık atar;
  ayrıca sağ-üstteki GPU göstergesine doğru hafif "yaslanma" (yük yükseldiğinde o köşeye throb).
- **GPU sıcaklığı °C** → renk sıcaklığı: soğukken taban (cyan/mood) renginde, ısındıkça
  amber→kırmızıya karışır ("renk sıcaklığının artması"). Sıcaklık okunamazsa yük'ten türetilir.
- **VRAM doluluğu %** ("ön bellek şişmesi") → kürenin şişmesi (parçacık yarıçapı doluluğa göre büyür).
- **GPU HUD (sağ-üst):** `GPU %util · kullanılan/toplam GB · °C`; çubuk ve sayı ısıyla renklenir.
- GPU yoksa (nvidia-smi başarısız/AMD/Apple) katman sessizce kapanır; küre yalnız mood ile sürülür.
  Bulut/Claude tarafı zaten mood + Model panosuyla yansır. Saf mantık: `ui/scene/hardware-vitals.ts`.

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
