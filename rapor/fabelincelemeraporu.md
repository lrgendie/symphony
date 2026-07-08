# 🔍 Fable İnceleme Raporu — Opus/Sonnet Oturumlarının Mimari Denetimi

**Tarih:** 2026-07-08 · **İnceleyen:** Fable 5 (salt-okunur denetim; koda müdahale edilmedi)
**Kapsam:** `worktree-oturum-surekliligi` dalındaki 4 commit (Opus/Sonnet, 2026-07-08):

| Commit | İçerik |
|---|---|
| `2b13ea0` | Dilim 1 — TUI oturum sürekliliği ("önceki sohbete devam et") |
| `1b1c721` | ADR-012 + PROTOKOL — birleşik sohbet-agent modu (konuşmalı motor) |
| `f186b5d` | Dilim 2.1 — agent cevabı akışlı (`generateText`→`streamText` + `agent.delta`) |
| `2865bc6` | Dilim 2.1b — masaüstü panosunda `agent.delta` akışı |

**Doğrulama (bu denetimde bizzat çalıştırıldı):**
- Worktree: `pnpm build` ✓ · `pnpm test` **36 dosya / 211 test, tümü geçti** ✓ · `pnpm lint` ✓
- Main: 35 dosya / 211 test ✓ (tesseract dilim 8+8b dahil)

---

## 1. Yönetici özeti (TLDR)

İşin **kalitesi iyi** — ADR disiplini, protokol sırası (PROTOKOL→shared→kullanım), güvenlik
kapısının tek yerde kalması ve test göçü örnek seviyede. **Ama bir yapısal sorun her şeyin
önünde:** bu çalışma main'e hiç değmemiş bir dalda yaşıyor ve dal, **tesseract çalışmasından
(dilim 8+8b) ÖNCEKİ** bir noktadan ayrılmış. İki ağaç birbirinden habersiz iki gerçeklik
anlatıyor. Kod yazmadan önce yapılacak ilk iş **merge** (çakışma provası yapıldı: yalnız 3
dosya, reçetesi §4.1'de). İkinci sorun: PROTOKOL.md, henüz uygulanmamış özellikleri
(`agent.say`, `awaiting_user`, `conversational`) mevcutmuş gibi belgeliyor — işaretlenmeli.

---

## 2. İyi yapılanlar (korunmalı)

1. **ADR-012 örnek bir karar kaydı.** Üç seçenek (A: konuşmalı motor / B: chat'e araç ekle /
   C: yeni `converse.*`) gerekçeli tartılmış; B'nin reddi doğru sebebe dayanıyor (izin kapısı +
   jail'in çatallanması = Kural 6 ihlali); geri dönüş koşulu yazılmış. Seçenek A mimari olarak
   doğru karar: araç döngüsü/izin/jail/MCP/durum makinesi/telemetri TEK yerde kalıyor.
2. **Protokol sırasına uyulmuş** (Kural 1): önce PROTOKOL.md, sonra `shared/events.ts`'e
   `AgentDeltaPayloadSchema`, sonra kullanım. `PROTOCOL_VERSION=1` korunmuş (additive).
3. **Streaming göçü dikkatli yapılmış.** Denetimde özellikle bakılan noktalar sağlam çıktı:
   - `abortSignal: run.abort.signal` `streamText`'e geçiliyor → iptal, akışı da keser;
     `for await` fırlatır → catch → `finish(cancelled)`. ✓
   - Hata yolu: akış tüketimi try bloğunun içinde; sağlayıcı hatası → `finish(failed)`. ✓
   - Telemetri korunmuş: `usage`/`providerMetadata`/`response.headers` akış bittikten sonra
     await ediliyor (doğru sıra); rate-limit + cache token yayını aynen sürüyor. ✓
   - ADR-008 (temperature iletimi) ve tool-loop/izin/jail mantığına dokunulmamış. ✓
4. **Test göçü gerçek:** mock `doGenerate`→`doStream` çevrilmiş (`scriptToStream`,
   `LanguageModelV3StreamPart` şekilleriyle) ve güvenlik kabul testleri (deny koşuyu kırmaz,
   jail, izin beklerken iptal → dosya yazılmaz, maxSteps, tool-loop sigortası, MCP hataları)
   yeşil — bu denetimde yeniden koşuldu, 211/211 geçti.
5. **Dilim 1 (oturum sürekliliği) planına birebir sadık:** sıfır protokol/daemon değişikliği;
   REST + Bearer token + shared şema doğrulaması (`HistorySessions*Schema`); 404→null;
   REPLACE semantiğine yaslanma (çiftleme yok); system mesajlarının geçmişe alınmaması doğru
   (daemon `instructions`'ı kendisi ekliyor). Devam seçeneğinin yalnız model hâlâ mevcutken
   sunulması, v1 kapsam notuyla belgelenmiş.
6. **Dikey dilim disiplini** (Kural 7): 2.1 (akış) → 2.1b (masaüstü parite) → 2.2 (çok-tur) →
   2.3 (birleşik TUI) sıralaması doğru; her dilim çalışan bir şey bırakmış.

---

## 3. HATALI olanlar (düzeltilmeli — öncelik sırasıyla)

### 3.1 ⚠️ KRİTİK: Dal ıraksaması — iki ağaç birbirinden habersiz

- `worktree-oturum-surekliligi` dalının merge-base'i `23c25bf` (2026-07-07): yani dal,
  main'deki **otomatik yedek (`2da63ea`) ve tesseract dilim 8+8b (`236728e`) commit'lerini
  İÇERMİYOR**. Kanıt: worktree'de `wave-field.test.ts` hâlâ duruyor, `tesseract/` yok.
- Sonuçları:
  - **İki farklı DURUM.md** iki farklı hikâye anlatıyor. Worktree DURUM'u tesseract'tan
    habersiz; oradaki test anlatısı (203→209→210→211) eski tabana göre. Main ile worktree'nin
    ikisinin de 211 testte olması **tesadüf** — içerikler farklı (main: +tesseract testleri,
    −wave-field; worktree: +chat-flow/resume/delta testleri, wave-field duruyor).
  - Yanlış ağaçta açılan bir sonraki oturum **yanlış resimle** çalışır (oturum ekonomisi
    kuralının tam tersi).
  - UI `store.ts` iki dalda da değişti (main: `lastCompletedAt` converge sinyali; worktree:
    `runStreams` akışı) — birleştirilmeden ikisi bir arada çalışamaz.
- **Bu, işin kendisinin hatası değil, sürecin borcu** — ama kapatılmadan yeni dilim (2.2)
  açılmamalı. Reçete: §4.1.

### 3.2 ⚠️ PROTOKOL.md gelecek özellikleri "mevcut" gibi belgeliyor

PROTOKOL.md'ye `agent.say` isteği, `awaiting_user` durumu ve `agent.start.conversational`
alanı yazılmış; ancak **kodda hiçbiri yok** (denetimde grep ile doğrulandı: `shared/requests.ts`
ve `agent-state.ts` değişmemiş; engine bilmiyor). Kural 1'in sırası (önce PROTOKOL) doğru
izlenmiş ama belge, uygulama durumunu söylemiyor:

- Risk: PROTOKOL.md "tek doğruluk kaynağı"dır. Zayıf bir model ya da harici istemci bugün
  `agent.say` gönderirse daemon `UNKNOWN_TYPE` döner; `awaiting_user` bekleyen istemci
  asla göremez. Şema doğrulaması gereği daemon bu durumu YAYAMAZ da (agent-state enum'unda yok).
- **Düzeltme (küçük):** PROTOKOL.md'de bu üç öğenin yanına açık işaret:
  "**(planlandı — Dilim 2.2'de gelecek; henüz uygulanmadı)**". 2.2 bitince işaret kalkar.
  Alternatif: 2.2'yi hızla tamamlamak — ama işaret 5 dakikalık iş, önce o.

### 3.3 Worktree DURUM.md'sindeki test-sayısı anlatısı yanıltıcı

"203→209 (208 geçer; welcome.test ortamsal)" notu kendi tabanında doğruydu ama bugünkü
birleşik gerçekle uyuşmuyor; ayrıca bu denetimin koşusunda welcome.test dahil **hepsi geçti**
(36/36). Merge sonrası DURUM yeniden yazılırken test sayısı birleşik ağaçta **yeniden
ölçülmeli** (tahmin: ~219; kesin sayı `pnpm test` ile), eski anlatı günlüğe taşınmalı.

### 3.4 Küçük: `welcome.test` ortam kırılganlığı (onların da notu)

TTY'siz/dar-stdout ortamlarda ink logosunun satır sarması testi kırabiliyor. Bu koşuda geçti
ama "bazen kırılan test" güven aşındırır. Öneri: teste sabit sütun genişliği pinle
(ink-testing-library render seçeneği ya da `process.stdout.columns` stub) — tek satırlık iş.

---

## 4. YAPILMALI (net karar ve sıra)

### 4.1 ÖNCE: Merge — `worktree-oturum-surekliligi` → `main`

Çakışma provası bu denetimde yapıldı (`git merge-tree`, salt-okunur). Sonuç: **yalnız 3 dosya
çakışıyor**, gerisi otomatik birleşiyor (store.test.ts, index.css, BAGLAM.md, App.tsx dahil):

| Dosya | Çakışma | Çözüm reçetesi |
|---|---|---|
| `packages/ui/src/store.ts` | içerik | **İKİSİ DE KALIR:** main'in `lastCompletedAt`'i (tesseract converge) + worktree'nin `runStreams`'i. Birleşik handler'lar: `agent.run.completed` → removeRun + `clearStream` + `lastCompletedAt=Date.now()`; `chat.completed` → `lastCompletedAt` + log; `agent.tool.started` → worktree sürümü (runId okuyup `clearStream`); `agent.run.state cancelled` → `clearStream`; `applySnapshot` → `runStreams:{}` da sıfırlanır. |
| `memo/DURUM.md` | içerik | Tek kronolojik anlatı: Dilim 1 → 2 (ADR-012, 2.1, 2.1b) → 8 → 8b hepsi "BİTTİ"; sıradaki = 2.2. Test sayısı merge sonrası yeniden ölçülüp yazılır. |
| `memo/oturumlar/2026-07-08.md` | add/add | İki günlük tek dosyada art arda birleştirilir (Fable bölümü + Opus/Sonnet bölümü). |

Ek dikkat (çakışmasız ama semantik): `BAGLAM.md` otomatik birleşiyor — merge sonrası bir kez
okunup LivingScene/store satırlarının iki dalın da katkısını içerdiği doğrulanmalı. Silinen
`wave-field.*` merge'de silinmiş kalır (worktree dokunmadığı için — doğru davranış).
Merge sonrası kapı: `pnpm build && pnpm test && pnpm lint` + kısa duman testi.

Güzel bir yan etki: merge'le birlikte **agent akış turları da tesseract'ı besler** —
`agent.run.completed` converge salvosu zaten main'de bağlı; `agent.delta` ile canlı akış
metni panoda akarken koşu bitince çekirdek patlaması görülür. İki dalın işi birbirini tamamlıyor.

### 4.2 SONRA: Dilim 2.2 (çok-tur) — plan sağlam, iki ekleme öner

Worktree DURUM'undaki 2.2 planı uygulanabilir. Denetim iki madde ekletir:
1. **`awaiting_user` park süresi ve kaynaklar:** koşu haritada canlı kalacak (messages,
   MCP bağlantıları). MCP bağlantılarının turlar ARASINDA açık mı kalacağı, yoksa
   `awaiting_user`'a girerken kapatılıp `agent.say`'de yeniden mi bağlanılacağı KARARLAŞTIRILMALI
   (öneri: v1'de açık tut, `agent.cancel`/daemon kapanışında kapat — bugünkü `finally` yapısı
   buna göre yeniden düzenlenmeli; aksi hâlde runLoop'tan çıkınca `finally` bağlantıyı kapatır,
   ikinci tur kopuk MCP ile başlar. **Bu, 2.2'nin en kolay gözden kaçacak hatası.**)
2. **Boşta koşu sigortası:** `awaiting_user`'da sonsuz bekleyen koşular daemon'da birikir;
   v1'de en azından `cancelAll`'un bunları da kapsadığı test edilmeli (mevcut yapı kapsıyor
   görünüyor — testle mühürle).

### 4.3 Bekleyen görsel onaylar (kullanıcıda)

- Tesseract sinematik revizyon (`desktop:dev`) — dilim 8b onayı hâlâ açık.
- TUI "önceki sohbete devam et" canlı doğrulaması (raw-mode TTY ister) — Dilim 1 onayı açık.
- Masaüstü agent akışı (2.1b) görsel doğrulaması açık.

---

## 5. İYİLEŞTİRİLMELİ (orta öncelik — merge'den sonra, 2.2 ile birlikte ya da ayrı küçük dilim)

1. **`agent.delta` token başına WS broadcast:** her chunk ayrı zarf → hızlı modellerde saniyede
   onlarca mesaj × tüm istemciler. Bugün ölçekte sorun değil; 2.2'den önce ucuz bir iyileştirme:
   motor tarafında ~30-50ms'lik birleştirme (batch) tamponu. `chat.delta` da aynı desene sahip —
   ikisi birlikte ele alınmalı (tek yardımcı).
2. **`runStreams` sınırsız büyüme:** uzun bir asistan cevabı panoda tam metin birikir.
   Öneri: store'da son ~2000 karakteri tut (`slice(-2000)`) ya da CSS `line-clamp` — pano bir
   önizleme yüzeyi, döküm değil.
3. **"cancelled" koşu satırı panoda zombi kalıyor** (worktree işinin değil, ESKİ bir davranış):
   `agent.run.state: cancelled` yalnız state'i günceller; satır snapshot yenilenene dek listede
   kalır. `cancelled`'da da `removeRun` (ya da soluk "iptal edildi" rozetiyle 5 sn sonra kaldır).
4. **Akış hata semantiği testi eksik:** AI SDK'da sağlayıcı hatasının `textStream` tüketiminde mi
   yoksa `result.response` await'inde mi yüzeye çıktığı SDK sürümüne duyarlı. Mevcut testler
   araç/izin yollarını örtüyor; **"stream ortasında sağlayıcı hatası → agent.run.failed"**
   senaryosu için açık bir test eklenmeli (mock `doStream`'e error part enjekte).
5. **Dilim 1 v1 sınırları** (bilinçli, belgelenmiş — v2 adayları): her turda tam geçmiş yeniden
   gönderiliyor (token maliyeti konuşma uzadıkça büyür → 2.3'te bağlam penceresi/özet stratejisi);
   model artık yoksa devam seçeneği sessizce gizleniyor (v2: "farklı modelle devam et?");
   yalnız SON oturum (v2: oturum tarayıcısı).
6. **`listSessions` hatası sessiz yutuluyor** (`catch(() => [])`): v1 için makul ama pino'suz
   CLI tarafında en azından `--verbose`'da görünür olmalı (Kural: hatayı yutma — burada bilinçli
   gevşetilmiş, iz bırakılmalı).

---

## 6. CLAUDE.md kural uygunluk matrisi

| Kural | Durum | Not |
|---|---|---|
| 1. Protokol kutsal (PROTOKOL→shared→kullan) | ✓ / ⚠ | Sıra doğru; ama belge uygulamanın önünde, işaretsiz (§3.2) |
| 2. ADR'siz mimari değişmez | ✓ | ADR-012 örnek kalitede |
| 3. API anahtarı dosyaya yazılmaz | ✓ | REST Bearer token bellekte; diske yazım yok |
| 4. Temperature varsayılan 0 | ✓ | ADR-008 iletim kuralı akış göçünde korunmuş |
| 5. Test geçmeden iş bitmez | ✓ | 211/211 bu denetimde yeniden koşuldu; welcome kırılganlığı §3.4 |
| 6. Agent izinsiz iş yapamaz | ✓ | İzin kapısı/jail engine'de tek yerde kaldı; güvenlik testleri yeşil |
| 7. Dikey dilim | ✓ / ⚠ | Dilimleme iyi; ancak dal main'e hiç inmemiş — dikey dilim "çalışan bütüne" inince tamamlanır (§3.1) |

---

## 7. Önerilen icra sırası (özet)

1. **Merge** (§4.1 reçetesiyle) → build+test+lint → DURUM/BAGLAM/oturum günlüğü tek anlatı.
2. **PROTOKOL.md'ye "planlandı (2.2)" işaretleri** (agent.say / awaiting_user / conversational).
3. Kullanıcı görsel onayları (tesseract, TUI devam, masaüstü akış) — beşer dakikalık üç kontrol.
4. **Dilim 2.2** — §4.2'deki iki ek dikkat maddesiyle (MCP yaşam döngüsü! + cancelAll testi).
5. Küçük iyileştirme paketi (§5.1-5.4) — 2.2 ile birlikte ya da hemen sonra.
6. Dilim 2.3 (birleşik TUI) — ChatFlow (Dilim 1) ile harmanlama planı zaten yazılı.
