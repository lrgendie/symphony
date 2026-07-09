# 🔍 Fable İnceleme Raporu 2 — Merge + Dilim 2.2/2.3 Oturumlarının Mimari Denetimi

**Tarih:** 2026-07-09 · **İnceleyen:** Fable 5 (salt-okunur denetim; koda müdahale edilmedi)
**Kapsam:** İlk rapordan (`fabelincelemeraporu.md`, 2026-07-08) bu yana main'e inen kod işleri:

| Commit | İçerik |
|---|---|
| `a0c410f` | Merge `worktree-oturum-surekliligi` → main (§4.1 reçetesiyle) |
| `b986429` | Dilim 2.2 — çok-tur konuşmalı koşu (`awaiting_user` + `agent.say` + `conversational`) |
| `531aec0` | Rapor §5 paketi — delta batch + runStreams sınırı + cancelled zombi + `finishReason:"error"` |
| `c8fffa6` | Dilim 2.3a — birleşik giriş (PersonaPicker + salt-okur asistan) |
| `2cb36db` | Dilim 2.3b — konuşmalı agent kalıcılığı + resume (sessions/messages) |
| `adfe8e4` | Dilim 2.3c — TUI agent-konuşması resume (AgentFlow) |

**Denetim odağı (istek üzerine):** transcript düzleştirme · chat.start ile agent'ın aynı
`sessions` tablosunu paylaşması · `awaiting_user` + MCP yaşam döngüsü · `finishReason:"error"`.

**Doğrulama (bu denetimde bizzat çalıştırıldı):**
`pnpm build` ✓ · `pnpm test` **38 dosya / 240 test, tümü geçti** ✓ · `pnpm lint` ✓

---

## 1. Yönetici özeti (TLDR)

İlk raporun bütün icra maddeleri (merge, §4.2 MCP kararı, §5 paketi) doğru sırayla ve doğru
kapanmış; **dört odak noktasının dördü de mimari olarak sağlam.** Park mekanizması runLoop'un
içinde kaldığı için MCP/bağlam sorusu yapısal çözülmüş; `finishReason:"error"` düzeltmesi
empirik doğrulamasıyla örnek nitelikte; kalıcılık tek kapıdan (`saveConversation`) akıyor.
Bulunan sorunlar çekirdekte değil, **kenarlarda**: en önemlisi TUI'de resume edilmiş bir
konuşmada "Enter → yeni görev"in sessizce ESKİ oturuma devam etmesi (§3.1); ikincisi
`agent.say` ile verilen kullanıcı turunun ancak bir sonraki asistan turu bitince kalıcılaşması
(§3.2). İkisi de küçük düzeltmeler. #3 (hafıza/arşiv) başlamadan önce §3.1–3.2 kapatılmalı.

---

## 2. İyi yapılanlar (korunmalı)

1. **`awaiting_user` parkı runLoop'un İÇİNDE** (`engine.ts` — `waitForUser` promise-gate +
   `continue`): ilk raporun "2.2'nin en kolay gözden kaçacak hatası" dediği MCP-kopması
   yapısal olarak imkânsız — `finally` yalnız koşu gerçekten sonlanınca çalışır, `messages`
   ve MCP bağlantıları turlar arasında canlı. İptal parkta da işliyor (abort → `waitForUser`
   reject → cancelled → `finally` MCP'yi kapatır). Yarış da yok: `transition(awaiting_user)`
   ile kapı kurulumu aynı senkron dilimde, WS mesajı araya giremez.
2. **MCP yaşam döngüsü kararı PROTOKOL §5'e YAZILMIŞ** ("turlar arasında açık kalır; yalnız
   koşu sonlanınca kapanır"). İlk raporun §3.2 dersi (belge uygulamanın önünde, işaretsiz)
   alınmış: bu kez belge ile kod baştan senkron; ⏳ işaretleri kaldırılmış, `agent.say` hata
   kodları (`AGENT_NOT_AWAITING_USER`/`AGENT_UNKNOWN_RUN`) tabloda.
3. **`finishReason:"error"` düzeltmesi örnek bir çalışma.** Kaynak okumasına güvenmeyip izole
   script'le empirik doğrulama; düzeltme mevcut failed yoluna yönlendiriyor (yeni yol açmıyor);
   flush sırası doğru (delta'lar → terminal olay, hem normal yolda hem catch'te); test yalnız
   `failed`'ı değil "hata öncesi akan metin kaybolmaz"ı da mühürlüyor (`engine.test.ts:555`).
   `errorStream` mock'u `LanguageModelV3StreamPart`'a birebir (`finish` parçası yok — gerçek kesinti).
4. **Kalıcılık tek kapıdan:** `store.saveConversation` REPLACE'i hem chat (`saveChatTurn`
   delege) hem konuşmalı agent kullanıyor — iki yol tek modelde birleşti, çiftleme yok,
   değişmeyen satırların `at`'i korunuyor. `persistConversation` DB hatasında koşuyu
   ÖLDÜRMÜYOR (loglayıp sürüyor) — canlı konuşma > kalıcılık önceliği doğru.
5. **Transcript düzleştirme doğru mimari karar.** `messages` tablosunun CHECK'i zaten yalnız
   system/user/assistant taşır — araç turlarını dışarıda bırakmak şemayı bozmadan tek tutarlı
   yol. Model bağlamı (zengin: `response.messages`, araçlar dahil) ile kalıcı transcript
   (temiz: yalnız metin turları) ayrımı bilinçli ve PROTOKOL §3'te belgeli. UI ile de hizalı:
   TUI/masaüstü araçlı turun ara metnini `agent.tool.started`'da zaten siliyor — kullanıcının
   kalıcı gördüğü ile DB'ye yazılan aynı.
6. **Daemon restart hikâyesi kalıcılıkla güzelleşti:** `markInterruptedAgentRuns` park etmiş
   koşuyu `failed(AGENT_DAEMON_RESTART)` yapar ama OTURUM kalıcı → kullanıcı resume ile
   kaldığı yerden sürer. Koşu kaybı artık konuşma kaybı değil.
7. **Test disiplini:** 240/240; kabul senaryoları anlamlı (2-tur aynı-runId + ikinci prompt'ta
   user mesajı doğrulanıyor · araç turu geçmişe girmez · resume tohumlanır ve aynı oturuma
   yazılır · one-shot yazmaz · cancelAll parkı kapatır · say korumaları · stream-hata).
   `agent.start.ok {runId, sessionId}` additive, PROTOCOL_VERSION korunmuş (Kural 1 sırası izlenmiş).

---

## 3. HATALI olanlar (düzeltilmeli — öncelik sırasıyla)

> **✅ §3.1-§3.4 DÜZELTİLDİ (2026-07-09, Sonnet — devir talimatıyla, mekanik uygulama).**
> Ayrıntı: `memo/DURUM.md` "Rapor2 §3 düzeltme paketi" bölümü. 240→244 test, build/test/lint temiz.

### 3.1 ⚠️ TUI resume + "Enter → yeni görev" = sessizce ESKİ oturuma devam

`agent-run.tsx`: koşu bitince (Esc→cancelled / failed) Enter `resetForNewTask` ile ekranı
sıfırlar (`exchange: []`) ama **`props.initialSessionId` prop olarak sabit** — yeni görev
girilince useEffect yeni `agent.start`'a onu YİNE geçer (`agent-run.tsx:128`). Sonuç: kullanıcı
"temiz başlangıç" sanır, ekran boştur, ama model daemon'da tohumlanan eski geçmişi görür ve
REPLACE aynı oturumun üstüne yazar. Ekran ile daemon bağlamı ayrışır; kullanıcı görmediği bir
geçmişle konuşur. (Yalnız resume akışında; taze AgentRun'da sessionId üretilir, temiz.)

- **Düzeltme (küçük):** sessionId'yi state'e al (`useState(props.initialSessionId)`),
  `resetForNewTask` içinde `undefined`'a düşür — "yeni görev" gerçekten yeni oturum olur.
  Alternatif: reset'te `seedExchange`'i geri tohumla ("aynı konuşma sürüyor" de) — ama Esc'nin
  koşuyu bitirme anlamıyla çelişir; ilk seçenek doğru. +1 test: resume→bitir→Enter→yeni görev
  → `agent.start` sessionId'SİZ.

### 3.2 ⚠️ `agent.say` kullanıcı turu, sonraki asistan turu bitene dek kalıcılaşmıyor

`persistConversation` yalnız araçsız tur sonunda çağrılıyor (`engine.ts:399`). Kullanıcı
`say` ile mesajını verdikten sonra model turu ORTASINDA daemon ölür ya da koşu failed olursa
o mesaj DB'ye hiç yazılmamış olur → resume'da kullanıcının son mesajı kayıp. Chat yolunda bu
pencere zararsız (geçmişin sahibi istemci, sonraki turda tam listeyi yeniden gönderir); agent
yolunda **tek kaynak DB** olduğundan kayıp kalıcı. Aynı ailede: ilk tur araçlıyken koşu ölürse
(örn. maxSteps) oturum hiç doğmaz — görev metni de kaybolur.

- **Düzeltme (ucuz):** `say()` teslimatında (ve resume tohumu + task yazıldığı anda bir kez)
  de `persistConversation` çağır — REPLACE idempotent, maliyet önemsiz. +1 test: say sonrası
  (asistan turu bitmeden) `sessionDetail` son user mesajını içerir.

### 3.3 `queued → failed` geçersiz geçiş: MCP bağlantı hatasında tutarsız olay dizisi

`connectMcpServers` runLoop'un başında, ilk `transition(thinking)`'den ÖNCE (`engine.ts:314`).
Bağlantı hatasında catch → `finish(failed)` → `transition(queued→failed)`; ama
`VALID_TRANSITIONS.queued = ["thinking","cancelled"]` → geçiş REDDEDİLİR: "geçersiz agent durum
geçişi engellendi" ERROR log'u düşer, `agent.run.state` olayı HİÇ yayınlanmaz (istemci koşuyu
queued'da görürken `agent.run.failed` gelir), DB'ye failed ise `finishAgentRun` üzerinden yine
yazılır. Testler geçiyor çünkü `agent.run.failed`'ı bekliyorlar. **Bu 2.2'nin regresyonu değil**
(aynı yapı `f186b5d`'de de var — eski pürüz) ama durum makinesi bu oturumlarda elden geçmişken
görülmeliydi.

- **Düzeltme:** ya `queued→failed`'ı VALID_TRANSITIONS + PROTOKOL §5 diyagramına ekle (Kural 1
  sırası: önce PROTOKOL), ya da MCP bağlantısını ilk `transition(thinking)`'in ARKASINA taşı.
  İkincisi daha küçük ve anlamca da doğru (bağlanma = hazırlık düşünmesi). +1 test: MCP hatalı
  koşuda `agent.run.state:"failed"` yayını da doğrulanır.

### 3.4 `requests.session_id` artık iki farklı anlam taşıyor

`recordTurnUsage` requests tablosuna `sessionId: run.runId` yazıyor (`engine.ts:838`) — chat
yolu ise gerçek oturum kimliğini yazar. 2.3b'den sonra motorun elinde gerçek `run.sessionId`
var; sütun çift anlamlı kaldı (chat: oturum, agent: koşu). Oturum-bazlı maliyet raporu/router
v2 bu veriyi birleştiremez.

- **Karar gerekli:** koşu granülaritesi kasıtlıysa sütun yorumunu belgele; değilse
  `run.sessionId` yaz (tek satır) — ama o zaman koşu-bazlı analiz `agent_runs`'tan yapılır.
  Öneri: `run.sessionId` yaz; runId zaten `agent_runs`/`agent_steps`'te izlenebilir.

---

## 4. İYİLEŞTİRİLMELİ (orta/düşük öncelik — #3'ten önce ya da paralel küçük dilimler)

1. **Zombi park koşuları — istemci kaybolursa:** TUI artık HER koşuyu `conversational`
   başlatıyor; Esc yerine terminal penceresi kapatılırsa `agent.cancel` gitmez → koşu
   `awaiting_user`'da sonsuza dek parkta, MCP süreçleri canlı. İlk rapor §4.2.2 v1'de
   `cancelAll` ile yetinmişti; "hep-conversational" kararıyla olasılık arttı. **2.3b bunu
   çözülebilir kıldı:** oturum kalıcı olduğundan boşta koşuyu iptal etmek artık veri
   kaybettirmez. Öneri: `awaiting_user`'da makul bir boşta-kalma sigortası (örn. 30 dk →
   cancel; kullanıcı resume ile sürdürür) ya da bağlantı-sahibi istemci kopunca iptal.
2. **`conversational` olmayan koşuya `sessionId`:** şema izin veriyor, motor geçmişi TOHUMLAR
   (`resumeFrom` conversational'a bakmıyor, `engine.ts:330`) ama sonucu YAZMAZ — sessiz
   yarı-davranış. Şemada `.refine` ile reddet ya da en azından logla (şema yorumu "yalnız
   conversational ile anlamlı" diyor; zayıf istemci yorumu okumaz).
3. **Aynı oturuma eşzamanlı iki yazar:** chat.start ile aktif bir konuşmalı koşu (ya da iki
   koşu) aynı `sessionId`'yi resume ederse REPLACE yarışır, son yazan kazanır — motor aktif
   koşular arasında sessionId çakışmasını denetlemiyor. Tek kullanıcıda olasılık düşük
   (TUI+masaüstü ikilisiyle mümkün); v2: start'ta aktif koşularda aynı sessionId varsa reddet.
4. **`sessions` tablosunda persona kimliği yok:** son oturum chat'ten mi, coder'dan mı
   bilinmiyor; ResumePicker kaynağı gösteremiyor ve salt-okur asistan, coder'ın "dosya
   yazdım" bağlamını devralabiliyor (DURUM bunu esneklik sayıyor — kabul, ama kullanıcıya
   kaynak gösterilmeli). v2: sessions'a `origin` sütunu (göç v5) + ResumePicker etiketi.
5. **TUI kozmetik:** `awaiting_user`'da Esc ile iptal edilince son `streaming` metni
   `exchange`'e taşınmadan kaybolur (outcome render'ı onu gizler) — iptal edilen turun cevabı
   ekrandan silinir (DB'de durur). Tek satır: iptal outcome'unda streaming'i exchange'e taşı.
6. **`finishReason:"error"` turunda kısmi usage kaybı:** throw, `recordTurnUsage`'dan önce —
   SDK'nın o tur için döndürdüğü (kısmi) token sayımı requests'e düşmez. Küçük; istenirse
   throw'dan önce usage kaydedilir.

---

## 5. CLAUDE.md kural uygunluk matrisi

| Kural | Durum | Not |
|---|---|---|
| 1. Protokol kutsal (PROTOKOL→shared→kullan) | ✓ | Sıra izlenmiş; belge-uygulama uyumu bu kez baştan (⏳ işaretleri kalkmış, MCP kararı §5'te). §3.3'teki diyagram düzeltmesi bekliyor |
| 2. ADR'siz mimari değişmez | ✓ | ADR-012 planlandığı gibi uygulanmış; 2.3a/b bölünme notu ADR'ye düşülmüş |
| 3. API anahtarı dosyaya yazılmaz | ✓ | Dokunulmamış; transcript'te anahtar yok (yalnız konuşma metni) |
| 4. Temperature varsayılan 0 | ✓ | `forwardsTemperature` kuralı akış/park göçünde korunmuş |
| 5. Test geçmeden iş bitmez | ✓ | 240/240 bu denetimde yeniden koşuldu (build+lint dahil) |
| 6. Agent izinsiz iş yapamaz | ✓ | İzin kapısı tek yerde; asistan personası yalnız `safe` araçlar; park izin akışını değiştirmiyor |
| 7. Dikey dilim | ✓ | 2.2 → §5 paketi → 2.3a → 2.3b → 2.3c: her adım main'de, çalışır ve testli bırakılmış — ilk raporun süreç borcu ödenmiş |

---

## 6. Önerilen icra sırası (özet)

1. **§3.1** TUI resume/yeni-görev ayrışması — küçük, kullanıcıya görünür, 2.3c'nin tek pürüzü.
2. **§3.2** `say` teslimatında persist — küçük, veri kaybı penceresini kapatır.
3. **§3.3** `queued→failed` (PROTOKOL §5 + agent-state + test) — protokol dokunuşlu küçük iş.
4. **§3.4** `requests.session_id` kararı — tek satır + belge notu.
5. §4.1 boşta-park sigortası — ayrı küçük dilim; #3 (hafıza) sırasında daemon'da uzun ömürlü
   koşular çoğalacaksa önce bu.
6. Sonra **ROADMAP önceliği #3 (uzun-dönem hafıza/arşiv)** — bu denetimin kapsamı dışında,
   başlanmadı (istek gereği).
