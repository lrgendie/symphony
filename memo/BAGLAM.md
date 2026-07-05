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
| Daemon davranışı | `core/src/server/daemon.ts` (tek dosya, ~600 satır) |
| Mimari karar değişikliği | `docs/kararlar/KARARLAR.md` (önce ADR oku!) |
| Model devri (Fable→Opus vb.) | `memo/DEVIR.md` — rol, disiplin, tuzak haritası |

## Paket grafiği

`shared` → `core` → (`cli`, `ui`, `desktop`) — tek yönlü; `shared` hiçbir şeye bağımlı değil.
`ui` ve `desktop` henüz boş iskelet (Faz 4).

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
- `server/daemon.ts` — Fastify+ws sunucu; TÜM istek işleyicileri buradaki switch'te
- `server/bus.ts` — EventBus: olaylar bağlı TÜM istemcilere yayınlanır (ADR-001)
- `server/token.ts` — daemon token üretimi/yazımı (dinleme başarılı olmadan yazılmaz)
- `providers/types.ts` — `ProviderAdapter` arayüzü (streamChat + languageModel)
- `providers/{anthropic,openai,google,ollama}.ts` — 4 adapter; temperature iletimi
  adapter'a özgü (Claude 4.7+/GPT-5 KABUL ETMEZ → iletilmez; Gemini/Ollama iletilir)
- `providers/pricing.ts` — USD/1M token tablosu; bilinmeyen model = 0 (yerel)
- `router/router.ts` — kural tabanlı model önerisi v1 (`router.suggest`)
- `router/hardware.ts` — nvidia-smi'den VRAM tespiti
- `db/store.ts` — SQLite (better-sqlite3, WAL); göçler `MIGRATIONS` dizisinde
  (v1 requests+telemetry, v2 sessions+messages, v3 agent_runs+agent_steps)
- `secrets/secret-store.ts` — OS keychain + env yedek; anahtar DİSKE YAZILMAZ
- `config/paths.ts` — `~/.symphony` yol haritası (SYMPHONY_HOME ile taşınır)
- `config/config.ts` — config.json yükleme
- `agent/` — Faz 3 agent motoru (SPEC-AGENT.md'nin uygulaması):
  - `errors.ts` — `AgentError` (error.name = protokol hata kodu)
  - `jail.ts` — `WorkspaceJail`: path.resolve+realpath+kök kapsama; kaçış = PERMISSION_JAIL
  - `permissions.ts` — `PermissionEngine`: deny > allow > risk varsayılanı; always_allow kalıcılaştırma
  - `definition.ts` — `~/.symphony/agents/*.md` frontmatter ayrıştırma + varsayılan coder
  - `tools.ts` — 6 araç (read_file/write_file/edit/glob/grep/run_command) + diff/hash + maskeleme
  - `mcp.ts` — MCP istemcisi (ADR-007): `~/.symphony/mcp-servers.json` kayıt defteri
    (stdio), sunucu araçlarını `AgentToolSpec`'e sarar (`mcp__<sunucu>__<araç>`, hep `mutating`)
  - `engine.ts` — koşu döngüsü (AI SDK tool-calling), izin kapısı, durum makinesi, iptal,
    MCP bağlan/kapat (koşu ömrüyle eşleşir)

### packages/cli/src — symphony komutu
- `index.ts` — commander kayıtları; argümansız → TUI
- `client/daemon-client.ts` — WS istemcisi + otomatik daemon başlatma (`connectToDaemon`)
- `commands/` — status/models/watch/history/agents/agent (her komut tek dosya)
- `tui/` — Ink: app.tsx (akış), welcome.tsx (karşılama), model-picker, chat, logo.ts

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
