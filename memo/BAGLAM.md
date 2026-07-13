# 🗺 BAGLAM.md — Oturum Başlangıç Haritası

> **Amaç: token tasarrufu.** Yeni oturumda mimariyi kod okuyarak YENİDEN KEŞFETME.
> `DURUM.md` (neredeyiz) + bu dosya (ne nerede) yeterli başlangıçtır; kod dosyalarını
> ancak o oturumda DOKUNACAĞIN kadar oku. Bu harita her yapısal değişiklikte
> oturum sonu rutininde güncellenir — güncel tutulmazsa değerini yitirir.

## Görev → ne okumalı (geniş tarama YOK)

| Yapacağın iş | Oku (yalnız bunlar) |
|---|---|
| Protokole mesaj/olay ekleme | `docs/PROTOKOL.md` + `shared/src/protocol/requests.ts` veya `events.ts` |
| Agent motoru işi (Faz 3+) | `docs/SPEC-AGENT.md` + `core/src/agent/` içindeki hedef dosya |
| Yeni sağlayıcı / fiyat | `core/src/providers/types.ts` + ilgili adapter + `pricing.ts` |
| Veri katmanı / yeni tablo | `core/src/db/store.ts` (göçler dosyanın başında) |
| CLI komutu ekleme | `cli/src/index.ts` + `cli/src/commands/` içinde benzer bir komut |
| TUI değişikliği | `cli/src/tui/app.tsx` + hedef bileşen |
| Arayüz GÖRSEL/tasarım işi (renk, animasyon, düzen) | `docs/TASARIM.md` (görsel anayasa) — ÖNCE oku |
| Dashboard (masaüstü) değişikliği | `ui/src/App.tsx` + `ui/src/store.ts` (WS→durum) + `ui/src/daemon/client.ts` |
| Tauri kabuk / token enjeksiyonu | `desktop/src-tauri/src/lib.rs` + `desktop/src-tauri/tauri.conf.json` |
| Daemon davranışı | `core/src/server/daemon.ts` (tek dosya, ~600 satır) |
| Mimari karar değişikliği | `docs/kararlar/KARARLAR.md` (önce ADR oku!) |
| Hafıza/profil işi (öncelik #3, M1-M3) | ADR-013 (KARARLAR.md) + `memo/DURUM.md` M-dilim talimatları |
| Faz 6 zeka işi (router v2/feedback/rapor/harita, Z1-Z5) | ADR-016 (KARARLAR.md, BAĞLAYICI) + `memo/DURUM.md` Z-dilim talimatları + `router/router.ts` |
| Faz 7 paketleme işi (yayın/installer/sync/update/rehber, F1-F7) | ADR-017 (KARARLAR.md, BAĞLAYICI) + `memo/DURUM.md` F-dilim talimatları |
| Faz 8 kendini geliştirme (doktor/yama/canlıya alma/güven/bekçi/agent-önerisi, D1-D7) | ADR-018 (KARARLAR.md, BAĞLAYICI) + `memo/DURUM.md` D-dilim talimatları + `agent/engine.ts`/`db/store.ts` |
| Bağlam Haritası v2 işi (kürasyon/katlanma, H1-H5) | ADR-019 (KARARLAR.md, BAĞLAYICI) + `memo/DURUM.md` H-dilim talimatları + `context-map/build.ts` + `ui/src/map/` |
| Model devri (Fable→Opus vb.) | `memo/DEVIR.md` — rol, disiplin, tuzak haritası |

## Paket grafiği

`shared` → `core` → (`cli`, `ui`, `desktop`) — tek yönlü; `shared` hiçbir şeye bağımlı değil.
`ui` = React+Vite dashboard (Faz 4 dilim 1: canlı akış). `ui` yalnız `shared`'a bağımlı
(tarayıcı-güvenli, core'a DEĞİL). `desktop` = Tauri 2 kabuğu; `ui/dist`'i sarar, `shared`'a
bile bağımlı değil (yalnız Rust + webview). `core`'a hiçbir arayüz doğrudan bağımlı değildir —
protokol WS/REST üzerinden konuşulur.

## Dosya haritası (tek satırlık sözleşmeler)

### packages/shared/src/protocol — protokolün TEK kaynağı (PROTOKOL.md ile birebir)
- `envelope.ts` — WS zarfı; `createMessage`/`parseMessage` (şemasız mesaj çıkamaz)
- `requests.ts` — istemci→daemon istekleri: `REQUEST_PAYLOAD_SCHEMAS` haritası
- `events.ts` — daemon→istemci cevap+olayları: `EVENT_PAYLOAD_SCHEMAS` haritası
- `agent-state.ts` — koşu durum makinesi; `canTransition` dışı geçiş ihlaldir
- `common.ts` — Usage/Snapshot/RiskClass/ModelInfo/PendingPermission ortak şemaları
- `rest.ts` — REST cevap şemaları (history uçları)
- `constants.ts` — `PROTOCOL_VERSION`, `DAEMON_HOST`, varsayılan port 7770

### packages/core/src — daemon (symphonyd)
- `server/daemon.ts` — Fastify+ws sunucu; TÜM istek işleyicileri buradaki switch'te. `@fastify/
  cors` (Canlı bulgu #4, `origin:true`) Bearer-auth hook'undan ÖNCE kayıtlı — ui webview'inin
  `fetch()`+Bearer REST istekleri CORS preflight'ına takılmasın diye; kayıt SIRASI bozulmamalı.
  `watchBekci`/`bekciPollMs` (ADR-018 Karar 7, Dilim D6, vars. true/10sn): `bekci.json`yi HER
  poll'da YENİDEN okur (restart gerekmez), ofset+debounce BELLEKTE (`bekciState` Map). İLK GÖRÜŞTE
  var olan log içeriği ATLANIR (geçmiş hatalar restart'ta yeniden yakalanmaz). `hardwareTimer`
  deseniyle AYNI: `unref()`, `close()`'da `clearInterval`.
  `scheduleReports` (ADR-018 Karar 5/6, Dilim D5, vars. true): açılışta + 24 saatte bir
  `ensureWeeklyReportWritten` (`decideWeeklyReport` SAF kararı + `buildWeeklyReport` — REST
  `/api/report` İLE AYNI fonksiyon, ikinci gerçek yok) + `runDailyDetection` (`doctor.diagnose()`
  aday bulursa `log.entry` warn yayınlar). `hardwareTimer` deseniyle AYNI: `unref()`, `close()`'da
  `clearInterval`. Testlerde `sampleHardware` gibi KAPATILIR (gerçek dosya yazımı testleri bozar)
- `server/bus.ts` — EventBus: olaylar bağlı TÜM istemcilere yayınlanır (ADR-001). `observe()`
  (ADR-018 D2): daemon-İÇİ dinleyici — doktor boru hattı bir koşunun bitişini böyle bekler;
  yalnız `broadcast` gözlemcilere düşer, `sendTo` (hedefli cevap) DÜŞMEZ
- `doctor/` — kendini geliştirme (Faz 8, ADR-018):
  - `detect.ts` — SAF, testli: `detectRecurring` (eşik + açık/uygulanmış yaması olan kodların
    elenmesi). LLM'e "hangi hata önemli" SORULMAZ
  - `sandbox.ts` — git worktree + dal + `pnpm install`; `isRepoRoot(path)` (Dilim D6, canlı
    prova bulgusu — SandboxOps'un parçası, testte sahtelenir): `repoPath` GERÇEK bir repo KÖKÜ
    değilse `git worktree add` sessizce bir ATA dizinin `.git`ine sızar; bekçi projeleri hem
    kayıt anında (CLI) hem koşu anında (pipeline, savunma katmanı) bununla doğrulanır.
    `runProjectVerification(worktreePath, testCommand)` — bekçi projesinin KENDİ doğrulama
    komutu (`shell:true`, sabit pnpm build/test/lint zincirinin YERİNE geçer); `formatDiagnosis` (SAF: telemetri →
    `DOKTOR-TESHIS.md`, agent'a giden TEK veri kanalı — DB/`~/.symphony` araç yüzeyine AÇILMAZ);
    `collectAndCommit` (agent commit ATMAZ → boru hattı DALDA commit'ler, D3'ün merge'ü şart
    kılıyor; teşhis dosyası yamaya SIZMAZ); `runVerification` (build+test+lint — BORU HATTI
    koşar, agent beyanına güvenilmez); `findRepoRoot` (node_modules içinden null → paketlenmiş
    kurulumda kendine-yama YOK); `SandboxOps`/`REAL_SANDBOX_OPS` (git+pnpm yüzeyi, testte sahtelenir)
  - `bekci/registry.ts` (core/src/bekci/) — SAF, testli (ADR-018 Karar 7): `readBekciRegistry`/
    `writeBekciRegistry` (`~/.symphony/bekci.json`, `trust.json`/D4 ile AYNI desen) +
    `findBekciProject`/`withBekciProject` (upsert) + `bekciErrorCode(ad)` → `BEKCI_<AD>`
    (D4/D5'in kategori ad-alanını PAYLAŞIR — güven merdiveni/rapor sicili bekçiyi de kapsar)
  - `bekci/scan.ts` — SAF, testli: `findMatches` (`/(error|exception|traceback|fatal)/i`,
    eşleşen satırın çevresini kesit olarak döner) + `shouldRecordBekciMatch` (5dk debounce SAF kararı)
  - `protected.ts` — SAF, testli (ADR-018 Karar 4): `PROTECTED_PATHS` (updater, patch.ts'in
    KENDİSİ, izin sistemi/jail/engine, secrets/, token.ts, VE bu listenin kendisi) +
    `touchesProtected`/`protectedMatches`. Bu yollara dokunan yama hiçbir güven kaydıyla
    otomatikleşemez — `--evet` bile geçmez, elle "EVET" yazılır
  - `trust.ts` — SAF, testli (ADR-018 Karar 5): `readTrust`/`writeTrust` (`~/.symphony/
    trust.json`, `{trusted: string[]}`) + `categoryRecord` (sicil `patches` tablosundan
    TÜRETİLİR, ayrı tablo YOK — applied=sağlıklı, reverted/failed=unhealthy, proposed/rejected
    sicile GİRMEZ) + `categoryTouchedProtected` (kategori geçmişte korumalı yola dokunduysa
    `patch trust` REDDEDER — Karar 4 blanket-trust ile atlanamaz)
  - `pipeline.ts` — orkestrasyon (`DoctorRunSpec` — Dilim D6'da `execute()` `repoPath`/
    `errorCode`/`verify`i bir SPEC olarak alır, `run()` [self-patch] ve `runForProject()` [bekçi]
    AYNI execute'u farklı spec'le çağırır — Karar 7: "kod tekrarı değil, parametre değişimi"): teşhis → sandbox → teşhis dosyası → agent koşusu (NORMAL
    `engine.start`, cwd=worktree → jail hapseder) → doğrulama → dalda commit → yama `proposed`.
    Tek koşu kilidi (`AGENT_DOCTOR_BUSY`). **`run()` beklemez** — WS 30sn zaman aşımına takılmasın
    diye yalnız doğrulama senkron, gerisi arka planda (`doctor.phase` olaylarıyla duyurulur)
- `server/token.ts` — daemon token üretimi/yazımı (dinleme başarılı olmadan yazılmaz)
- `server/delta-batcher.ts` — SAF, testli: `agent.delta`/`chat.delta` WS broadcast'ini anahtar
  (runId/sessionId) başına ~40ms'de toplar (rapor §5.1); `flush(key)` terminal olaydan (completed/
  failed/cancelled) ÖNCE çağrılmalı — `engine.ts`+`daemon.ts` bu sırayı korur
- `providers/types.ts` — `ProviderAdapter` arayüzü (streamChat + languageModel)
- `providers/{anthropic,openai,google,ollama}.ts` — 4 adapter; temperature iletimi
  adapter'a özgü (Claude 4.7+/GPT-5 KABUL ETMEZ → iletilmez; Gemini/Ollama iletilir)
- `providers/pricing.ts` — USD/1M token tablosu; bilinmeyen model = 0 (yerel). `computeCostUsd`
  CACHE-FARKINDA (D2.5): AI SDK'nın `inputTokens`'ı cache okuma/yazmayı TAM sayıyla içerir ama
  Anthropic okumayı %10, yazmayı %125 fiyatlar — ham çarpım kendi defterimizi 10x şişirirdi
- `agent/prompt-cache.ts` — SAF, testli (D2.5): `applyPromptCacheBreakpoints` — İKİ breakpoint
  (SABİT ilk mesaj = system+araçlar+görev; HAREKETLİ son mesaj = biriken konuşma). Eski
  breakpoint'ler her turda TEMİZLENİR (SDK sınırı 4). `providerOptions` ad-alanlı → diğer
  sağlayıcılar yok sayar. **Canlı ölçüm:** cache kapalıyken tur başına $0.0457; açıkken 2.
  turdan itibaren $0.0051 (~9x). Hem `engine.ts` (agent) hem `anthropic.ts` (sohbet) kullanır
- `providers/telemetry.ts` — SAF, testli: `parseRateLimits` (cevap header'larından rate-limit,
  ek-toleranslı) + `extractCacheTokens` (Anthropic providerMetadata). adapter+engine kullanır →
  `provider.limits` yayını + `usage.updated` cache alanları
- `router/router.ts` — kural tabanlı model önerisi (`router.suggest`). v2 (ADR-016 Karar 2, Dilim
  Z1): `RouterContext.stats?` verilirse `applyStatsMixing` v1 listesini kanıtla yeniden sıralar +
  gerekçelendirir (yeni aday üretmez); verilmezse v1 BİREBİR
- `router/stats.ts` — SAF, testli (ADR-016 Karar 1): `computeRouterStats(runRows, turnStatsRows,
  feedbackRows)` → `(provider,model,taskKind)` başına `RouterStats` Map; `scoreOf` (Laplace +
  açık geri bildirim 2× ağır), `hasEnoughEvidence` (`MIN_SAMPLES=3`). `router.ts` ile RUNTIME
  döngüsel import (yalnız fonksiyon gövdelerinde kullanılır — modül değerlendirmede değil, ESM'de
  güvenli, build ile doğrulandı). `classifyFeedbackRows` (Dilim Z3): `feedbackSince` satırını
  `FeedbackRow[]`e çevirir — `daemon.ts buildRouterStats` VE `report/build.ts` TEK kaynaktan
- `report/build.ts` — SAF, testli (ADR-016 Karar 5, Dilim Z3 + ADR-018 Karar 5/6 Dilim D5):
  `buildReport(input): ReportResponse` artık `selfDev` de üretir: durum sayaçları
  (proposed/applied/reverted/failed/rejected) + kategori sicili (`trust.ts`'in `categoryRecord`'ı
  YENİDEN kullanılır — ikinci gerçek üretilmez) + `recurring` (`doctor.diagnose()` adayları).
  Sicil rapor ARALIĞIYLA sınırlı DEĞİL, kümülatiftir (D4'teki `patch trust` ile aynı yaklaşım).
  `TASK_KIND_LABEL` export edilir (markdown.ts de kullanır — üçüncü kopya yok). `ReportInput.agents`
  (ADR-018 Karar 8, Dilim D7): `unpinnedAgentIds` + `agentModelUsageSince` satırları →
  `agentSuggestions` (`suggestAgentModelUpdates`) — Faz 6'nın son açık maddesini kapatır
- `report/agent-suggestions.ts` — SAF, testli (ADR-018 Karar 8, Dilim D7): `suggestAgentModelUpdates`
  yalnız PİNSİZ agent'lar için, agent'ın KENDİ geçmiş (provider,model) kullanımları arasında
  (`MIN_SAMPLES=3`, router v2 ile AYNI eşik + `scoreOf`) AÇIK bir kazanan varsa (skor farkı ≥0.2)
  pinleme önerir. Pinli agent'lar için ALTERNATİF ÖNERİLMEZ (kanıt yok — D2'nin dersi: doktor'un
  modeli veri değil genel bilgiyle sabitlendi, o türden kararı otomatikleştirmek riskli)
- `report/markdown.ts` — SAF, testli (Dilim D5): `isoWeekLabel`/`reportFilePath`/
  `formatReportMarkdown` **CLI'DEN TAŞINDI** (core, daemon içinden haftalık raporu kendiliğinden
  yazıyor; core→cli bağımlılığı YASAK olduğu için taşıma zorunluydu, kopya değil). YENİ
  `decideWeeklyReport(reportsDir, nowMs, exists)`: SAF karar — "bu hafta dosyası var mı →
  yaz/yazma"; `exists` enjekte edilir (testte sahte, daemon'da gerçek `existsSync`)
  ReportResponse` — `routerStats`'tan `successTable` + eşik-tabanlı `findings` (yalnız kanıtlı
  VE `score<0.5`). Sıfır adapter/fetch erişimi (lokallik kabul maddesi) — girdi daemon'da
  ÇOKTAN çekilmiş veridir
- `context-map/build.ts` — SAF, testli (ADR-016 Karar 6, Dilim Z4 + ADR-019 Karar 2/3/4, Dilim
  H2): `buildContextMap({runs, sessions, limit, mapNodes?, mapEdges?, now?, week?, flat?}):
  ContextMapResponse`. `isoWeekLabel` (`report/markdown.ts`) TEK hafta tanımı. Bir öğe `flat ||
  pinnedIds.has(id) || isoWeekLabel(at)===openWeek` (openWeek = `week` param ?? o anki hafta) ise
  AÇIK; değilse `week:<label>` düğümüne katlanır (meta: sessionCount/runCount/models + kronolojik
  `week` kenar zinciri). `pinnedIds` = context kürasyon düğümlerinin ref'lediği session/run
  id'leri — ASLA katlanmaz. AÇIK koşudan `model:<provider>/<model>` VE `agent:<agentId>`
  düğümüne kenar, AÇIK oturumdan yalnız model düğümüne (Karar 3 — model bağı artık KENAR, ADR-016
  Karar 6'nın reddi REVİZE edildi; model `meta.origin`: ollama→local, diğer→api). Kürasyon
  context/group düğümleri BİREBİR + ref'li context→ref arası `pin` kenarı + `mapEdges`
  (link/member) BİREBİR eklenir; bir ucu grafta olmayan kenar (görünüm güvenliği, veri bütünlüğü
  DEĞİL) son adımda süzülür. `store.ts`'e yeni okuma metodu GEREKMEDİ — `listSessions`/
  `recentAgentRuns`/`listMapNodes`/`listMapEdges` yeniden kullanılır.
- `context-map/curation.ts` — SAF, testli (ADR-019 Karar 1/2, Faz "H" Dilim H1): Bağlam Haritası
  kürasyonunun doğrulama çekirdeği — `isDerivedNodeId`/`isKnownGraphReference` (proje/model/
  agent/hafta önekleri + gerçek session/run) + `checkCurationTarget`/`checkGraphReference`/
  `checkGroupTarget`/`checkPinRef` (üç hata kodu: UNKNOWN/PROTECTED/REF_UNKNOWN).
  `lookup`/`exists` `daemon.ts`'ten enjekte edilir (`store.mapNodeById`/`sessionDetail`/
  `agentRunExists`in dar kesitleri). `store.ts`'e göç v7 (`map_nodes`/`map_edges`) + CRUD
  metodları eklendi (`insertMapNode`/`deleteMapNode`[kenar kaskadı]/`insertMapEdge`/
  `deleteMapEdgeBetween` vb.); `daemon.ts`'e 8 handler (`map.pin`/`map.node.rename`/
  `map.node.delete`/`map.group.create`/`map.member.add\|remove`/`map.link.add\|remove`).
  Bu 8 handler'ın WS-üzerinden uçtan-uca entegrasyon testi `daemon.test.ts`'te (2026-07-13,
  "kürasyon roundtrip" — pin/rename/link/group/member/detach/delete + üç koruma reddi + restart
  sonrası kalıcılık).
- `router/hardware.ts` — nvidia-smi: `detectVramGb` (router) + `sampleGpus`/`parseGpuCsv` (saf,
  testli) → GPU vitalleri (util/VRAM/ısı). Daemon 2sn poll → `hardware.updated` yayını
  (`DaemonOptions.sampleHardware`, testte kapalı)
- `db/store.ts` — SQLite (better-sqlite3, WAL); göçler `MIGRATIONS` dizisinde
  (v1 requests+telemetry, v2 sessions+messages, v3 agent_runs+agent_steps, v4 agent_runs
  CHECK'ine awaiting_user — tablo yeniden kurma; **v5 feedback, v6 patches [ADR-018 D1] —
  sıradaki boş numara v7 [ADR-019 kürasyon]**; migrate() göç sırasında FK'yı kapatır).
  `saveConversation` (2.3b): tam mesaj listesini sessions/messages'a REPLACE eder — chat.start
  (`saveChatTurn` buna delege) VE konuşmalı-agent (engine) aynı kalıcılık modelini paylaşır.
  `runsSince`/`turnStatsSince`/`feedbackSince` (ADR-016 Karar 1, Dilim Z1) opsiyonel `untilMs`
  alır (Dilim Z3: router rolling-window için hep `undefined`, rapor kendi `[from,to]`'u verir)
  — göç YOK, sorgu-zamanı okuma. v5 (ADR-016 Karar 4, Dilim Z2): `feedback` tablosu (açık
  iyi/kötü işaretleme) — `recordFeedback`/`recentFeedback`/`feedbackSince` (yalnız
  `subject_kind='run'`, `agent_runs` JOIN'i ile provider/model/task taşır). Z3: YENİ
  `feedbackSummarySince` (TÜM subject_kind) + `topErrorCodesSince` (rapor için). D7 (ADR-018
  Karar 8): YENİ `agentModelUsageSince` — `agent_runs`ı `runsSince`ten FARKLI eksende
  (`agent_id`+provider+model) gruplar; göç YOK, mevcut tablo üzerine sorgu
- `memory/profile.ts` — SAF, testli, `core/index.ts`'ten dışa açık (ADR-013): `loadProfile`/
  `ensureProfileScaffold` (M1, enjeksiyon — kesiyor/scaffold'u null sayıyor) AYRI amaçlı
  `readProfileSnapshot`/`writeProfile` (M2, REST GET/PUT — TAM içerik, `truncated` yalnız uyarı)
- `secrets/secret-store.ts` — OS keychain + env yedek; anahtar DİSKE YAZILMAZ
- `config/paths.ts` — `~/.symphony` yol haritası (SYMPHONY_HOME ile taşınır). `versionsFile`
  (ADR-017 Karar 4, Dilim F5) — `symphony update`/`rollback`'in {previous,current,at} kaydı
- `config/config.ts` — config.json yükleme (`daemon`/`defaults`/`memory`/`desktop` +
  `limits.maxOutputTokens`: kaçak üretim sigortasının TEK varsayılan kaynağı, vars. 8192)
- `agent/` — Faz 3 agent motoru (SPEC-AGENT.md'nin uygulaması):
  - `errors.ts` — `AgentError` (error.name = protokol hata kodu)
  - `jail.ts` — `WorkspaceJail`: path.resolve+realpath+kök kapsama; kaçış = PERMISSION_JAIL
  - `permissions.ts` — `PermissionEngine`: deny > allow > risk varsayılanı; always_allow kalıcılaştırma
  - `definition.ts` — `~/.symphony/agents/*.md` frontmatter ayrıştırma + varsayılan agent'lar
    (`ensureDefaultAgent` → coder [tam araç] + asistan [salt-okur] + damitici [salt-okur, M3
    arşiv damıtma — asistan ile AYNI araç seti, `symphony memory distill` çalıştırır]; her biri bağımsız)
  - `tools.ts` — 6 araç (read_file/write_file/edit/glob/grep/run_command) + diff/hash + maskeleme
  - `mcp.ts` — MCP istemcisi (ADR-007): `~/.symphony/mcp-servers.json` kayıt defteri
    (stdio), sunucu araçlarını `AgentToolSpec`'e sarar (`mcp__<sunucu>__<araç>`, hep `mutating`)
  - `engine.ts` — koşu döngüsü (AI SDK tool-calling, streamText+agent.delta), izin kapısı,
    durum makinesi, iptal, MCP bağlan/kapat (koşu ömrüyle eşleşir). Dilim 2.2: konuşmalı koşu —
    araçsız tur bitince `awaiting_user`'a runLoop İÇİNDE park (`waitForUser` promise-gate;
    MCP/bağlam canlı kalır), `say()` sonraki kullanıcı turunu teslim eder. Dilim 2.3b: konuşmalı
    koşu `sessionId` + temiz `transcript` (yalnız user/assistant metin) taşır; her asistan turunda
    `store.saveConversation` (kalıcılık), `sessionId` istekte verildiyse `sessionDetail`'den resume
    tohumlar; `start()` `{runId, sessionId}` döner. **Akışlı** (`streamText`, ADR-012): asistan metni
    `agent.delta {runId,text}` ile token-token yayılır. Test mock'ları `doStream` kullanır
    (`scriptToStream`; AI SDK v3 stream part'ları). Birleşik sohbet-agent modu buradan büyüyecek
    (2.2 awaiting_user+agent.say çok-tur, 2.3 birleşik TUI — bkz. ADR-012 + DURUM Dilim 2).
    M1 profil enjeksiyonu (`loadMemoryProfile`) TÜM agent'lara uygulanır — TEK istisna:
    `definition.id === "damitici"` (M3) hiç almaz (canlı bulgu: aksi hâlde arşiv damıtması
    zaten bilinen profille kirlenir, "arşivden yeni ne çıktı" ayrımı kaybolur).
    **İKİ sigorta (SPEC §4):** `maxSteps` araç döngüsünü, `maxOutputTokens` (tanım → config)
    TEK BİR TURUN sonlanmasını garanti eder; tavana çarpan tur `finishReason:"length"` →
    `AGENT_MAX_OUTPUT_TOKENS` ile failed (usage ÖNCE kaydedilir — token harcandı).
    **İptal:** `abortSignal` akış ortasında GERÇEKTEN keser (2026-07-10 ölçümü: SDK 2ms, canlı
    daemon 5ms). `textStream` döngüsü sessizce biter, `result.response/usage` AbortError ile
    reddeder → `catch`'teki `aborted` kontrolü koşuyu `cancelled` yapar. **Mock tuzağı:**
    `engine.test.ts`'in sahte akışları sinyali ELLE dinlemeli (üretimde `fetch` yapar); dinlemezse
    koşu asılı kalır ve "SDK abort'u kesmiyor" YANILGISI doğar — O1'de bir kez oldu

### packages/cli/src — symphony komutu
- `index.ts` — commander kayıtları; argümansız → TUI
- `client/daemon-client.ts` — WS istemcisi + otomatik daemon başlatma (`connectToDaemon`) +
  REST geçmiş sorguları (`listSessions`/`sessionDetail` — Bearer token, shared şema, 404→null).
  `getContextMap(limit?)` (ADR-019, Dilim H4): `getReport`/`getMemory` ile AYNI desen (özel
  `getHistory` REST yardımcısını kullanır) — `symphony harita`nın TEK veri kaynağı
- `commands/` — status/models/watch/history/memory/agents/agent/feedback/report/add/sync (her komut tek dosya)
  - `add.ts` — `symphony add <npm-paketi>`: eklenti sistemi, `mcp.addServer` isteği atar
  - `sync-plan.ts` (ADR-017 Karar 3, Dilim F4) — SAF, testli: `SYNC_WHITELIST` (config/providers/
    agents/memory/mcp-servers) + `buildGitignoreContent` (`*` yoksay + beyaz liste negatifleri;
    `.gitignore` KENDİSİ de negatiflenir yoksa kendini yoksayıp `git add`i reddeder) +
    `planLocalBackup` (yeni-makine çakışmasında `.bak` hedefleri)
  - `sync.ts` (ADR-017 Karar 3, Dilim F4) — `symphony sync init <url>` (ilk kurulum/yeni makine:
    uzakta `main` VARSA çakışan dosyaları `.bak`layıp checkout eder, YOKSA commit+push) +
    `symphony sync` (add+commit varsa → `pull --rebase` → push; çakışmada DURUR, elle-çöz mesajı
    — otomatik birleştirme YOK). `simple-git` kullanır; kimlik doğrulama sistemin git credential
    helper'ına bırakılır. `daemon.token`/`data`/`logs` ASLA beyaz listede değil
  - `doctor.ts` (ADR-018, Dilim D2) — `symphony doctor [--kod X]`: `doctor.diagnose` → aday
    listesi → `doctor.run` → boru hattını canlı izler (`doctor.phase` ilerleme, agent olayları,
    izin istekleri terminalden — doktor ayrıcalıklı mod DEĞİL, agent tanımı). Sonuç: yama
    ÖNERİSİ (`doctor.patch.proposed`) — uygulanmaz, `symphony patch apply` (D3) ile uygulanır.
    `renderDiff`'i `agent.ts`'ten import eder (tek kaynak)
  - `bekci.ts` (ADR-018 Karar 7, Dilim D6) — `symphony bekci ekle <ad> <repo> <log> [--test]` /
    `bekci liste`. `ekle`, `repoPath`nin GERÇEK bir git repo KÖKÜ olduğunu doğrular (canlı bulgu:
    aksi hâlde worktree ata repo'ya sızabilirdi) — daemon YENİDEN BAŞLATILMADAN 10sn içinde görülür
  - `harita.ts` (ADR-019 Karar 2/6, Faz "H" Dilim H4) — `symphony harita ekle <sessionId|runId>
    [--baslik X]` / `harita liste`. `resolvePinTarget`: `history.ts`'in `resolveSession`iyle AYNI
    ön-ek deseni (TAM eşleşme önce, sonra tekil ön-ek, belirsizlikte/bulunamayınca red) — yalnız
    `kind==="session"|"run"` düğümler aday (`client.getContextMap`ten). `map.pin` isteğini atar;
    TUI'nin `/harita`sıyla AYNI eylem, farklı giriş yüzeyi
  - `agent-suggestion.ts` (ADR-018 Karar 8, Dilim D7 — Faz 6'nın son açık maddesini kapatır) —
    `symphony agent-oneri uygula <agentId>`: `symphony report`ın `agentSuggestions`ını YENİDEN
    çeker (ikinci hesap YOK), eşleşeni bulur, `agent/definition.ts`'in YENİ `applyAgentModelPin`
    (SAF metin-yaması: yalnız `provider:`/`model:` satırları, gövde dokunulmaz) + `agentDefinitionFilePath`
    ile diff gösterir, onay ister, yazar. Daemon restart GEREKMEZ (tanımlar her koşuda taze okunur)
  - `patch.ts` (ADR-018 Karar 3+4+5, Dilim D3+D4) — `symphony patches` · `patch apply <id>` ·
    `patch reject <id>`. **Apply zinciri (WATCHDOG):** ön koşullar (repo TEMİZ olmalı; yama
    `proposed`; dal var) → onay (korumalı yolda "EVET" şart) → `git merge --no-ff` → `pnpm build`
    → `pnpm test` (ANA DALDA — sandbox yeşili merge sonrası dünyayı kanıtlamaz) → daemon kapat →
    yeni kodla başlat → sağlık → **başarısızsa `reset --hard` + YENİDEN DERLE + eski kodla başlat
    + `reverted`**. Yeniden derleme ŞART: yoksa daemon bir sonraki açılışta bozuk `dist`i yükler.
    `patch trust <kod>`/`untrust <kod>` (D4): sicili gösterir + onay ister (untrust ONAYSIZ —
    sıkılaştırma güvenlidir); `patches` çıktısına sicil satırı ("N/M sağlıklı" + [GÜVENİLİR])
  - `doctor.ts` — `--proje <ad>` (D6): `doctor.diagnose` ATLANIR, `doctor.run {proje}` gönderilir;
    izleme (`watchDoctorRun`) self-patch ile bekçi modu ARASINDA PAYLAŞILIR (tek izleyici, iki çağrı yolu)
  - `doctor.ts` (D4 eki): `doctor.patch.proposed` alınca kategori GÜVENİLİR + test yeşili +
    korumalı yol YOK ise `patchApplyCommand`ı SORMADAN çağırır (aynı süreç içinde — insan zaten
    `symphony doctor`u başlattı); üç koşuldan biri eksikse eskisi gibi öneri olarak biter
  - `update.ts` (ADR-017 Karar 4, Dilim F5) — `symphony update` (npm view→install-g→
    `versions.json`→`/api/shutdown`+`ensureDaemonRunning`) + `symphony rollback` (previous'a
    döner, kaydı swap eder). SAF yardımcılar (`readVersions`/`writeVersions`/`nextVersions`/
    `swappedVersions`) aynı dosyada, ayrı test edilir. `execa` ile npm çağrılır (testte MOCK)
  - `feedback.ts` (ADR-016 Karar 4, Dilim Z2) — `symphony feedback <runId> iyi|kötü [-n not]`:
    Türkçe değeri wire'a çevirir, `feedback.submit` atar. **Tam UUID gerekir** (history'nin
    aksine id ön eki DESTEKLENMEZ — prefix için "agent runs listesi" ucu gerekirdi, kapsam dışı)
  - `report.ts` (ADR-016 Karar 5, Dilim Z3) — `symphony report [--from --to]`: REST
    `getReport`'tan çeker, SAF `formatReportMarkdown` ile Türkçe markdown'a çevirir (LLM YOK,
    deterministik), stdout + `~/.symphony/reports/<isoWeekLabel>.md`'ye yazar
  - `memory.ts` — commander alt-komut grubu (`index.ts`'te `memory show|path|distill`, show
    varsayılan): `memoryShowCommand` (REST `getMemory`) · `memoryPathCommand` (dosya yolu YAZAR,
    daemon'a bağlanmaz) · `memoryDistillCommand` (M3, ADR-013 Karar 5) — arşiv dizinini
    `listArchiveFilesByRecency`ile (SAF, mtime sıralı) tarar, `resolveDistillModel`ile yerel
    modeli PİNLER (--bulut yoksa), `agentId:"damitici"` ile tek-seferlik agent koşusu başlatır,
    sonucu `writeDistillDraft`ile `profil.taslak.md`ye yazar — **`profil.md`ye YAZMA yolu HİÇ
    YOK** (kasıtlı, ADR-013): canlı profil yalnız insan eliyle (editör ya da REST PUT) değişir.
- `tui/` — Ink: app.tsx (akış: karşılama→PERSONA seçici→konuşma), welcome.tsx, logo.ts
  - `persona-picker.tsx` — **birleşik giriş (Dilim 2.3a)**: "kiminle konuşmak istersin?" — Sohbet
    (chat.start, resume) + kayıtlı agent'lar TEK listede. `Persona = {kind:"chat"} | {kind:"agent",agent}`.
    (mode-picker + agent-picker'ın YERİNE — ikisi de silindi.)
  - `app.tsx` içinde `ChatFlow` — "Sohbet" personası orkestrasyonu: (kayıtlı sohbet varsa) yeni/devam
    seçimi → model seç → Chat. Devam: `sessionDetail` REST'ten tohum + model sabitlenir (v1: son sohbet)
  - `app.tsx` içinde `AgentFlow` (2.3c) — agent personası orkestrasyonu, ChatFlow paraleli: yeni/devam
    (ResumePicker) → AgentRun. Devam: `sessionDetail` tohumu → AgentRun'a `initialSessionId`/
    `seedExchange`/`fixedModel`; agent.start `sessionId` ile aynı oturuma yazar (2.3b üstüne oturur)
  - `model-picker.tsx` / `chat.tsx` — Sohbet dalı (`chat.tsx`: opsiyonel `initialSessionId`/`initialHistory`
    tohumu → önceki oturuma devam; `HistoryEntry` dışa aktarılır). H4 (ADR-019 Karar 6): `/harita
    [başlık]` (`HARITA_COMMAND` tam eşleşme) `submit`te YAKALANIR — modele GİTMEZ,
    `map.pin{ref:{kind:"session",id:sessionIdRef.current}}` atılır, `mapNote` state'i tek satır
    onay/hata gösterir (chat `history`sine KARIŞMAZ)
  - `resume-picker.tsx` — "Yeni sohbet / Önceki sohbete devam et" seçici (↑/↓+Enter; picker deseni)
  - `agent-run.tsx` — asistan/coder personası: görev girişi + canlı koşu (izin kutusu tek tuş e/d/h, renkli diff,
    araç günlüğü, Esc iptal) — `cli/commands/agent.ts` ile aynı olaylara abone, Ink sunumu.
    Dilim 2.2: koşular `conversational: true` başlar; awaiting_user'da "devam yaz" girişi
    (`agent.say`, aynı runId), biten turlar `exchange` dökümünde kalır. Dilim 2.3c: opsiyonel
    `initialSessionId` (agent.start'a → oturuma devam) / `seedExchange` (ekran tohumu) / `fixedModel`
    (model seçici atlanır) — AgentFlow resume'da geçer. D7 sonrası (2026-07-11, kullanıcı isteği):
    `pinnedProvider`/`pinnedModel` (agent tanımının pini, `App`→persona.agent'tan gelir) — `fixedModel`
    GİBİ seçiciyi ATLAMAZ, yalnız `AgentModelPicker`nin BAŞLANGIÇ imlecini o modele koyar (liste TAM
    kalır, "(varsayılan)" etiketiyle işaretlenir). `resetForNewTask({clearModel})`: koşu BAŞARISIZ
    olunca "yeni görev" model seçiciyi de yeniden gösterir (aynı modelle sessizce tekrar denenmez);
    BAŞARILI koşuda davranış DEĞİŞMEDİ (aynı model, doğrudan görev girişi). H4 (ADR-019 Karar 6):
    `/harita [başlık]` `submitSay`de (awaiting_user devam girişi) YAKALANIR — `agent.say`e GİTMEZ,
    `map.pin{ref:{kind:"run",id:runId}}` atılır (`sessionId` DEĞİL — yeni koşularda hiç
    TUTULMUYOR, agent koşuları `agent_runs` tablosunda). İlk görev kutusunda (runId henüz yokken)
    KASITLA yakalanmaz

### packages/ui/src — masaüstü dashboard (React+Vite, Faz 4) — hem tarayıcı hem Tauri
- `config.ts` — `getBootstrap()`: token+port'u `window.__SYMPHONY__` (Tauri enjekte eder) ya
  da `import.meta.env` (tarayıcı dev, `dev:token` script'i .env.local'e yazar) kaynağından alır
- `daemon/client.ts` — `DaemonConnection`: native WebSocket + `shared` şemaları; hello
  handshake → snapshot → yayın olaylarını store'a akıtır; bağlanınca `queryUsage()`
  (`usage.query {groupBy:"model"}`); üstel geri çekilmeli yeniden bağlanma. `fetchRoadmap`/
  `fetchContextMap({limit?,week?})`/`fetchSessionDetail`: WS DIŞI, istek-başına REST (roadmap
  deseni — bağlantı yok/hata/şema uyuşmazlığı → sessizce `null`, throw etmez). H3 (ADR-019 Karar
  2/6): `respond`/`queryUsage` fire-and-forget'in AKSİNE, kürasyon metodları (`pin`/`renameNode`/
  `deleteNode`/`createGroup`/`addMember`/`removeMember`/`addLink`) `.ok`/`error` cevabını BEKLER —
  `pending` Map (mesaj id→resolver+timer) + `awaitReply` (8sn timeout) + `settle`; `onMessage`
  pending'i helloId'den SONRA, `store.handleEvent`ten ÖNCE kontrol eder; `onclose` bekleyenleri
  DISCONNECTED ile çözer. `CurationResult` export. Sürüm sapması (Karar 7c): eski daemon `map.*`
  tipini tanımaz → cevap `replyTo:null` (korelasyon eşleşmez) → timeout → "güncelle" ipucu
- `store.ts` — zustand; `handleEvent` olay tiplerini UI durumuna (providers/runs/log/pending +
  usage + `limits` + oturum cache sayaçları) çevirir. **WS→UI eşlemesinin TEK yeri**
  (testli: `store.test.ts`). Usage: `usage.query.ok` seed'ler, `usage.updated` girdiyi totals'la
  DEĞİŞTİRİR (çift saymaz) + cache biriktirir; `provider.limits` sağlayıcı başına son görüntü;
  `lastCompletedAt`/`lastErrorAt` = tesseract converge/flaş sinyalleri; `runStreams`
  (runId→metin, `agent.delta` biriktirir; araç başlayınca/koşu bitince/snapshot'ta temizlenir)
- `App.tsx` — `view` sekmesi (Dilim Z5: "Şef Paneli" ⇄ "Bağlam Haritası", topbar sağında) sarmalar:
  Şef Paneli = bağlantı + sağlayıcı sağlığı + **Model panosu** (token/maliyet/önbellek) +
  **API kapasitesi** (rate-limit çubukları) + aktif koşular (altında `.run-stream` canlı agent
  akış metni, dilim 2.1b) + canlı akış; Bağlam Haritası = `map/ContextMap.tsx`. İzin kartları +
  LivingScene HER İKİ sekmede de görünür (aksiyon/durum, sekmeye bağlı değil)
- `scene/LivingScene.tsx` — İNCE KABUK: mood+vitals+converge sinyalini store'dan türetir,
  Canvas + mood HUD (sol-alt) + GPU HUD (sağ-üst) kurar; sahnenin kendisi TesseractScene'de
- `scene/TesseractScene.tsx` — YAŞAYAN TESSERACT (dilim 8+8b, sinematik): ÜÇ kademeli küp
  (bakır dış+köprü = GPU; cyan iç = LLM/mood; violet derin+bağ+spoke = çekirdek kafesi),
  kırmızı çekirdek (içinde point-light; 3 kademeli converge şelalesi → patlama + şok halkası).
  GERÇEK bloom (UnrealBloomPass, three addons — paket yok), GLSL akış shader tüpleri,
  jiroskop halkaları ×3, veri zerreleri (220), yıldız+nebula atmosferi, sinematik kamera,
  parallax. Ayar sabitleri dosya başında (BLOOM_*, NODE_RADIUS, STRUT_RADIUS, TRAIL…).
  YENİ `runs` prop'u (Faz 4 "yaşam formu", 2026-07-10): ajan uyduları — `tesseract/satellites.ts`
  sistem durumu, yörünge trigonometrisi burada (motes ile AYNI iş bölümü)
- `scene/tesseract/satellites.ts` — SAF, testli (`pulses.ts` deseni, rng enjekte): her aktif
  koşu için `SatelliteEntry` (spawnT doğuş, dieT ölüm/patla-sön — 0'dan 1'e, silinene dek ANINDA
  kaybolmaz). `MAX_SATELLITES=8` (ADR-014 `MAX_CHILD_RUNS` ile AYNI). Ölüm rengi mood'dan
  BAĞIMSIZ (gerçek `ActiveRun.state` hiç "completed"/"failed" göstermiyor — store.ts o olaylarda
  run'ı DOĞRUDAN siliyor, patch'lemeden; bkz. DURUM.md)
- `scene/tesseract/geometry.ts` — SAF, testli: 3 kademeli küp topolojisi (25 düğüm/60 kenar,
  merkeze-doğru sıralı; DERİN küp = iç×DEEP_SCALE) + `projectNodes` (XW hiper-dönüş +
  perspektif bölme + innerSwell)
- `scene/tesseract/pulses.ts` — SAF, testli, rng enjekte: atım sistemi (synapse/energy/converge),
  oran-birikimli doğum, önce-hareket-sonra-doğum, `fireConverge` = 3 kademeli şelale
  (köprü→bağ→spoke) → coreHits (çekirdek patlaması)
- `scene/mood.ts` — SAF: sistem durumu → mood (offline>error>awaiting>executing>thinking>idle) +
  stil. `MoodStyle.activity` = GPU'dan bağımsız LLM sürücüsü (iç sinaps atım oranını sürer)
- `scene/hardware-vitals.ts` — SAF: `deriveGpuVitals` (en yoğun GPU → load/heat/memPct). Testli
- `map/layout.ts` — SAF, testli (ADR-016 Karar 6, Dilim Z5 + ADR-019 Karar 4/5, Dilim H3+H5):
  `layoutContextMap(graph, width, height)` — d3-force YALNIZ konum hesaplar (deterministik
  başlangıç: indekse göre çember), render `map/ContextMap.tsx`'in SVG'si. H3: `week` düğümleri
  simülasyona GİRMEZ — `id` (="week:YYYY-Www") string sırasıyla (kronolojik) alt kenara `fx/fy`
  ile sabitlenir (`WEEK_MARGIN_X/Y`; tek hafta ortaya). İç mantık `buildSimulation`/
  `toLayoutResult`e refaktör edildi (H5) — `layoutContextMap`in davranışı BİREBİR aynı kaldı.
  YENİ `startLiveLayout(graph,width,height,onTick)` (H5, "sürekli hafif drift"): AYNI fizik,
  ama `.stop().tick(300)` YERİNE `alphaTarget(0.02).restart()` — simülasyon hiç soğumaz, d3'ün
  kendi zamanlayıcısı her karede `onTick`i çağırır. Bu fonksiyon ARTIK SAF DEĞİL — `TesseractScene.
  tsx`/`LivingScene.tsx` ile AYNI "canlı, test edilmeyen ince kabuk" kategorisinde (dönen `stop()`
  temizlik). `d3-force` bağımlılığı (GEREKSINIMLER'de)
- `map/motion.ts` — SAF, testli, `scene/tesseract/pulses.ts` deseninde (ADR-019 Karar 5, Dilim H5):
  `springScale(ageMs)` — kritik-altı sönümlü sinüs, yeni düğüm doğuşu (0→sıçrama→1); `fadeOpacity
  (elapsedMs)` — doğrusal 1→0, katlanma/silme süzülüşü; `isRecentEdge(fromAt,toAt,nowMs)` — son
  24 saat penceresi (akış nabzı adaylığı); `dashOffset(nowMs)` — sürekli kayan SVG dash-offset.
  Canlı DOM ölçümüyle doğrulandı (ekran görüntüsü değil, sayısal kanıt): spring 9→9.38→8.95→9,
  fade 1→0.52→0.05→kayboldu
- `map/curation-actions.ts` — SAF, testli (ADR-019 Karar 2/6, Dilim H3): `curationActionsFor(kind)`
  bir düğüm türünde detay panelinde HANGİ kürasyon butonunun çıkacağını verir (session/run→pin+
  link+group; project/model/agent→link+group KORUMALI; context→rename+link+group+delete; group→
  rename+member-add/remove+link+delete; week→open-week; bilinmeyen→[]) + `curationErrorMessage`
  (hata kodu→Türkçe). `viewbox.ts` precedent'i: `ui`de bileşen testi YOK → "hangi düğümde hangi
  buton" saf mantığı bileşenden AYRILDI (yanlış düğüme sil butonu koymak sinsi hata olurdu)
- `map/viewbox.ts` — SAF, testli (kullanıcı isteği, 2026-07-11): `zoomViewBox`/`panViewBox` —
  `ui` paketinde React bileşen testi altyapısı (jsdom/testing-library) YOK, bu yüzden yakınlaştır/
  kaydır matematiği `ContextMap.tsx`'ten AYRILDI ki `layout.ts` deseniyle (saf girdi/çıktı) test
  edilebilsin. `zoomViewBox`: "zoom to cursor" (imlecin altındaki dünya noktası SABİT kalır,
  MIN/MAX genişlikte kırpılır). `panViewBox`: HER ÇAĞRIDA sürüklemenin BAŞLANGIÇ viewBox'ından
  hesaplanır (birikmez, kaymayı önler)
- `map/ContextMap.tsx` — Bağlam Haritası (Dilim Z5 + ADR-019 Karar 2/3/4/5/6/7b, Dilim H3+H5):
  dashboard'dan AYRI görünüm, `App.tsx`'teki `view` sekme state'iyle açılır. Yakınlaştır/kaydır
  (2026-07-11): SVG `viewBox` state'te; fare tekerleği `zoomViewBox` (native `wheel` dinleyici —
  React sentetik `onWheel` passive olabilir), tekerlek tuşu (orta tık `e.button===1`) basılı
  sürükleme `panViewBox` (window seviyesi). Sol tık = düğüm seçimi (viewBox'tan bağımsız gerçek
  koordinat). **H3 kürasyon:** `reload(weekArg)` (stale-cevap kalkanı `reloadSeq`); düğüm şekli
  türe göre (`week`/`group`=`<rect>`, gerisi `<circle>`), model yerel/API sınıfı (`nodeClassName`
  →`.map-node-model-local/-api`), bilinmeyen tür `NODE_RADIUS[kind] ?? DEFAULT` (Karar 7b jenerik
  düğüm); detay panelinde `curationActionsFor` butonları (pin zaten sabitlenmişse
  `pinnedRefIds`ten gizlenir); "Bağla/Üye ekle/Kopar" HEDEF-SEÇME modu (`pending` state + üst
  bant + Esc iptal + hedef tıklaması `completeTarget`); rename/group INLINE panel-içi form (Tauri
  webview'de `prompt()` güvenilmez); hafta düğümü → `WeekDetail` + "Haftayı aç" drill-down
  (`fetchContextMap({week})` + "← dön"). Kürasyon istekleri `daemon.*` (client.ts, `.ok`/`error`
  bekler), hata → `.map-curation-error` bandı (sürüm sapması ipucu dahil, Karar 7c). **H5 yaşayan
  katman:** `selected` artık `NodeInfo` (x/y'siz — panel konuma ihtiyaç duymaz, canlı konum
  `nodes`de id'yle eşleşir); `reload()` `reduceMotionRef`e göre `startLiveLayout` (canlı, sürekli
  drift) YA DA `layoutContextMap` (statik, H3 davranışı) seçer; `firstSeenRef` (id→doğum anı, İLK
  yüklemede TÜM düğümler "zaten var" damgalanır — aynı anda zıplama olmasın) + `departed` state
  (kaybolan düğümler son konumlarında donuk `fadeOpacity` ile süzülür, `pointerEvents:none`);
  render'da yarıçap `springScale(yaş)` ile ölçeklenir, kenarlar `isRecentEdge` ise dash alır
  (reduced-motion'da desen KALIR, yalnız `stroke-dashoffset` ANİMASYONU durur — bilgi kaybolmaz).
  `matchMedia("(prefers-reduced-motion: reduce)")` dinlenir, canlı toggle'da simülasyon ANINDA durur
- `index.css` — marka paleti (cyan/magenta/red, logo ile aynı); düz CSS; `.map-*`/`.view-tab*`
  (Dilim Z5). H3 (ADR-019): yeni düğüm renkleri (`.map-node-model-local`=green/`-api`=amber
  [yerel↔bulut], `-agent`=copper, `-context`=text parlak, `-group`=text-çerçeveli rect,
  `-week`=dim rect), yeni kenar stilleri (`-model`/`-agent`/`-week` omurga/`-pin` kesikli/`-link`
  cyan/`-member` violet), kürasyon kabuğu (`.map-wrap`/`.map-drill-bar`/`.map-pending-banner`/
  `.map-curation-error`/`.map-curation-*`). H5: `.map-edge-recent` (yalnız `stroke-width` — renk
  kind'tan gelir, ÜZERİNE YAZILMAZ; dash deseni/kayması JS'ten dinamik gelir)

### packages/desktop/src-tauri — Tauri 2 kabuğu (Rust) — `ui/dist`'i sarar
- `src/lib.rs` — `run()`: token'ı `~/.symphony/daemon.token`'dan + portu config'ten okur,
  webview'e `initialization_script` ile enjekte eder (sayfa JS'inden ÖNCE), pencereyi kurar
- `tauri.conf.json` — `frontendDist: ../../ui/dist`, `devUrl` vite; `windows: []` (Rust kurar)
- `Cargo.toml` / `Cargo.lock` — Rust bağımlılıkları (commit'lenir; `target/` gitignore)
- çalıştırma: `pnpm --filter @symphony/desktop desktop:dev` (tauri dev — vite'i de başlatır)

## Değişmez hatırlatmalar (tam listesi CLAUDE.md'de)

- Protokol değişikliği: ÖNCE `PROTOKOL.md`, SONRA shared şeması, SONRA kullanım.
- Test geçmeden iş bitmedi; `pnpm build && pnpm test && pnpm lint` üçlüsü temiz olmalı.
- Bağımlılık eklemeden önce `docs/GEREKSINIMLER.md` envanterine bak ve işle.

## Oturum ekonomisi kuralları (2026-07-04 kararı)

1. Oturuma `DURUM.md` + `BAGLAM.md` ile başla; ilk 10 dakikada geniş kod taraması YASAK.
2. Tasarım/mimari oturumları pahalı modelle, mekanik uygulama oturumları ucuz modelle:
   pahalı oturumun çıktısı her zaman "ucuz modelin takip edebileceği yazılı talimat" olsun
   (DURUM.md "Sıradaki adım" bölümü bu yüzden adım adım yazılır).
3. Oturum sonunda bu haritayı ve DURUM.md'yi güncelle; DURUM.md'de yalnız AKTİF fazın
   ayrıntısı kalsın, biten fazların ayrıntısı oturum günlüklerine taşınsın.
4. Az sayıda uzun oturum > çok sayıda kısa oturum (sabit okuma maliyeti oturum başına ödenir).
