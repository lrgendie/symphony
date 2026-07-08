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
| `--red` | `#ef4444` | hata, aktif odak, "dikkat" — tesseract çekirdeği |
| `--green` | `#34d399` | başarı, "bağlı", tamamlandı |
| `--amber` | `#fbbf24` | bekleyen izin, uyarı |
| `--copper` | `#c9803f` | tesseract DIŞ iskeleti: donanım/enerji düzlemi (metalik bakır) |
| `--violet` | `#a78bfa` | sinaps kapı düğümleri, iç akış derinliği |
| `--bg` | `#0a0b10` | koyu zemin |

> Bakır + violet 2026-07-08'de eklendi (referans: `Tasarım/görsel1.png` + `görsel2.png`).
> Logo grafiği cyan/magenta kalır; bakır YALNIZ yaşayan tesseract sahnesinin donanım düzlemidir.

Masaüstü varsayılan olarak KOYU temadır (marka bu). Tipografi: monospace (HUD hissi);
başlıklarda kalın, büyük harf, geniş harf aralığı (display).

## 2. Yaşayan Arayüz (Living Interface) — reaktif merkez

Referans: "A LIVING INTERFACE" görseli — merkezde **nefes alan parçacık küresi**, etrafında
HUD çerçeveleme. Slogan: *"Pure motion shaped by intent. The seed of an environment that
breathes back."* (Niyetle şekillenen saf hareket; geri nefes alan bir ortamın tohumu.)

**YAŞAYAN TESSERACT (2026-07-08 revizyonu — küre emekli edildi).** Merkez artık parçacık
küresi değil, markanın kendisi: **canlı tesseract**. Referans: `Tasarım/görsel1.png` +
`görsel2.png`. Küre dönemi (dilim 3–7) ve vektörel-dalga modeli git geçmişinde
(`ui/scene/wave-field.ts`, silindi); yumuşatma ilkeleri ve anlam eşlemesi tesseract'a taşındı.

**Topoloji (`ui/scene/tesseract/geometry.ts` — SAF, testli) — ÜÇ KADEMELİ KÜP (2026-07-08
sinematik revizyon):** dış+iç küp gerçek 4B hiperküp projeksiyonudur: 16 köşe = (±1,±1,±1,±1);
`w=+1` → **dış küp**, `w=−1` → **iç küp** (perspektif bölme `f=K/(K−w)`, K=3 → 2:1 derinlik).
Üçüncü kademe **DERİN küp** = iç kübün merkeze ölçekli kopyası (DEEP_SCALE 0.48; görsel1'deki
en içteki mor küp) — iç küple nefes alır/şişer. Akış zinciri merkeze sıralı: 8 **köprü**
(dış→iç) → 8 **bağ** (iç→derin) → 8 **spoke** (derin→çekirdek); + küp başına 12 kenar = 60 kenar,
25 düğüm. **Hiper-dönüş:** XW düzleminde salınan 4B dönüş (±~0.38 rad — küpler kimlik
DEĞİŞTİRMEZ); hızı canlılıkla artar, görev tamamlanınca kısa süre dalgalanır ("boyut değiştirme").

**Malzeme düzlemleri (her düzlemin anlamı ayrı):**
- **Dış küp + köprüler = BAKIR (`--copper`), metalik (MeshStandard + ışıklar):** fiziksel/donanım
  düzlemi. GPU yükü bu iskelette **enerji atımları** (yavaş, ağır korlar) doğurur; ısı bakır koru
  kırmızıya kaydırır (termal eşik kuralı korunur: ~72°C altı yalnız yük ısıtır).
- **İç küp = CYAN sinaps ağı (GLSL akış shader'ı):** zihinsel düzlem. Tüplerin İÇİNDE ilerleyen
  enerji bantları; LLM/ajan aktivitesi (mood `activity`) hem bant hızını/parlaklığını hem
  **hızlı elektriksel sinaps atımlarını** sürer. İç ağın rengi mood'u giyer (aşağıda).
- **Derin küp + bağlar = VIOLET (akış shader'ı):** çekirdek kafesi; akış bantları MERKEZE akar
  (kenarlar merkeze sıralı olduğundan shader yönü doğal olarak içeri).
- **Spoke'lar = VIOLET→KIRMIZI (akış shader'ı):** son kademe; çekirdek enerjisiyle kızarır ve hızlanır.
- **Çekirdek = KIRMIZI kalp:** içinde gerçek bir point-light taşır — patlamada bakır iskeleti
  İÇERİDEN aydınlatır. Nabız hızı aktiviteyle artar.

**Sinematik katman (2026-07-08):** GERÇEK bloom — `UnrealBloomPass` (EffectComposer → RenderPass →
Bloom → OutputPass; three'nin kendi addon'ları, **yeni paket yok**). Sahne kendi atmosferini çizer:
çok koyu zemin (#05060a) + **yıldız alanı** (uzak kabukta göz kırpan noktalar) + **nebula lekeleri**
(çok soluk cyan/magenta/bakır). **Jiroskop yörünge halkaları** ×3 — katman başına bir: bakır=donanım,
cyan=zihin, violet=çekirdek; kendi katmanının sürücüsüyle parlar/hızlanır. **Veri zerreleri**
(~220 mot) üç ailede yapıyı yörüngeler; ailesinin sürücüsüyle parlar. **Sinematik kamera:**
aktivite arttıkça yavaşça yaklaşır, sürekli hafif süzülür; imleç parallax'ı korunur.

**Durum → görsel eşlemesi (mood, öncelik sırası `scene/mood.ts`):**
- **boşta (idle):** yavaş nefes + tek tük sinaps kıvılcımı (yapı asla ölü değil); cyan.
- **düşünüyor (thinking):** iç ağ atımları sıklaşır, parlaklık artar.
- **araç çalıştırıyor (executing):** magenta ton + yoğun atım trafiği + hızlı dönüş.
- **izin bekliyor (awaiting):** iç ağ amber'e döner — kullanıcı eylemi bekleniyor.
- **hata (failed):** kırmızı flaş + converge salvosu (kritik an); sonra toparlanma.
- **çevrimdışı:** tüm düzlemler söner (presence ~%22), atım doğmaz.

**CONVERGE salvosu (görev sonuçlanması / kritik an) — ÜÇ KADEMELİ ŞELALE:**
`agent.run.completed`, `chat.completed` ya da hata anında tüm köprüler İÇERİ → (gecikmeli)
tüm bağlar DERİNE → (daha gecikmeli) tüm spoke'lar MERKEZE ateşler; atımlar çekirdeğe varınca
(`coreHits`) çekirdek **patlar**: emissive + iç ışık fırlar, glow sprite büyür (bloom bunu
çiçeğe çevirir) ve bir **şok-dalgası halkası** dışa genişleyip söner. Kaynak sinyal: store
`lastCompletedAt` / `lastErrorAt` (protokol değişikliği yok — mevcut olaylar).

**Atım sistemi (`ui/scene/tesseract/pulses.ts` — SAF, testli, rng enjekte):** oran-birikimli
doğum (atım/sn), kenar üzerinde `t∈[0,1]` ilerleme, swap-pop emeklilik, `MAX_PULSES=240`
(converge taşması için tavan 320). Havuzlar: synapse = iç+bağ+derin (LLM/ajan), energy =
dış+köprü (GPU). Render: tek `THREE.Points` + CPU BufferAttribute (proje test disiplini;
atım başına 3 noktalı **komet kuyruğu**). Düğümlerde additive **hale katmanı** (tek Points,
25 nokta) düzlem enerjisiyle parlar; gerçek bloom hepsini çiçeklendirir.

**Yumuşatma ilkesi (küreden miras):** ham GPU/aktivite verisi sert sıçrar; görsel sürücüler
exp-lerp ile biner (RISE_TAU 0.55) ve yavaş söner (FALL_TAU 1.4, afterglow). Kare-hızından bağımsız.
- **Ortak canlılık:** iç atım oranı = LLM aktivitesi; bakır atım oranı = GPU yükü — bulut LLM'de
  GPU yükselmese de iç ağ yaşar (kaynak: `mood.ts activity` + `hardware-vitals.ts load`).
- **VRAM doluluğu %** → İÇ KÜBÜN şişmesi (innerSwell; kalıcı, yumuşak).
- **Nefes** → tüm grup ölçeğinde yumuşak sinüs (mood frekans/genliği).
- **Derinlik parallax'ı:** imleç konumuyla ±~0.1 rad eğim — süs değil, 3B yapının okunabilirliği
  (iç/dış küp ayrımı) için derinlik ipucu.
- **GPU HUD (sağ-üst):** `GPU %util · kullanılan/toplam GB · °C`; çubuk ve sayı ısıyla renklenir.
- GPU yoksa (nvidia-smi başarısız/AMD/Apple) bakır düzlem sakinleşir; iç ağ mood ile yaşamaya
  devam eder. Saf mantık: `hardware-vitals.ts` + `tesseract/geometry.ts` + `tesseract/pulses.ts`.

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

1. **Yaşayan Arayüz merkezi** ✅ — küre olarak doğdu (dilim 3–7), 2026-07-08'de yaşayan
   TESSERACT'a evrildi (§2). `@react-three/fiber`.
2. **HUD kabuğu** — köşe braketleri, teknik etiketler, display tipografi (mevcut panelleri sarar).
3. **Tesseract'ı canlı mimari haritasına bağlama** — düğümler = sistem bileşenleri.
4. **Bağlam Haritası** — SQLite verisinden zamansal graf (ayrı, büyük dilim; REST/protokol
   eklemesi gerekebilir → önce PROTOKOL.md).

## 5. Değişmezler

- Marka paleti tutarlı (yukarıdaki değerler); rastgele renk eklenmez.
- Her animasyonun anlamı var; performansı boğan süs yok (60fps hedef, parçacık sayısı ayarlı).
- Koyu tema esas; metin okunabilirliği (kontrast) korunur.
- Arayüz daemon'la YALNIZ `shared` protokolüyle konuşur (yeni veri gerekiyorsa önce PROTOKOL.md).
