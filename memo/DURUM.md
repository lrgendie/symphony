# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-04 (Oturum 10 — Faz 3 dilim 1 TAMAM)

## Şu an neredeyiz?

**Faz 3 (agent motoru) ilk dikey dilim BİTTİ ve testli: 115/115 test yeşil; build+lint temiz.**

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

1. **Canlı doğrulama:** terminalde
   `symphony agent coder "DURUM.md'nin ilk bölümünü oku ve tek cümleyle özetle" --provider ollama --model qwen3:8b`
   → izin akışını gerçek modelle bir kez yaşat (`pnpm build` sonrası global symlink güncel).
2. **MCP istemcisi** (ADR-007, SPEC-AGENT §2): `@modelcontextprotocol/sdk`;
   MCP araçları `AgentToolSpec`'e sarılır, riskClass `mutating` başlar.
3. **Eklenti sistemi:** `symphony add <kaynak>`; ilk örnek Playwright scraping MCP'si.
4. **TUI agent modu:** izin kutusu + diff görünümü (`cli/src/tui/`).

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
