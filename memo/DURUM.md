# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-05 (Oturum 11 — Faz 3 kapandı + gerçek kullanıcı testiyle 2 hata
bulunup düzeltildi + izin sistemine 3. kademe eklendi: 150/150 test yeşil)

## 🎉 Faz 3 kapandı — kullanıcının tek küçük adımı hariç

ROADMAP'teki Faz 3 maddelerinin HEPSİ işaretli: araç seti, agent döngüsü, izin sistemi, diff
önizleme (2026-07-04) → MCP istemcisi (ADR-007), eklenti sistemi (`symphony add`), TUI agent
modu (2026-07-05, bu oturum). MCP + eklenti sistemi gerçek dış sunucularla
(`@modelcontextprotocol/server-filesystem`, `@playwright/mcp`) canlı kanıtlandı. Tam teknik
ayrıntı: `memo/oturumlar/2026-07-05.md`.

## Gerçek kullanıcı testinden çıkan 2 bulgu (bu oturumda düzeltildi)

Kullanıcının asıl hedefi ajanların GERÇEK dosya sistemini yönetmesi (masaüstü düzenleme,
klasör taşıma) — bu zaten mümkündü (`--cwd`/jail neresi verilirse orayı sınırlar), sadece iki
gerçek sorun çıkardı:

1. **`Format-Table` yanlış pozitifi:** `isDestructiveCommand`'daki `\b(format|mkfs)\b` deseni,
   PowerShell'in zararsız `Format-Table`/`Format-List` gibi listeleme cmdlet'lerini disk
   biçimlendirmeyle karıştırıp `destructive` sınıflıyordu. Düzeltme: `(?!-)` negatif ileri
   bakış eklendi (`tools.ts`); regresyon testi var.
2. **TUI cwd/model'i sessizce varsayıyordu:** kullanıcı `symphony`'yi ev dizininden başlatınca
   (Desktop'tan değil) agent `.gradle`/`.android`/`.cache` gibi onlarca alakasız klasörde
   kayboldu; model de görünmeden ücretsiz yerel qwen3:8b'ye düşüyordu. Düzeltme: `agent-run.tsx`
   artık görev girişinden önce çalışma dizini + model soruyor (`app.tsx`, `AgentModelPicker`).

Bu süreçte kullanıcının asıl hedefine uygun yeni bir agent de eklendi:
**`~/.symphony/agents/duzenleyici.md`** (dosya/klasör organizasyonu; write_file/edit YOK,
yalnız read_file/glob/grep/run_command — dosya içeriğini değil düzenini değiştiriyor).
Gerçek masaüstünde (Claude Sonnet 5 ile) denendi, 10 klasör + 11 dosyayı inceleyip tutarlı
bir gruplama önerisi üretti, hiçbir şeyi taşımadan önce onay istedi.

## Yeni: izin sisteminde 3. kademe — `allow_for_run` (2026-07-05)

Kullanıcının gözlemi: tekrarlayan görevlerde (ör. birden çok `Move-Item`) her farklı dosya
için ayrı ayrı onay istemek yorucu; `always_allow` da işe yaramıyor çünkü tam komut metnini
(dosya adı dahil) kalıcı kural olarak yazıyor, farklı dosyaya genellemiyor.

Eklenen: `permission.respond`'a **`allow_for_run`** — bu çağrıyı çalıştırır + o ARACIN adını
**yalnız bu koşu için** (bellek-içi, diske YAZILMAZ) güvenilir sayar; aynı koşuda aynı araca
yapılan sonraki çağrılar (riski `destructive` OLMADIĞI sürece) tekrar sormaz. Koşu bitince
kaybolur, sonraki koşu sıfırdan sorar. `destructive` risk sınıfında (`always_allow` gibi) hiç
sunulmaz/uygulanmaz — aynı araç önceden `allow_for_run` almış olsa bile.
Protokol: `docs/PROTOKOL.md` + `docs/SPEC-AGENT.md` §5 önce güncellendi, sonra shared şeması
(`requests.ts`/`events.ts`), sonra `engine.ts` (`ActiveRunRecord.trustedForRun: Set<string>`),
sonra CLI (`agent.ts`, tuş: `b`) + TUI (`agent-run.tsx`). Testler: `engine.test.ts` (farklı
hedeflerle aynı araç sormuyor + kalıcı kural yazılmıyor + destructive yine soruyor),
`agent-run.test.tsx` ('b' tuşu). 150/150 test yeşil.

## Not düşüldü, henüz YAPILMADI: kullanıcı hafızası kapsam kararı (Faz 6)

Kullanıcı sordu: "masaüstüm" dediğimde model bunun `C:\...\Desktop` olduğunu neden bilmiyor —
ben (Claude Code) neden biliyorum? Cevap: benim kalıcı hafıza dosya sistemim var, Symphony'de
henüz yok (ROADMAP Faz 6 "Kullanıcı hafızası" — `~/.symphony/memory/`). **Kapsam kararı
kayda geçirildi (ROADMAP.md, Faz 6 satırı):** bu dosyayı yalnız kullanıcı/asistan yazacak,
**agent'lar kendi başına YAZAMAYACAK** (yalnız okur) — kendi güvenini kendi genişletmesi
riskli. Kullanıcının açık talebi: **şimdi yapma, Faz 6'da yap** — bu oturumda sadece not
düşüldü, kod YOK.

## Sıradaki adım

1. **Kullanıcıdan — TUI canlı doğrulama (3. deneme):** Bu oturumda TUI'ye üç şey eklendi
   (cwd sorma, model sorma, `allow_for_run`/'b' tuşu) — hiçbirini ben gerçek terminalde
   deneyemedim (Ink `useInput` raw-mode TTY ister, bu oturumun Bash+winpty araçları gerçek
   konsol veremedi — DURUM.md'nin önceki sürümünde ayrıntılı not var, tekrarı gereksiz).
   Testler (12 agent-run testi) mantığı kanıtlıyor. Kullanıcı isterse bir dahaki oturumda
   dener.
2. **Faz 4 (masaüstü/Tauri)** — ROADMAP'te bir sonraki büyük faz. Faz 3'ten farklı: burada
   ADR'siz, tasarım ağırlıklı yeni yüzeyler var (Living Interface, Tauri↔daemon
   entegrasyonu). Başlamadan önce kullanıcıyla hizalanmalı: Rust toolchain kurulu mu, hangi
   modelle (bu noktada Opus'a geçiş mantıklı olabilir — tasarım işi, ADR yok).

## Bekleyenler / kullanıcıdan gerekenler

- [ ] TUI agent modu canlı doğrulaması (yukarıda — Faz 3'ü tamamen kapatan son adım).
- [ ] OpenAI/Google API anahtarları (gelince: `pnpm --filter @symphony/core key:set openai`).
- [ ] Faz 4 öncesi: Rust toolchain (rustup+MSVC) kurulumu.
- [ ] `duzenleyici` agent'ının masaüstü gruplama önerisini onaylarsa: gerçek taşıma işlemi.

## Geçmiş fazlar (özet — ayrıntı oturum günlüklerinde)

- **Faz 0-1** ✅: monorepo, daemon (Fastify+ws, token auth), 4 provider adapter'ı,
  SecretStore (keychain), SQLite v1 (requests+telemetry), router v1, tek-kopya kilidi.
- **Faz 2** ✅ (2026-07-03): DaemonClient, otomatik daemon başlatma, Ink TUI, global
  kurulum (`link:`), `symphony watch`, sohbet geçmişi (SQLite v2 + REST + `history`).
- **Faz 2.5** ✅: TUI karşılama ekranı + tesseract/sinaps logosu.
- **Faz 3** ✅ 2026-07-05: araç seti + jail + izin motoru + koşu motoru (2026-07-04) →
  MCP istemcisi + eklenti sistemi + TUI agent modu + `allow_for_run` (2026-07-05).

## Kalıcı teknik notlar

- Claude 4.7+/GPT-5 aileleri `temperature` KABUL ETMEZ → adapter `forwardsTemperature`
  bayrağı tek doğruluk kaynağı (ADR-008 diğerlerinde geçerli).
- AI SDK v7: system mesajı `messages`'ta yasak → `instructions`; geçersiz araç çağrısı
  `invalid: true` gelir (fırlatmaz). MCP araçları `jsonSchema()` sarmalı ile aynı `tool()`
  arayüzüne uyuyor (`AgentToolSpec.inputSchema: FlexibleSchema<unknown>`).
- MCP istemcisi (`core/src/agent/mcp.ts`): stdio-only v1; araçlar `mcp__<sunucu>__<araç>`
  adıyla hep `mutating`; koşu başında bağlan/bitince kapat. Kayıt defteri
  `~/.symphony/mcp-servers.json`; `symphony add <npm-paketi>` CANLI doğrulayıp yazar.
  Test fixture: `core/src/agent/__fixtures__/echo-mcp-server.mjs` (network'süz, CI-güvenli).
- İzin kararları artık 4 kademeli: `allow` (bir kez) / `allow_for_run` (bu koşu boyunca,
  bellek-içi) / `always_allow` (kalıcı, `permissions.json`) / `deny`. Son ikisi
  `destructive`'de hiç sunulmaz.
- `run_command` yıkıcı-komut sezgiseli `\b(format|mkfs)\b(?!-)` — PowerShell'in Format-*
  cmdlet'lerini artık yanlış pozitif işaretlemiyor.
- Ink `useInput` raw-mode TTY ister; Bash aracından (ve winpty'den) otomatik sürülemez —
  TUI'nin canlı doğrulaması hep kullanıcıdan istenir.
- Kurulu: Node 24.14.1, pnpm 11.9.0, TS 6.0.3, ESLint 10, Vitest 4, zod 3, AI SDK 7,
  @modelcontextprotocol/sdk 1.29.0.
