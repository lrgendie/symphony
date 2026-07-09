# 📡 PROTOKOL.md — Symphony Daemon İletişim Spesifikasyonu (v1)

> Bu belge `packages/shared`'ın kaynağıdır: buradaki her mesajın zod şeması shared'da
> birebir karşılık bulur. Belgeyle kod ayrışırsa **belge kazanır** — kodu düzelt.
> Değişiklik kuralı: yeni alan eklemek serbest (geriye uyumlu), alan silmek/yeniden
> adlandırmak `protocolVersion` artırımı gerektirir.

## 1. Taşıma katmanı

- Daemon tek port dinler: `127.0.0.1:7770` (yapılandırılabilir: `~/.symphony/config.json` → `daemon.port`).
- **REST** `http://127.0.0.1:7770/api/...` → durum sorguları, tek seferlik komutlar.
- **WebSocket** `ws://127.0.0.1:7770/ws` → olay akışı + uzun ömürlü işlemler. Arayüzlerin ana kanalı budur.
- Yalnızca loopback'e bind edilir. **Kimlik doğrulama:** daemon açılışta rastgele token üretip
  `~/.symphony/daemon.token` dosyasına yazar (yalnız kullanıcı okuyabilir). İstemci token'ı
  REST'te `Authorization: Bearer <token>` başlığıyla, WS'te bağlantı sonrası ilk mesaj olan
  `hello` içinde gönderir. Token'sız bağlantı 3 sn içinde kapatılır.

### 1.1 REST uçları

| Metot + yol | Auth | Açıklama |
|---|---|---|
| `GET /api/health` | yok | Sağlık sondası: `{ ok, daemonVersion, protocolVersion }` |
| `POST /api/chat` | Bearer | Streaming sohbet (gövde: `chat.start` şeması; cevap: SSE) — curl kabul testlerinin ucu |
| `GET /api/history/sessions?limit=50` | Bearer | Son sohbet oturumları (yeniden eskiye): `{ sessions: HistorySessionSummary[] }` |
| `GET /api/history/sessions/:id` | Bearer | Bir oturumun tam dökümü: `{ session, messages: HistoryMessage[] }`; yoksa 404 |
| `GET /api/memory` | Bearer | **(planlandı — Dilim M2, ADR-013; henüz uygulanmadı)** Kullanıcı profili: `{ content, chars, truncated, updatedAt }`; dosya yoksa boş iskelet |
| `PUT /api/memory` | Bearer | **(planlandı — Dilim M2, ADR-013; henüz uygulanmadı)** Profilin TAM içeriğini değiştirir (gövde: `{ content }`) — yalnız insan arayüzünden çağrılır; agent araç yüzeyinde bu uca giden yol YOKTUR (ADR-013 yazma kısıtı) |

Kalıcı geçmiş SQLite'tadır ve YALNIZ REST ile sorgulanır (§6: olay replay'i yok).
Cevap şemaları `shared`'dadır: `HistorySessionSummarySchema`, `HistoryMessageSchema`,
`HistorySessionsResponseSchema`, `HistorySessionDetailResponseSchema`.

**Kullanıcı profili (hafıza, ADR-013):** `~/.symphony/memory/profil.md` içeriği daemon
tarafından her agent koşusu ve chat isteğinde system bağlamına eklenir (sunucu tarafı;
kalıcı oturum geçmişine YAZILMAZ). Protokol mesajlarını değiştirmez — istemciler profili
görmez/taşımaz; yönetimi yalnız yukarıdaki REST uçları (M2) ve doğrudan dosya düzenlemesiyledir.

## 2. Zarf (envelope)

Tüm WS mesajları tek zarf tipindedir:

```jsonc
{
  "id": "uuid",            // her mesajda benzersiz
  "type": "agent.start",   // aşağıdaki kataloglardan biri
  "ts": 1750000000000,     // epoch ms (gönderen saati)
  "replyTo": "uuid|null",  // bir isteğe cevapsa o isteğin id'si
  "payload": { }           // type'a özgü şema
}
```

- İstek/cevap eşleşmesi `replyTo` ile yapılır. Her istek en az bir cevap alır:
  başarıda `<type>.ok`, hatada `error`.
- `error` payload'ı: `{ code: string, message: string, details?: object }`.
  Kod uzayı: `AUTH_*`, `PROVIDER_*`, `AGENT_*`, `PERMISSION_*`, `VALIDATION_*`, `INTERNAL_*`.

## 3. İstemci → Daemon (istekler)

| type | payload | Açıklama |
|---|---|---|
| `hello` | `{ token, client: "cli"\|"desktop"\|"web", protocolVersion }` | İlk mesaj. Cevap: `hello.ok { daemonVersion, protocolVersion, snapshot }` |
| `state.sync` | `{}` | Tam durum anlık görüntüsü iste (yeniden bağlanmada) |
| `chat.start` | `{ sessionId?, provider, model, messages[], options? }` | Sohbet başlat. `options: { temperature? (vars. 0), maxTokens? }` |
| `chat.cancel` | `{ sessionId }` | Akışı durdur |
| `agent.start` | `{ agentId, task, cwd, model?, provider?, conversational?, sessionId? }` | Agent görevi başlat (agentId = `~/.symphony/agents/` tanımı). `conversational: true` (ADR-012) → koşu tur bitince `completed` yerine `awaiting_user`'a park olur, `agent.say` ile sürer. `sessionId` (Dilim 2.3b, yalnız `conversational` ile anlamlı) → o oturuma DEVAM: daemon geçmiş user/assistant mesajlarını bağlama tohumlar, konuşma aynı oturuma yazılır. Cevap: `agent.start.ok { runId, sessionId }` (konuşmalı koşunun yazdığı oturum; verilmezse daemon üretir) |
| `agent.say` | `{ runId, text }` | Konuşmalı koşuya (ADR-012) sonraki kullanıcı turunu ekle — koşu `awaiting_user`'dayken; `thinking`'e geçip devam eder. Koşu `awaiting_user` değilse `AGENT_NOT_AWAITING_USER`, tanınmıyorsa `AGENT_UNKNOWN_RUN` hatası döner |
| `agent.cancel` | `{ runId }` | Koşan agent'ı iptal et (konuşmalı koşuyu da kapatır) |
| `permission.respond` | `{ requestId, decision: "allow"\|"deny"\|"always_allow"\|"allow_for_run" }` | Bekleyen izin isteğine cevap — `allow_for_run`: bu koşu boyunca aynı araç için tekrar sormaz, diske YAZILMAZ (SPEC-AGENT §5) |
| `models.list` | `{}` | Tüm sağlayıcıların kullanılabilir modelleri |
| `agents.list` | `{}` | Kayıtlı agent tanımları (`~/.symphony/agents/*.md`). Cevap: `agents.list.ok { agents: AgentSummary[] }` |
| `providers.status` | `{}` | Sağlayıcı sağlık durumları |
| `router.suggest` | `{ task, constraints?: { maxCostUsd?, preferLocal? } }` | "Bu iş için hangi model?" önerisi |
| `usage.query` | `{ from?, to?, groupBy? }` | Token/maliyet raporu |
| `mcp.addServer` | `{ name, command, args? }` | Eklenti sistemi (ROADMAP Faz 3, SPEC-AGENT §2.1): MCP sunucusuna canlı bağlanıp doğrular, `~/.symphony/mcp-servers.json`'a kaydeder. Cevap: `mcp.addServer.ok { name, tools: string[] }`; bağlantı başarısızsa `AGENT_MCP_CONNECT_FAILED` ile `error` — dosyaya YAZILMAZ |

**Sohbet oturumu ve geçmiş:** `chat.start.sessionId` verilmezse daemon her istek için yeni
oturum üretir. Çok turlu bir sohbeti TEK oturum olarak kaydettirmek isteyen istemci, ürettiği
`sessionId`'yi turlar boyunca sabit tutar ve her turda TAM mesaj geçmişini gönderir. Daemon,
başarıyla biten her turda oturumun mesajlarını bu tam geçmiş + asistan cevabıyla DEĞİŞTİRİR
(replace — idempotent). Başlık ilk kullanıcı mesajından türetilir. İptal/hata turu geçmişi değiştirmez.

**Konuşmalı agent koşusu ve geçmiş (Dilim 2.3b):** `conversational` agent koşusu da aynı
`sessions`/`messages` tablosuna yazılır — böylece asistan/coder konuşmaları da `symphony history`'de
görünür ve sürdürülebilir. Daemon, koşunun `sessionId`'sini (istekte verilmezse ürettiği) taşır ve
her ASİSTAN metin turu tamamlandığında (araçsız tur → `awaiting_user` park ya da `completed`) o ana
dek biriken **yalnız user/assistant metin** turlarını REPLACE eder (araç çağrısı/sonucu mesajları
geçmişe GİRMEZ — `messages` yalnız system/user/assistant metni taşır). Başlık ilk kullanıcı
mesajından türetilir. Böylece chat.start ve konuşmalı-agent aynı kalıcılık modelini paylaşır.

## 4. Daemon → İstemci (olaylar)

Olaylar `replyTo` taşımaz; abone olan **tüm** istemcilere yayınlanır (terminal ⇄ masaüstü
eş zamanlılığının kaynağı budur).

| type | payload | Açıklama |
|---|---|---|
| `chat.delta` | `{ sessionId, text }` | Streaming metin parçası |
| `chat.completed` | `{ sessionId, usage: { inputTokens, outputTokens, costUsd } }` | |
| `agent.run.started` | `{ runId, agentId, task, model, cwd }` | |
| `agent.run.state` | `{ runId, state }` | Durum makinesi geçişi (bkz. §5) |
| `agent.delta` | `{ runId, text }` | Streaming asistan metni parçası (ADR-012; `chat.delta`'nın koşu-anahtarlı ikizi) |
| `agent.step.thinking` | `{ runId, summary? }` | Model düşünüyor |
| `agent.tool.requested` | `{ runId, requestId, tool, args, riskClass, diff? }` | İzin gerekiyorsa; `diff` dosya değişikliklerinde zorunlu |
| `agent.tool.started` | `{ runId, tool, argsSummary }` | |
| `agent.tool.completed` | `{ runId, tool, ok, resultSummary, durationMs }` | |
| `agent.run.completed` | `{ runId, result, usage }` | |
| `agent.run.failed` | `{ runId, error }` | |
| `provider.health` | `{ provider, status: "up"\|"down"\|"degraded", latencyMs? }` | Periyodik + değişimde |
| `usage.updated` | `{ provider, model, deltaTokens, deltaCostUsd, totals, cacheReadTokens?, cacheCreationTokens? }` | Sayaç artışı; cache token'ları sağlayıcı desteklerse (Anthropic) eklenir |
| `provider.limits` | `{ provider, requestsRemaining?, requestsLimit?, requestsResetAt?, tokensRemaining?, tokensLimit?, tokensResetAt?, retryAfterSec?, at }` | API rate-limit anlık görüntüsü (sağlayıcı cevap header'larından; her model cevabında). Header taşımayan sağlayıcıda yayınlanmaz. |
| `hardware.updated` | `{ gpus: [{ index, name, utilizationPct, memUsedMb, memTotalMb, temperatureC\|null }], sampledAt }` | Yerel GPU vitalleri; periyodik (~2sn) + yeni bağlanınca son örnek. GPU yoksa yayınlanmaz. NVIDIA v1 (nvidia-smi). |
| `log.entry` | `{ level, source, message, runId? }` | Canlı log akışı (UI log paneli) |

## 5. Agent durum makinesi

```
queued → thinking → executing_tool → thinking → ... → completed
              ↘ awaiting_permission ↗                ↘ failed
              ↘ awaiting_user ↗ (konuşmalı, ADR-012)   ↘ (her durumdan) cancelled
```

Geçerli geçişler yalnız bunlardır; `agent.run.state` başka değer taşıyamaz.
`awaiting_permission` süresiz bekler (timeout yok — insan kararı beklenir); iptal edilebilir.
**Konuşmalı koşu (ADR-012):** `conversational: true` başlatılan koşu, tur araç çağrısı OLMADAN
bitince `completed` yerine `awaiting_user`'a geçer ve sonraki `agent.say`'i bekler (thinking'e döner).
Koşu yalnız `agent.cancel` (ya da daemon kapanışı) ile sonlanır. Tek-seferlik koşularda davranış
değişmez (`thinking → completed`).
**MCP yaşam döngüsü (Dilim 2.2 kararı):** konuşmalı koşunun MCP bağlantıları `awaiting_user`
turları ARASINDA açık kalır (koşu runLoop içinde park eder, kaynaklar canlı); bağlantılar yalnız
koşu sonlanınca (cancel/hata/daemon kapanışı) kapatılır.

## 6. Yeniden bağlanma

1. İstemci kopunca üstel geri çekilmeyle yeniden bağlanır (1s → 2s → 4s → maks 30s).
2. `hello` sonrası `hello.ok.snapshot` gelir: aktif koşular, sağlayıcı durumları, bekleyen izinler.
3. Olay geçmişi gerekiyorsa `state.sync` tam görüntü verir. Daemon olay saklamaz;
   kalıcı geçmiş SQLite'tadır ve REST ile sorgulanır. (Basitlik: replay YOK, snapshot VAR.)

## 7. Sürümleme

- `protocolVersion: 1`. İstemci ve daemon `hello`'da karşılaştırır; major uyuşmazlıkta
  bağlantı `AUTH_PROTOCOL_MISMATCH` ile reddedilir ve kullanıcıya "güncelle" denir.
- Şemalar zod'da `passthrough` DEĞİL `strip` modunda: bilinmeyen alan sessizce atılır
  (ileri sürümden gelen alan eskiyi kırmaz).

## 8. Örnek akış — agent dosya düzenliyor

```
CLI  → agent.start        { agentId:"coder", task:"README yaz", cwd:"C:/proj" }
D    → agent.run.started  { runId:"r1", ... }              (CLI + masaüstü aynı anda görür)
D    → agent.run.state    { runId:"r1", state:"thinking" }
D    → agent.tool.requested { runId:"r1", requestId:"p1", tool:"write_file",
                              riskClass:"mutating", diff:"--- a/README.md ..." }
D    → agent.run.state    { runId:"r1", state:"awaiting_permission" }
CLI  → permission.respond { requestId:"p1", decision:"allow" }
D    → agent.tool.started / agent.tool.completed / ...
D    → agent.run.completed { runId:"r1", usage:{...} }
```
