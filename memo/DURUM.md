# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-05 (Oturum 11 — canlı doğrulama + MCP istemcisi + eklenti sistemi TAMAM: 130/130 test yeşil)

## Eklenti sistemi (`symphony add`) — aynı oturumda MCP'nin ardından bitti

v1 kapsamı: yalnız **npm paketi** (`github-repo`/doğrudan `mcp-sunucu` kaynağı ertelendi —
build/sandbox belirsizliği ayrı bir dilim gerektirir, ROADMAP'e not düşüldü). Yeni protokol
isteği `mcp.addServer` (PROTOKOL.md §3/§4 güncellendi, önce belge sonra shared şeması):
daemon sunucuya CANLI bağlanıp `tools/list` doğrular (yanlış paket adı/bozuk komut hemen
görülür, dosyaya YAZILMAZ), başarılıysa `~/.symphony/mcp-servers.json`'a ekler (var olan
sunucuları silmeden). CLI: `symphony add <npm-paketi> [--name ad] [-- ekstra...]`.
4 yeni test (2 mcp.test.ts + 1 daemon-agent.test.ts + merge testi) gerçek stdio alt süreçle
(`agent/__fixtures__/echo-mcp-server.mjs`, network'e bağımlı değil). **Canlı kanıt:**
`symphony add @playwright/mcp` → ROADMAP'in adını verdiği ilk örnek eklenti gerçekten
çalıştı, 23 gerçek araç bulundu (`browser_click`, `browser_navigate`, ...), kayıt defterine
eklendi, alt süreç temiz kapandı (doğrulandı). `~/.symphony/mcp-servers.json`'da artık iki
sunucu var: `filesystem` (önceki test) + `playwright-mcp`.

## Şu an neredeyiz?

**MCP istemcisi bitti ve canlı kanıtlı (2026-07-05, ADR-007, SPEC-AGENT §2.1):**
`core/src/agent/mcp.ts` — `@modelcontextprotocol/sdk` (stdio taşıma), `~/.symphony/mcp-servers.json`
kayıt defteri, agent frontmatter'ında `mcpServers: [ad, ...]`, her sunucu aracı
`mcp__<sunucu>__<araç>` adıyla `AgentToolSpec`'e sarılıp `mutating` risk sınıfında bağlanıyor
(koşu başında bağlan, koşu bitince kapat — `engine.ts`). 10 yeni birim testi (`mcp.test.ts`,
gerçek `Client`+`McpServer` çifti `InMemoryTransport` ile, alt süreç yok) + 1 engine entegrasyon
testi. **Canlı doğrulama da yapıldı:** gerçek `@modelcontextprotocol/server-filesystem`
sunucusuna bağlanıp `list_directory`/`read_text_file` araçları çağrıldı; MCP aracı `mutating`
olduğu için terminaldeki e/d/h izin kutusu bu kez GERÇEKTEN tetiklendi (önceki oturumun safe-tool
testinde tetiklenmemişti); sunucunun kendi path hatası (`AGENT_MCP_TOOL_ERROR`) koşuyu kırmadan
modele döndü ve model yeniden denedi (SPEC §4 "araç hatası ≠ koşu hatası" gerçek bir MCP
sunucusuyla kanıtlandı); koşu bitince alt süreç (npx/node) temiz kapandı (doğrulandı, artık
süreç kalmadı). Kalıcı test artefaktları: `~/.symphony/mcp-servers.json` (filesystem sunucusu,
`memo/` köküne bağlı) + `~/.symphony/agents/mcp-tester.md` — silinmedi, çalışan örnek olarak
kalsın istendi.

**Model kararı (2026-07-05):** Sonnet 5 bu oturumun tamamında kaldı, Opus'a geçiş
gerekmedi (bkz. aşağıdaki "Model kararı" notu — gerekçe hâlâ geçerli: bu iş ADR-007/SPEC-AGENT'ın
uygulaması, yeni mimari karar değil).

**Faz 3 (agent motoru) ilk dikey dilim BİTTİ ve testli: 130/130 test yeşil; build+lint temiz.**
**Canlı doğrulama da geçti (2026-07-05):** `symphony agent coder "memo/DURUM.md dosyasının ilk
bölümünü oku ve tek cümleyle özetle" --provider ollama --model qwen3:8b` uçtan uca çalıştı —
daemon otomatik açıldı, coder.md tanımı yüklendi, qwen3:8b `read_file` aracını doğru çağırdı,
`safe` risk sınıfı izin sormadan otomatik onaylandı, model doğru özeti üretti, maliyet $0.0000
göründü. (Not: DEVIR.md/DURUM.md'deki örnek komut kökten `DURUM.md` diyordu ama dosya
`memo/DURUM.md`'de — önce bu yanlış yolla denendi, `AGENT_FILE_NOT_FOUND` doğru şekilde modele
döndü, sonra doğru yolla tekrarlandı. İkisi de motorun sağlıklı çalıştığını kanıtladı.)
Bu görev `safe` riskli olduğu için e/d/h izin kutusu tetiklenmedi; onun canlı kanıtı hâlâ
`engine.test.ts`/`daemon-agent.test.ts` birim testlerinde — gerçek terminalde mutating bir
görevle (örn. dosyaya yazma) ayrıca denenebilir, istenirse.

**Model kararı (2026-07-05):** Fable → Opus devri bekleniyordu ama bu oturum zaten Sonnet 5
ile açıldı. Opus'a geçişe GEREK YOK: kalan Faz 3 işleri (MCP istemcisi, eklenti sistemi, TUI
entegrasyonu) BAGLAM.md'nin kendi kuralına göre "mimari karar" değil "uygulama" işi — mimari
zaten ADR-007/SPEC-AGENT'ta karara bağlanmış. Pahalı model (Opus) için ayır: gerçek yeni bir
mimari belirsizlik çıkarsa (örn. MCP sarmalama tasarımı beklenenden karmaşık çıkarsa) veya
Faz 4 masaüstü "Living Interface" gibi tasarım ağırlıklı bir faza geçilince.

Bugün kurulanlar (`packages/core/src/agent/`):
- **Araç seti** (`tools.ts`): read_file / write_file / edit / glob / grep / run_command;
  zod arg şemaları, zaman aşımı (run 120sn, diğerleri 30sn), sır maskeleme,
  run_command temiz env (anahtar taşıyan değişkenler süzülür) + yıkıcı komut sezgiseli.
- **Workspace jail** (`jail.ts`): resolve+realpath+kök kapsama; symlink kaçışı dâhil
  PERMISSION_JAIL; extraDirs = açık onaylı ek kökler.
- **İzin motoru** (`permissions.ts`): `~/.symphony/permissions.json`; deny > allow >
  risk varsayılanı; always_allow kalıcılaştırma (destructive'de asla).
- **Agent tanımları** (`definition.ts`): `~/.symphony/agents/*.md` frontmatter
  (mini ayrıştırıcı, tam YAML değil); varsayılan `coder.md` daemon açılışında ekilir.
- **Koşu motoru** (`engine.ts`): AI SDK v7 tool-calling döngüsü; izin kapısı TEK kapı;
  durum makinesi (shared/agent-state); maxSteps; AGENT_TOOL_LOOP (3x aynı hata);
  bayat-diff (PERMISSION_STALE_DIFF); iptal (izin beklerken bile); koşu+adım SQLite'a.
- **SQLite v3**: `agent_runs` + `agent_steps`; daemon açılışında yarım koşular
  failed(AGENT_DAEMON_RESTART). Her model turu `requests` tablosuna da düşer.
- **Daemon**: agent.start/agent.cancel/permission.respond/agents.list işleyicileri;
  snapshot artık aktif koşular + bekleyen izinleri veriyor; `testProviders` (test-only).
- **Protokol eki**: `agents.list` (+`agents.list.ok`, `AgentSummary`) — PROTOKOL.md §3 ✅.
- **CLI**: `symphony agents`, `symphony agent <ad> "<görev>" [--cwd] [--model+--provider]`
  (canlı olay akışı, renkli diff, e/d/h izin sorusu, Ctrl-C iptal).
- **Provider arayüzü**: `languageModel()` + `forwardsTemperature` eklendi (4 adapter).

Kabul testleri kanıtlı (`agent/engine.test.ts`, `server/daemon-agent.test.ts`):
onaysız tek bayt yazamıyor ✅ · deny koşuyu kırmıyor ✅ · jail dışına çıkamıyor ✅.

## Sıradaki adım (buradan devam — ayrıntılı yol DEVIR.md'de)

1. **TUI agent modu:** izin kutusu + diff görünümü (`cli/src/tui/`). MCP izin istekleri de
   `agent.tool.requested` üzerinden aynı yoldan geliyor — CLI tarafı zaten hazır (`agent.ts`),
   TUI'de eşdeğeri eksik.
2. (İsteğe bağlı, küçük) `symphony add`'e `--remove <ad>` ya da `--list` eklenebilir — v1
   bilinçli olarak yalnız ekleme yapıyor, kullanıcı `mcp-servers.json`'ı elle de düzenleyebilir
   (permissions.json ile aynı felsefe).

## Bekleyenler / kullanıcıdan gerekenler

- [ ] OpenAI/Google API anahtarları (gelince: `pnpm --filter @symphony/core key:set openai`).
- [ ] Fable haftalık limiti dolunca Opus devralacak → `memo/DEVIR.md` yazıldı (2026-07-04),
      ROADMAP başına devir notu kondu.

## Geçmiş fazlar (özet — ayrıntı oturum günlüklerinde)

- **Faz 0-1** ✅: monorepo, daemon (Fastify+ws, token auth), 4 provider adapter'ı,
  SecretStore (keychain), SQLite v1 (requests+telemetry), router v1, tek-kopya kilidi.
  Canlı kanıt: Claude Opus 4.8 streaming ($0.0028) + Ollama qwen3:8b ($0).
- **Faz 2** ✅ (2026-07-03): DaemonClient, otomatik daemon başlatma, Ink TUI, global
  kurulum (`link:`), `symphony watch`, sohbet geçmişi (SQLite v2 + REST + `history`).
- **Faz 2.5** ✅: TUI karşılama ekranı + tesseract/sinaps logosu (cyan/magenta/red paleti —
  Faz 4 masaüstü de bu paleti kullanacak).

## Kalıcı teknik notlar

- Claude 4.7+/GPT-5 aileleri `temperature` KABUL ETMEZ → adapter `forwardsTemperature`
  bayrağı tek doğruluk kaynağı (ADR-008 diğerlerinde geçerli).
- AI SDK v7: system mesajı `messages`'ta yasak → `instructions`; geçersiz araç çağrısı
  `invalid: true` gelir (fırlatmaz). Ayrıntı ve diğer tuzaklar: `memo/DEVIR.md`.
- Kurulu: Node 24.14.1, pnpm 11.9.0, TS 6.0.3, ESLint 10, Vitest 4, zod 3, AI SDK 7.
