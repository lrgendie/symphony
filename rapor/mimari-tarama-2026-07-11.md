# Mimari Tarama Raporu — 2026-07-11 (Fable)

> Kapsam: monorepo'nun tamamı (shared/core/cli/ui), güvenlik çekirdeğinden arayüze.
> Yöntem: tam doğrulama zinciri + ~5.500 satır hedefli kaynak okuması + çapraz kesit
> taramaları (aşağıda). Bu rapor `rapor/fabelincelemeraporu.md` (2026-07-08) serisinin
> devamıdır; o raporun bulguları kapatılmıştı, buradakiler YENİDİR.

## Yönetici özeti

**Sistem sağlıklı ve mimari disiplin dikkate değer ölçüde korunmuş.** 617/617 test yeşil,
build+lint temiz; yasak desenlerin (aşağıda) tümü sıfır çıktı. Protokol tek kaynaktan
doğrulanıyor, güvenlik katmanları (jail → izin motoru → korumalı yollar → güven merdiveni)
birbirini tamamlıyor ve her katman bağımsız test edilmiş.

**İki orta önemli bulgu var, ikisi de düzeltilebilir:** (1) bekçi poll döngüsünde korumasız
dosya G/Ç — bozuk bir `bekci.json` ya da tam yanlış anda silinen/kilitlenen bir log dosyası
**daemon'ı düşürebilir**; (2) `patch apply` zincirinde `git merge` çakışması yakalanmıyor —
çakışan merge repoyu **yarım-merge durumunda** bırakır, watchdog'un geri alma yolu hiç koşmaz.
Ayrıca bir belge-test-kod uyuşmazlığı (readTrust/readBekciRegistry'nin "bozuk JSON'a dayanıklı"
iddiası) cache-şema bug'ıyla aynı sınıftan bir tuzak olarak kayda geçirildi.

## 1. Nesnel taban çizgisi

| Kontrol | Sonuç |
|---|---|
| `pnpm build && pnpm test && pnpm lint` | ✅ temiz — 68 dosya, **617/617 test**, exit 0 |
| `any` / `as any` / `any[]` | ✅ sıfır (kural: strict, any yasak) |
| `TODO` / `FIXME` / `HACK` | ✅ sıfır |
| Boş `catch {}` (sessiz yutma) | ✅ sıfır — her catch ya loglar ya bilinçli fallback döner |
| `console.*` (core içinde) | ✅ yalnız `main.ts` açılış afişi + `set-key.ts` (CLI giriş noktaları) |
| `child_process` | ✅ yalnız meşru: daemon/masaüstü `spawn`, nvidia-smi `execFile`, testlerde `execSync` |
| SQL enjeksiyonu | ✅ tüm sorgular parametrik (`better-sqlite3` prepare/bind) |
| API anahtarı diske yazımı | ✅ yok — keychain + salt-okur env yedeği (`secret-store.ts`) |
| Bağımlılık yönü | ✅ `shared → core → (cli, ui)`; `report/markdown` core'a bu kural İÇİN taşınmış |
| temperature varsayılanı | ✅ 0 (tanım şemasında default) + adapter `forwardsTemperature` kapısı |

## 2. Bulgular (önem sırasıyla)

### B1 — ORTA · Bekçi poll döngüsü daemon'ı düşürebilir
**Yer:** `core/src/server/daemon.ts` (`pollBekci`, ~335-387) + `core/src/bekci/registry.ts:22`.
**Sorun:** `pollBekci` bir `setInterval` içinde **try/catch'siz** senkron G/Ç yapıyor:
`readBekciRegistry` → `JSON.parse` (bozuk dosyada FIRLATIR), `existsSync` → `statSync` →
`openSync/readSync` (dosya bu pencerede silinirse/Windows'ta münhasır kilitliyse FIRLATIR).
setInterval callback'inde yakalanmayan istisna = `uncaughtException` = **daemon çöker**.
**Senaryo:** kullanıcı `~/.symphony/bekci.json`'ı elle düzenlerken dosya yarım kaydedilir →
en geç 10 sn içinde daemon ölür. Ya da izlenen log, rotate sırasında stat ile open arasında
kaybolur.
**Öneri:** `pollBekci` gövdesini proje başına try/catch'e al (bir projenin hatası ötekini ve
daemon'ı etkilemesin; hata `log.warn` + telemetriye); `readBekciRegistry`/`readTrust`'a
JSON.parse guard'ı ekle (bkz. B3 — belge zaten bunu vaat ediyor).

### B2 — ORTA · `patch apply`: merge çakışması yarım-merge bırakıyor
**Yer:** `cli/src/commands/patch.ts:289`.
**Sorun:** `git merge --no-ff <dal>` try/catch DIŞINDA. Doktor dalı üretildikten sonra main
ilerlemişse (bu repoda gerçekçi: doktor koşusu dakikalar sürüyor, kullanıcı bu arada commit
atabilir) merge ÇAKIŞIR → simple-git fırlatır → komut ölür. Repo **conflict/MERGING durumunda
kalır**, `geriAl()` hiç koşmaz, yama `proposed`'da asılı kalır; watchdog'un koruduğu "bozuk
durum bırakma" garantisi tam bu noktada deliniyor.
**Öneri:** merge'ü try/catch'e al → hata yolunda `git merge --abort` (+ emniyet için
`reset --hard baseSha`) + `resolveState("failed")` + net mesaj. Testi: dalla main'i bilinçli
çakıştıran senaryo (`patch.test.ts` desenine +1).

### B3 — DÜŞÜK/ORTA · Belge-test-kod uyuşmazlığı: "bozuk JSON'a dayanıklı" iddiası
**Yer:** `core/src/doctor/trust.ts:21`, `core/src/bekci/registry.ts:22`, testleri +
`memo/BAGLAM.md` ve DURUM kayıtları.
**Sorun:** Belgeler "bozuk/eksik JSON çökmeden boş listeye düşer" diyor. Kod yalnız
**yanlış-ŞEKİLLİ ama geçerli** JSON'a dayanıklı; sentaks düzeyinde bozuk JSON'da `JSON.parse`
fırlatıyor. Test de (`trust.test.ts:54`) yalnız yanlış-şekilli durumu sınıyor — **test, kodu
değil niyeti doğruluyor** (D2.5 cache-şema bug'ıyla aynı hata sınıfı; kod+test aynı varsayımı
paylaşınca bug görünmez kalır). `readBekciRegistry` daemon döngüsünde olduğu için bu B1'i besliyor.
**Öneri:** iki okuyucuya da `try { JSON.parse } catch { boş }` + gerçekten bozuk (`"{{"`)
girdiyle test. Not: `permissions.json`'daki KASITLI fırlatma (güvenlik sınırı, duymalısın)
DOĞRU ve korunmalı — bu bulgu onu kapsamıyor.

### B4 — DÜŞÜK · `runForProject` meşguliyet kilidinde TOCTOU
**Yer:** `core/src/doctor/pipeline.ts:137-190`.
**Sorun:** `busy` kontrolü ile `busy = true` arasında `await this.ops.isRepoRoot(...)` var —
iki eşzamanlı `doctor.run {proje}` isteği ikisi de kontrolü geçip ÇİFT boru hattı başlatabilir
(worktree/dal çakışması). `run()` bu hatayı yapmıyor (kontrol-set arası await'siz).
**Öneri:** `busy = true`'yu kontrolün hemen ardına al, doğrulama hatalarında `finally` yerine
açık geri-alma; ya da doğrulamaları busy set edildikten sonra yap.

### B5 — DÜŞÜK · DB okuma yolunda korumasız `JSON.parse`
**Yer:** `core/src/db/store.ts` — `toTelemetryEntry` (context), `toPatchEntry` (files).
**Sorun:** Bozuk bir satır (elle SQL, disk hatası) okuma yolunu fırlatmayla düşürür; doktor
teşhisi (`telemetryRowsForCode`) ve `patches.list` bu yoldan geçer. Veri hep bizim yazdığımız
için olasılık düşük; etkisi "o özellik çalışmaz" düzeyinde.
**Öneri:** düşük öncelik — satır başına guard + bozuk satırı atlayıp loglama.

### B6 — DÜŞÜK · `fetchSessionDetail` URL kodlaması tutarsız
**Yer:** `ui/src/daemon/client.ts:204` (karş. `fetchRoadmap:162` encode ediyor,
`cli/daemon-client.ts:342` de ediyor).
**Sorun:** `sessionId` `encodeURIComponent`'siz. Bugün UUID olduğu için zararsız; tutarsızlık
ileride kopyalanınca hataya dönüşebilir.
**Öneri:** tek satırlık düzeltme, H3'e iliştirilebilir.

## 3. Anayasa/kural uyumluluğu notları

- **N1 · Türkçe tanımlayıcılar (kural: "tanımlayıcılar İngilizce").** Faz 8 dalgasıyla kurala
  aykırı adlar birikti: `RouterStatsEntry.iyi/kötü` (stats.ts — `kötü` non-ASCII!),
  `bekciErrorCode`, `BekciRegistry.projeler`, `ad`, `geriAl` (patch.ts), `bekciEkleCommand`,
  `korumali`. Çalışıyor; ama kural ya uygulanmalı (kademeli yeniden adlandırma) ya da
  CLAUDE.md'de "alan-adı Türkçe terimleri (bekci, doktor) muaf" diye açıkça gevşetilmeli.
  İkisinden biri seçilmezse her yeni oturum kendi kararını verir ve tutarsızlık büyür.
- **N2 · `allow_for_run` araç-adı bazında** (engine.ts `trustedForRun: Set<string>`): "bu koşu
  boyunca izin ver", write_file'a verilince o koşuda TÜM dosyalara (jail içinde) yazımı serbest
  bırakır — hedef bazında değil. SPEC-AGENT §5 ile tutarlı görünüyor ve kayıt alanında
  belgelenmiş; yine de görünür olsun: bilinçli bir ödünleşim, bug değil.
- **N3 · REST token karşılaştırması sabit-zamanlı değil** (`daemon.ts:563`). 127.0.0.1 + 256-bit
  rastgele token tehdit modelinde pratik risk ihmal edilebilir; not düşüldü.
- **N4 · WS'te protokol sürüm kapısı VAR (hello eşitlik kontrolü), REST'te YOK** — eski istemci
  katı zod enum'ları yüzünden yeni REST alanlarında sessiz kırılabilir. ADR-019 Karar 7b bunu
  H2'de çözecek (bilinçli, takipte).
- **N5 · `symphony sync` silinen dosyayı yansıtmaz** (`git.add(existing)` yalnız var olanları
  ekler) — bir makinede silinen beyaz-liste dosyası uzaktan silinmez. v1 için kabul edilebilir;
  REHBER'e bir cümle not yeterli.
- **N6 · Bayat harita belgesi (bu taramada düzeltildi):** BAGLAM.md'nin store.ts satırı v6
  `patches` göçünü saymıyordu; ADR-019 de bu yüzden kürasyon göçünü yanlışlıkla "v6" yazmıştı.
  İkisi de bugün düzeltildi (doğru numara: **v7**). Ders: göç numarası HARİTADAN değil
  `MIGRATIONS` dizisinden okunur.

## 4. Güçlü yanlar (bilinçli korunmalı)

- **Güvenlik katmanlaşması gerçek:** jail (resolve+realpath+kök kapsama, symlink kaçışı kapalı)
  → izin motoru (deny>allow>risk; destructive'de always_allow yok) → PROTECTED_PATHS (liste
  kendini de koruyor) → güven merdiveni (sicil + korumalı-geçmiş reddi) → `patch apply`'da
  "EVET" zorunluluğu. Her katman ayrı test edilmiş.
- **"İkinci gerçek üretme" ilkesi** tutarlı uygulanmış: skorlar/rapor/sicil hep aynı
  fonksiyonlardan (computeRouterStats, categoryRecord, scoreOf) türüyor.
- **Watchdog'un bayat-dist dersi** (geri almadan sonra yeniden derleme) hem kodda hem testte.
- **Prompt cache** iki uçta (agent+sohbet) tek SAF yardımcıyla; sağlayıcı ad-alanlı, ölçümle
  doğrulanmış (~9×).
- **Zarf disiplini:** `parseMessage` type-başına payload şemasını zorluyor — daemon'daki
  cast'ler güvenli; `createMessage` çıkışı da şemadan geçiriyor (garbage-out önlemi).
- **Motor durum makinesi** geçersiz geçişi zorlamıyor, logluyor; delta batcher flush sırası
  (terminal olaydan önce) iki uçta da korunuyor.

## 5. Test değerlendirmesi

617 test, 68 dosya; her modülün eşlik eden testi var, kritik yollar (jail kaçışı, izin reddi,
watchdog geri alma + yeniden derleme, worktree temizliği, cache breakpoint temizliği) gerçek
senaryolarla sınanmış; "gerçek git/gerçek daemon" entegrasyon testleri mock zaferi riskini
büyük ölçüde kapatıyor. **Derinlik notu (dürüstlük):** test İÇERİKLERİNİ örnekleme yöntemiyle
inceledim (trust.test.ts tam, diğerlerinde isim+DURUM kayıtları); bu örneklemede bir gerçek
bulgu çıktı (B3 — test niyeti doğruluyor, kodu değil). Aynı sınıftan başka vaka aramak
istersen sonraki adım: "dayanıklılık" iddiası taşıyan tüm testlerin girdilerini gerçekten
bozuk girdiyle çeşitlendirmek.

## 6. Okumadıklarım (kapsam sınırı)

TUI bileşenlerinin içi (`tui/*.tsx` — ink-testing-library testleri yeşil), `TesseractScene.tsx`
(988 satır görsel matematik; SAF çekirdekleri `geometry/pulses/satellites` testli),
`desktop/src-tauri/lib.rs` (Rust), `openai.ts`/`google.ts` adapter gövdeleri (anthropic ile
aynı kalıp, temperature bayrakları BAGLAM'la tutarlı), `hardware.ts`, `roadmap/parse.ts`,
`shared/events.ts`in tüm şema gövdeleri. Bunlarda bulgu OLMADIĞINI iddia etmiyorum;
incelenmediler.

## 7. Önerilen sıra

1. **B1 + B3 birlikte** (aynı dosyalara dokunuyor; Sonnet, ~yarım oturum): pollBekci
   try/catch + iki okuyucuya parse guard'ı + gerçek-bozuk-JSON testleri.
2. **B2** (Sonnet): merge çakışma yolu + abort + test.
3. **N1 kararı** (kullanıcı + bir sonraki oturum): İngilizce'ye dönüş mü, kuralın gevşetilmesi mi.
4. B4/B5/B6 fırsat düştükçe (örn. H dilimlerinin dokunduğu dosyalarda birlikte).

— Fable 5, 2026-07-11
