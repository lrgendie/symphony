# 🤖 SPEC-AGENT.md — Agent Motoru ve İzin Sistemi Şartnamesi (v1)

> Faz 3'ün yol gösterici belgesi. Buradaki davranışlar müzakere edilemez;
> uygulama detayı serbesttir. Protokol mesajları için bkz. `docs/PROTOKOL.md`.

## 1. Agent tanımı

`~/.symphony/agents/<ad>.md` — frontmatter + serbest metin:

```markdown
---
name: coder
description: Kod yazan/düzenleyen genel agent
model: claude-sonnet-5        # boşsa router seçer
provider: anthropic           # boşsa router seçer
temperature: 0                # varsayılan zaten 0; yükseltmek bilinçli istisnadır
tools: [read_file, write_file, edit, glob, grep, run_command]
mcpServers: [filesystem]      # boşsa MCP aracı yok; bkz. §2.1
maxSteps: 50                  # döngü sigortası
---
Sen Symphony'nin kod agent'ısın. <sistem prompt'u buraya>
```

## 2. Araç seti ve risk sınıfları

| Araç | Risk sınıfı | İzin varsayılanı |
|---|---|---|
| `read_file`, `glob`, `grep` | `safe` | otomatik izinli |
| `write_file`, `edit` | `mutating` | **sor** (diff ile) |
| `run_command` | `mutating` | **sor** (komut metniyle) |
| dosya silme, `git push`, ağ yazması içeren komutlar | `destructive` | **sor** — `always_allow` ile kalıcılaştırılamaz |

- Her aracın parametreleri zod ile doğrulanır; doğrulamadan geçmeyen çağrı modele
  `VALIDATION_TOOL_ARGS` hatası olarak geri döner (çalıştırılmaz).
- MCP araçları `mutating` sınıfında başlar; kullanıcı `permissions.json`'da araca özel
  indirim yapabilir (bkz. §2.1).

### 2.1 MCP istemcisi (ADR-007) — uygulandı 2026-07-05

- Kayıt defteri `~/.symphony/mcp-servers.json` (yalnız `permission.respond` akışının
  `permissions.json`'a yazması gibi, bu dosyayı da agent DEĞİL kullanıcı/`symphony add`
  günceller):
  ```jsonc
  {
    "servers": {
      "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
    }
  }
  ```
- Taşıma: yalnız **stdio** (v1 kapsamı — SSE/HTTP taşıma sonraki bir dilimde ele alınır).
- Agent frontmatter'ındaki `mcpServers: [ad, ...]` hangi sunuculara bağlanacağını seçer;
  boşsa (varsayılan) hiç MCP bağlantısı açılmaz.
- Yaşam döngüsü: koşu (`agent.start`) başında listelenen her sunucuya bağlanılır ve
  `tools/list` çağrılır; koşu bitince (completed/failed/cancelled fark etmez) tümü kapatılır.
  Sunucular arası paylaşım YOK — her koşu kendi bağlantısını açar (v1 basitliği; havuzlama
  sonraki bir dilimde değerlendirilebilir).
- Araç adlandırma: `mcp__<sunucu>__<araç>` (çakışma önleyici namespace). İzin denetimi,
  diğer araçlarla birebir aynı tek kapıdan (`engine.ts` izin kontrolü) geçer; `permissionTarget`
  çağrı argümanlarının kısaltılmış JSON'udur (dosya araçlarındaki gibi tek bir `path` alanı
  varsayılamaz).
- Hata kodları: `AGENT_MCP_SERVER_UNKNOWN` (frontmatter'daki ad kayıt defterinde yok),
  `AGENT_MCP_CONNECT_FAILED` (süreç başlatılamadı/handshake başarısız), `AGENT_MCP_TOOL_ERROR`
  (sunucu `isError: true` döndü — araç hatası, koşu hatası DEĞİL, SPEC §4 ilkesi burada da geçerli).

## 3. Çalışma alanı hapsi (workspace jail)

- Agent, `agent.start`'taki `cwd` ağacının **dışına dokunamaz**: her path
  `path.resolve` + prefix kontrolünden geçer; symlink'ler gerçek hedefine çözülür.
- Kaçış girişimi (`../`, mutlak path, symlink) aracı çalıştırmaz, `PERMISSION_JAIL` hatası
  modele döner ve olay loglanır.
- İstisna: kullanıcı `agent.start`'ta ek dizin verebilir (`extraDirs`), her biri açık onay ister.

## 4. Döngü (tek koşunun ömrü)

```
1. Sistem prompt'u + agent tanımı + görev → model
2. Model cevabı:
   a) araç çağrısı yoksa → sonuç = cevap → completed
   b) araç çağrıları varsa → her biri için sırayla:
      - args doğrula → risk sınıfını belirle
      - izin denetimi (bkz. §5) → gerekiyorsa awaiting_permission'da BLOKLA
      - çalıştır (timeout: run_command 120sn, diğerleri 30sn)
      - sonucu (veya hatayı) tool result olarak konuşmaya ekle
3. Adım sayacı++ → maxSteps aşıldıysa failed(AGENT_MAX_STEPS) → değilse 1'e dön
```

- **Araç hatası ≠ koşu hatası.** Hata modele döner; model 3 kez üst üste aynı araçta aynı
  hatayı alırsa koşu `failed(AGENT_TOOL_LOOP)` ile kapanır.
- İptal (`agent.cancel`): koşan araç varsa süreç öldürülür (`SIGTERM`→5sn→`SIGKILL`),
  durum `cancelled`, o ana dek yapılan dosya değişiklikleri GERİ ALINMAZ (bkz. §7 kayıt).
- Daemon yeniden başlarsa: yarım koşular `failed(AGENT_DAEMON_RESTART)` işaretlenir;
  otomatik devam YOK (v1 kararı — sürpriz eylem istemiyoruz).

## 5. İzin denetimi

Kural dosyası `~/.symphony/permissions.json`:

```jsonc
{
  "rules": [
    { "tool": "run_command", "pattern": "pnpm test*", "decision": "allow" },
    { "tool": "write_file",  "pattern": "**/*.md",    "decision": "allow" },
    { "tool": "run_command", "pattern": "rm *",        "decision": "deny"  }
  ]
}
```

Karar sırası: **deny kuralı > allow kuralı > koşu-içi güven (bkz. altta) > risk sınıfı varsayılanı**.

- Kurala uymayan `mutating/destructive` çağrı → `agent.tool.requested` olayı yayınlanır,
  koşu `awaiting_permission`'a geçer, **süresiz beklenir** (insan kararı zaman aşımına uğramaz).
- `permission.respond`:
  - `allow` → yalnız bu çağrı çalışır.
  - `always_allow` → çalışır + eşleşen kural `permissions.json`'a **kalıcı** yazılır
    (`destructive` sınıfında bu seçenek sunulmaz).
  - `allow_for_run` (2026-07-05 eklendi) → çalışır + o ARACIN adı bu koşunun bellek-içi
    güven kümesine eklenir: aynı koşuda aynı araca yapılan SONRAKİ çağrılar (riski
    `destructive` OLMADIĞI sürece) tekrar sormadan otomatik izinli sayılır. Diske
    YAZILMAZ, koşu bitince (completed/failed/cancelled fark etmez) kaybolur — bir
    sonraki koşu yine sıfırdan sorar. Amaç: tek bir denetlenen görev içinde (ör. "masaüstümü
    düzenle" → birden çok farklı `Move-Item` çağrısı) her çağrıda yeniden onay istememek,
    `always_allow`'un KALICI genişletmesinden farklı olarak. `destructive` sınıfında
    bu seçenek de sunulmaz — araç adı koşu-içi güvenilir olsa bile o anki çağrı
    `destructive` ise yine sorulur (ör. aynı koşuda önce zararsız bir `run_command`
    `allow_for_run` ile onaylanmış olsa bile sonraki bir `rm -rf` çağrısı yine sorar).
  - `deny` → araç çalışmaz; modele "kullanıcı reddetti" tool-hatası döner (model rota değiştirebilir).
- Aynı anda birden çok istemci bağlıysa ilk gelen cevap geçerlidir; diğerlerine
  `permission.resolved` bilgisi düşer (çifte onay çakışması olmaz).

## 6. Diff önizleme

- `write_file`/`edit` izin isteği **her zaman** birleşik diff içerir (`agent.tool.requested.diff`).
- Diff, isteğin yapıldığı andaki disk durumuna göre hesaplanır; onay anında dosya değiştiyse
  (mtime/hash farkı) çağrı `PERMISSION_STALE_DIFF` ile düşer ve yeni diff'le tekrar sorulur.

## 7. Kayıt ve telemetri (kendini geliştirmenin hammaddesi)

Her koşu SQLite'a yazılır: koşu meta (agent, model, görev, süre, sonuç, token, maliyet) +
her adım (araç, args özeti, süre, hata). Ham dosya içerikleri DEĞİL, özet ve hash saklanır.
`memo/` ve `~/.symphony/memory/` bu kayıtlardan beslenir; Doktor agent (Faz 8) bu tabloyu okur.

## 8. Güvenlik değişmezleri

1. İzin akışını atlayan hiçbir kod yolu olamaz — araç çalıştırmanın TEK kapısı izin denetimidir.
2. Agent, `~/.symphony/` altına (kendi yapılandırmasına) yazamaz — `permissions.json`'ı
   agent değil, yalnız `permission.respond` akışı günceller.
3. Agent çıktıları loglanırken API anahtarı deseni (`sk-`, `AIza` vb.) maskelenir.
4. `run_command` ortam değişkenlerinden anahtar içerenleri temizlenmiş bir env ile çalışır.
