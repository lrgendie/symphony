# Mimari Tarama Raporu — 2026-07-13 (Sonnet) · v0.2.0 yayım-öncesi

> Kapsam: monorepo'nun tamamı — özellikle 2026-07-11 taramasından SONRA eklenen ~2.960 satır
> (Faz "H" H1-H5: kürasyon temeli, graf v2, masaüstü UI, TUI/CLI `/harita`, yaşayan animasyon;
> + v0.2.0 sürüm/release düzeltmeleri) + önceki raporun açık bulgularının yeniden doğrulanması.
> Amaç: draft release'i "Publish" etmeden önce çökme riski, mantık hatası ve regresyon avı.
> Bu rapor `rapor/mimari-tarama-2026-07-11.md`'nin devamıdır; oradaki B1+B3 kapatılmıştı,
> B2/B4/B5/B6/N1 buradaki taramada YENİDEN doğrulandı (hepsi hâlâ açık).

## Yönetici özeti

**Sistem yayıma hazır; draft release'i BLOKLAYAN bulgu yok.** 700/700 test yeşil, build+lint
temiz, yasak desenler sıfır; release CI'ı 3 platformda gerçek installer üretti. Daemon'ın WS
mesaj işleyicisinin tamamı `.catch` ile sarılı (beklenmeyen hata → telemetri + hata cevabı,
çökme YOK) ve bekçi poll döngüsü (önceki B1) düzeltilmiş durumda — **bilinen çökme riski
kalmadı** (tek istisna: aşağıdaki Y1/B2, daemon'ı değil `patch apply` CLI akışını yarım bırakır).

**Ama iki şey yayım SONRASI ilk işler olmalı:** (Y3) `symphony --version` hâlâ "0.1.0" yazıyor
(commander'a hardcode — bugünkü sürüm artışı bunu ISKALADI); (Y2) `symphony harita ekle`,
H2'nin haftalık katlanması yüzünden GEÇMİŞ haftalardaki öğeleri bulamıyor — komutun ana
kullanım amacı (eski bir şeyi haritada kalıcılaştırmak) mevcut haliyle yalnız güncel hafta
için çalışıyor. İkisi de küçük, hedefli düzeltmeler.

## 1. Nesnel taban çizgisi

| Kontrol | Sonuç |
|---|---|
| `pnpm build && pnpm test && pnpm lint` | ✅ temiz — 72 dosya, **700/700 test**, exit 0 (bu oturumda birden çok kez) |
| Release CI (v0.2.0, run 29247068258) | ✅ test job yeşil; bundle 3/4 platform başarılı (win-x64, win-arm64, mac-arm64; mac-intel runner kıtlığından iptal) |
| `any` / `as any` | ✅ sıfır (tek eşleşme `AbortSignal.any` — meşru API, tip değil) |
| `TODO` / `FIXME` / `HACK` | ✅ sıfır |
| Boş `catch {}` | ✅ sıfır |
| Daemon WS işleyicisi çökme koruması | ✅ async IIFE'nin tamamı `.catch`li (`daemon.ts:1206`) — beklenmeyen hata telemetriye yazılır, istemciye `error` döner, daemon AYAKTA kalır |
| Bekçi poll döngüsü (önceki B1) | ✅ kapalı — proje-başına try/catch + parse guard'ları yerinde |
| SQL parametrikliği (yeni map CRUD dahil) | ✅ tüm `map_nodes`/`map_edges` sorguları prepare/bind |
| Kürasyon şema disiplini | ✅ 8 `map.*` isteği zod'lu; `.superRefine` (ref'siz pin'de title zorunlu) testli |

## 2. Bulgular (önem sırasıyla)

### Y1 — ORTA · [B2 devri] `patch apply`: merge çakışması hâlâ yarım-merge bırakıyor
**Yer:** `cli/src/commands/patch.ts:289`. **Durum: önceki rapordan AÇIK, yeniden doğrulandı.**
`git.raw(["merge", "--no-ff", ...])` try/catch DIŞINDA. Doktor dalı üretildikten sonra main
ilerlemişse merge çakışır → simple-git fırlatır → süreç ölür → repo MERGING durumunda kalır,
`geriAl()` hiç koşmaz, yama `proposed`'da asılı. Watchdog'un "bozuk durum bırakma" garantisi
tam bu noktada delik. **Öneri (değişmedi):** merge'ü try/catch'e al → `git merge --abort` +
`reset --hard` + `resolveState("failed")` + çakıştırma senaryolu test. *Yayımı bloklamaz
(installer'la ilgisiz) ama Faz 8 güven zincirinin en zayıf halkası — sıradaki teknik iş bu olmalı.*

### Y2 — ORTA · YENİ: `symphony harita ekle` geçmiş haftalardaki öğeleri BULAMIYOR (H2×H4 etkileşimi)
**Yer:** `cli/src/commands/harita.ts:47` + `cli/src/client/daemon-client.ts:371`.
**Sorun:** `haritaEkleCommand` id çözümlemesi için `getContextMap(500)` çağırıyor — ama H2'nin
haftalık katlanması yüzünden bu uç, İÇİNDE BULUNULAN hafta dışındaki (ve sabitlenmemiş)
session/run düğümlerini TEK TEK DÖNDÜRMÜYOR (hafta düğümüne katlanmış). Sonuç: 2 hafta önceki
bir koşuyu `symphony harita ekle <id>` ile sabitlemeye çalışmak "bulunamadı" hatası veriyor —
oysa komutun ana amacı tam da eski bir öğeyi kalıcılaştırmak. Daemon `?flat=1` parametresini
ZATEN destekliyor (H2 geri-dönüş anahtarı); yalnız CLI istemcisi geçirmiyor.
**Neden canlı testte yakalanmadı (dürüstlük):** H4 canlı doğrulaması güncel-hafta öğeleriyle
yapıldı; eski-hafta senaryosu denenmedi. **Öneri:** `getContextMap`'e `flat` parametresi ekle,
`haritaEkleCommand` `flat:1` ile çağırsın (`haritaListeCommand` DEĞİŞMESİN — kürasyon düğümleri
zaten hiç katlanmıyor) + eski-tarihli öğeyle bir test. ~15 dk'lık iş.

### Y3 — DÜŞÜK ama KULLANICIYA GÖRÜNÜR · YENİ: `symphony --version` hâlâ "0.1.0"
**Yer:** `cli/src/index.ts:35` — `.version("0.1.0")` HARDCODE.
**Sorun:** Bugünkü 0.1.0→0.2.0 sürüm artışı 8 dosyayı güncelledi ama commander'ın sürüm
dizesini ıskaladı (grep "0.1.0" yalnız `"version"` alanlarını aradı). npm'e 0.2.0 yayımlanırsa
`symphony --version` yanlış bilgi verir; `symphony update`in "yeni sürüm var mı" karşılaştırması
`versions.json`/npm view üzerinden gittiği için işlevsel kırılma YOK, yalnız görüntü.
**Öneri:** core'un `DAEMON_VERSION` deseniyle aynı — kendi `package.json`'ından oku
(`createRequire` + self-referans). Kalıcı çözüm; bir daha hiçbir sürüm artışı bunu ıskalamaz.

### Y4 — DÜŞÜK · YENİ: `map.pin` boş başlıklı düğüm üretebilir
**Yer:** `core/src/server/daemon.ts:929-931`.
**Sorun:** ref'li pin'de başlık türetmesi `store.sessionDetail(ref.id)?.session.title ?? ""` —
hiç kullanıcı mesajı olmayan bir session'da (`deriveTitle` boş döner) `title: ""` ile context
düğümü yazılır; şemanın `title: min(1)` koruması yalnız İSTEK payload'ını kapsıyor, türetilmiş
değeri değil. UI'da/`harita liste`de etiketiz düğüm görünür. Run tarafı etkilenmez (`task`
NOT NULL). **Öneri:** türetilen başlık boşsa `"(adsız)"` gibi bir yedek — tek satır.

### Y5 — DÜŞÜK · YENİ: kürasyon idempotency/öz-referans boşlukları
**Yer:** `core/src/server/daemon.ts` (map.pin/group.create/link.add) + `ui/ContextMap.tsx`.
Üç ayrı küçük boşluk, üçü de veri bozmaz ama tuhaf graf üretebilir:
1. **Mükerrer pin:** aynı session/run'a ikinci `map.pin` İKİNCİ bir context düğümü yaratır
   (ref bazında idempotency yok). UI "Haritaya sabitle" düğmesini zaten-sabitliyse gizliyor
   ama TUI `/harita` + CLI arka arkaya çağrılırsa çiftlenir.
2. **`map.group.create` üye tekrarı:** `members: [x, x]` iki member kenarı yazar (add'daki
   idempotent kontrol create döngüsünde yok).
3. **Öz-bağ:** `map.link.add {from:A, to:A}` ve bir grubun KENDİNİ üye alması engellenmiyor
   (UI hedef-seçme modunda kaynağa tıklamak mümkün).
**Öneri:** daemon'da üç küçük kontrol (ref'e mevcut context var mı → onu döndür; create'te
`new Set(members)`; `from===to` → no-op/ret). Düşük öncelik, davranışsal temizlik.

### Y6 — DÜŞÜK · YENİ: limit dışına düşen ref'li pin "yetim" context düğümü gösterir
**Yer:** `core/src/context-map/build.ts` (safeEdges süzgeci — bilinçli görünüm kuralı).
**Sorun:** Sabitlenen öğe, `limit=500` en-yeni kesitinin DIŞINA düşecek kadar eskiyse graf
girdisinde hiç yer almaz → `pin` kenarının bir ucu yok → safeEdges kenarı düşürür → context
düğümü haritada görünür ama neye işaret ettiği görünmez. Veri kaybı YOK (DB'de ref duruyor),
yalnız görsel kopukluk. **Öneri:** v2 adayı — pinlenmiş ref'ler limit kesitinden MUAF tutulabilir
(pinnedIds zaten elde). Şimdilik bilinen sınır olarak kayda geçsin.

### Önceki rapordan hâlâ açık (yeniden doğrulandı, değişiklik yok)
- **B4 (DÜŞÜK):** `pipeline.ts` `runForProject` busy-kontrol ile `busy=true` (satır 138→184)
  arasında await'ler var — eşzamanlı iki `doctor.run {proje}` çift boru hattı başlatabilir.
- **B5 (DÜŞÜK):** `store.ts:291,318` — telemetri `context` ve patch `files` okuma yolunda
  korumasız `JSON.parse` (bozuk satır o özelliği düşürür; veri hep bizim yazdığımız için düşük).
- **B6 (DÜŞÜK):** `ui/daemon/client.ts:300` — `fetchSessionDetail` hâlâ `encodeURIComponent`'siz
  (CLI karşılığı ve `fetchRoadmap` encode ediyor; bugün UUID olduğu için zararsız). H3
  ContextMap yeniden yazımında bu satıra dokunulduğu hâlde düzeltilmemiş — fırsat kaçmış.
- **N1 (KARAR BEKLİYOR):** Türkçe tanımlayıcılar (`RouterStatsEntry.kötü`, `bekciErrorCode`,
  `geriAl`...) — kural ya uygulanacak ya CLAUDE.md'de açıkça gevşetilecek. H4 bu listeye
  `haritaEkleCommand`/`haritaListeCommand`'ı ekledi (aynı desen sürüyor; karar verilmeden
  her oturum birikimi büyütüyor).

## 3. Çökme riski analizi (yayım-öncesi odak)

| Yüzey | Durum |
|---|---|
| Daemon WS mesaj döngüsü | ✅ tamamı `.catch`li (`daemon.ts:1206`); yeni 8 map.* handler'ı da bu şemsiyenin altında — `store` fırlatsa bile daemon ayakta kalır, istemci `error` alır |
| Bekçi poll (`setInterval`) | ✅ B1 düzeltmesi yerinde: registry okuma + proje-başına log G/Ç ayrı try/catch'lerde |
| Zamanlanmış rapor (`setInterval`) | ✅ `ensureWeeklyReportWritten` hataları loglanıyor (D5'ten beri değişmedi) |
| UI canlı simülasyon (H5) | ✅ sekme değişiminde/unmount'ta `simulation.stop()` (App.tsx `view === "map"` koşullu render + cleanup); `prefers-reduced-motion`da hiç başlamıyor |
| UI kürasyon istekleri | ✅ `awaitReply` asla reddedilmez (CurationResult döner), bağlantı kopunca bekleyenler DISCONNECTED ile çözülür, 8sn timeout — asılı promise yok |
| `patch apply` merge | ⚠ Y1/B2 — tek bilinen "yarım durumda bırakma" riski (daemon'ı değil CLI akışını/repoyu etkiler) |

## 4. Performans notu (bulgu değil, izleme)

H5'in sürekli drift'i sekme açıkken her d3 tick'inde (≈60/sn) tüm SVG'yi React'e yeniden
çizdiriyor. 500 düğüm tavanında bu, orta donanımda kabul edilebilir ama düşük cihazlarda
zorlayabilir. Hafifletme zaten var (`prefers-reduced-motion` statik yerleşime düşer; sekme
kapanınca simülasyon durur). Kullanıcıdan yavaşlık raporu gelirse ilk bakılacak yer:
`startLiveLayout`'un tick oranını seyreltmek (her N tick'te bir `onTick`).

## 5. Yayım (Publish) kararı önerisi

**Draft release yayımlanabilir** — Y1..Y6'nın hiçbiri installer'ların temel işlevini
(masaüstü uygulamasının kurulup H3/H5'li haritayı göstermesi) etkilemiyor; Y1 CLI patch akışı,
Y2/Y3 CLI komutları, Y4-Y6 kozmetik/uç durum. Ancak:
1. **npm publish (F2) ÖNCESİ Y3 düzeltilmeli** — yanlış `--version` raporlayan bir CLI'ı
   registry'ye çıkarmak kötü ilk izlenim (ve düzeltmesi 5 dk).
2. **Y2 de npm öncesi düzeltilmeye değer** — `harita ekle` REHBER §9'da "geçmiş bir sohbet/koşu
   için" diye belgelendi; belgelenen davranış şu an yalnız güncel hafta için doğru.
3. Yayım sonrası sırada: Y1/B2 (yarım oturum), sonra B4/B5/B6 fırsat düştükçe, N1 kararı.

## 6. Okumadıklarım (kapsam sınırı)

`desktop/src-tauri/lib.rs` (Rust — CI 3 platformda derledi, davranış incelenmedi),
`TesseractScene.tsx` görsel matematiği (H'de değişmedi), `openai/google` adapter gövdeleri
(değişmedi), `shared/events.ts` şema gövdelerinin tamamı (yalnız map.* eklemeleri okundu),
TUI bileşenlerinin H'de değişmeyen kısımları. Bunlarda bulgu olmadığını İDDİA ETMİYORUM;
değişmedikleri için önceki taramanın güvencesi geçerli sayıldı.

— Sonnet 5, 2026-07-13
