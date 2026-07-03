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

Kalıcı geçmiş SQLite'tadır ve YALNIZ REST ile sorgulanır (§6: olay replay'i yok).
Cevap şemaları `shared`'dadır: `HistorySessionSummarySchema`, `HistoryMessageSchema`,
`HistorySessionsResponseSchema`, `HistorySessionDetailResponseSchema`.

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
| `agent.start` | `{ agentId, task, cwd, model?, provider? }` | Agent görevi başlat (agentId = `~/.symphony/agents/` tanımı) |
| `agent.cancel` | `{ runId }` | Koşan agent'ı iptal et |
| `permission.respond` | `{ requestId, decision: "allow"\|"deny"\|"always_allow" }` | Bekleyen izin isteğine cevap |
| `models.list` | `{}` | Tüm sağlayıcıların kullanılabilir modelleri |
| `providers.status` | `{}` | Sağlayıcı sağlık durumları |
| `router.suggest` | `{ task, constraints?: { maxCostUsd?, preferLocal? } }` | "Bu iş için hangi model?" önerisi |
| `usage.query` | `{ from?, to?, groupBy? }` | Token/maliyet raporu |

**Sohbet oturumu ve geçmiş:** `chat.start.sessionId` verilmezse daemon her istek için yeni
oturum üretir. Çok turlu bir sohbeti TEK oturum olarak kaydettirmek isteyen istemci, ürettiği
`sessionId`'yi turlar boyunca sabit tutar ve her turda TAM mesaj geçmişini gönderir. Daemon,
başarıyla biten her turda oturumun mesajlarını bu tam geçmiş + asistan cevabıyla DEĞİŞTİRİR
(replace — idempotent). Başlık ilk kullanıcı mesajından türetilir. İptal/hata turu geçmişi değiştirmez.

## 4. Daemon → İstemci (olaylar)

Olaylar `replyTo` taşımaz; abone olan **tüm** istemcilere yayınlanır (terminal ⇄ masaüstü
eş zamanlılığının kaynağı budur).

| type | payload | Açıklama |
|---|---|---|
| `chat.delta` | `{ sessionId, text }` | Streaming metin parçası |
| `chat.completed` | `{ sessionId, usage: { inputTokens, outputTokens, costUsd } }` | |
| `agent.run.started` | `{ runId, agentId, task, model, cwd }` | |
| `agent.run.state` | `{ runId, state }` | Durum makinesi geçişi (bkz. §5) |
| `agent.step.thinking` | `{ runId, summary? }` | Model düşünüyor |
| `agent.tool.requested` | `{ runId, requestId, tool, args, riskClass, diff? }` | İzin gerekiyorsa; `diff` dosya değişikliklerinde zorunlu |
| `agent.tool.started` | `{ runId, tool, argsSummary }` | |
| `agent.tool.completed` | `{ runId, tool, ok, resultSummary, durationMs }` | |
| `agent.run.completed` | `{ runId, result, usage }` | |
| `agent.run.failed` | `{ runId, error }` | |
| `provider.health` | `{ provider, status: "up"\|"down"\|"degraded", latencyMs? }` | Periyodik + değişimde |
| `usage.updated` | `{ provider, model, deltaTokens, deltaCostUsd, totals }` | Sayaç artışı |
| `log.entry` | `{ level, source, message, runId? }` | Canlı log akışı (UI log paneli) |

## 5. Agent durum makinesi

```
queued → thinking → executing_tool → thinking → ... → completed
              ↘ awaiting_permission ↗                ↘ failed
   (her durumdan) → cancelled
```

Geçerli geçişler yalnız bunlardır; `agent.run.state` başka değer taşıyamaz.
`awaiting_permission` süresiz bekler (timeout yok — insan kararı beklenir); iptal edilebilir.

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
