# 🧭 DURUM — Kaldığımız Yer

> Her oturuma bu dosya + `memo/BAGLAM.md` ile başla. Devralan modelsen ÖNCE `memo/DEVIR.md`.
> Oturum sonunda bu dosyayı güncelle; biten fazın ayrıntısı oturum günlüğüne taşınır.

**Son güncelleme:** 2026-07-05 (Oturum 11 — Faz 3 kapandı: 142/142 test yeşil)

## 🎉 Faz 3 kapandı — kullanıcının tek küçük adımı hariç

ROADMAP'teki Faz 3 maddelerinin HEPSİ işaretli: araç seti, agent döngüsü, izin sistemi,
diff önizleme, **MCP istemcisi** (ADR-007), **eklenti sistemi** (`symphony add`), **TUI agent
modu**. Üçü de bu oturumda bitti ve testli (142/142); MCP + eklenti sistemi ayrıca gerçek
dış sunucularla (`@modelcontextprotocol/server-filesystem`, `@playwright/mcp`) canlı kanıtlandı.
Ayrıntı: `memo/oturumlar/2026-07-05.md`.

**Tek eksik — kullanıcıdan isteniyor:** TUI agent modunun gerçek terminalde tek seferlik
insan doğrulaması. Ink'in klavye yakalaması (`useInput`) raw-mode TTY ister; bu oturumun
araçları (Bash + denenen winpty) gerçek konsol sağlayamadı — yapısal bir sınır, Faz 2'nin
sohbet TUI'sinde de aynı adım kullanıcı tarafından yapılmıştı. **Yapılacak:** `symphony` yaz →
"Agent" seç → `mcp-tester` agent'ını + "memo klasöründeki dosyaları listele" gibi bir görev
seç → izin kutusunun çıkıp `e`/`h` tuşuna Enter'sız anında tepki verdiğini gözle.

## Sıradaki adım: Faz 4 (masaüstü/Tauri) — büyük yeni faz, önce kullanıcıyla hizalanmalı

Faz 4 önceki fazlardan farklı: Tauri 2 + React + Three.js ile sıfırdan bir masaüstü kabuğu,
"Living Interface" parçacık küresi gibi tasarım ağırlıklı, ADR'siz yeni yüzeyler içeriyor
(ROADMAP §Faz 4). Faz 3'ün aksine "zaten kararlaştırılmış spec'i uygula" değil — bu genuinely
tasarım işi. **Model kararı burada değişir:** Faz 4'e girerken (özellikle Three.js sahne
tasarımı, Tauri↔daemon WS entegrasyon mimarisi gibi ADR'siz kararlarda) Opus'a geçiş
mantıklı olur; mekanik uygulama parçaları (örn. Tauri iskelet kurulumu, mevcut protokolü
dashboard'a bağlama) yine mevcut modelle sürebilir.
Başlamadan önce kullanıcıyla netleşecekler: Rust toolchain kurulu mu (GEREKSINIMLER.md'de
"Faz 4'te kurulacak" işaretli), Windows'ta Tauri derlemesi denenmiş mi.

## Yeni: `duzenleyici` agent'ı + gerçek dünya bulgusu (2026-07-05, Faz 3 sonrası)

Kullanıcının asıl hedefi ajanların GERÇEK dosya sistemini (masaüstü, klasör taşıma) yönetmesi —
bu zaten mümkündü (`--cwd` jail'i neresi verilirse orayı sınırlar, proje klasörüne özel bir
kısıtlama yok), yalnız kullanıcı bunu bilmiyordu. Çözüm: `~/.symphony/agents/duzenleyici.md`
eklendi (tools: read_file/glob/grep/run_command — write_file/edit yok, dosya İÇERİĞİ değil
düzenini değiştiriyor; sistem promptu: önce incele, riskli işlemden önce özetle, silme
komutu çalıştırma).

Gerçek masaüstünde (`--cwd "C:\Users\...\Desktop"`, Claude Sonnet 5) canlı denendi — ve bir
**gerçek hata bulundu:** `Get-ChildItem | Format-Table` gibi zararsız, salt-okunur PowerShell
komutları `isDestructiveCommand`'daki `\b(format|mkfs)\b` deseni yüzünden YANLIŞ POZİTİF
olarak `destructive` sınıflanıyordu ("Format-Table" içindeki "Format" kelimesini disk
biçimlendirmeyle karıştırıyordu). Düzeltme: `\b(format|mkfs)\b(?!-)` (PowerShell'in tire ile
devam eden Format-* cmdlet'lerini hariç tutar, gerçek `format C:`/`mkfs.ext4` hâlâ yakalanır).
Regresyon testi eklendi (`tools.test.ts`). 143/143 test yeşil. Düzeltmeden sonra agent gerçek
masaüstünü inceleyip (10 klasör, 11 dosya) tutarlı bir gruplama önerisi üretti, hiçbir şeyi
taşımadan önce onay istedi — SPEC §4 "önce özetle" kuralına birebir uydu.

**Ayrı gözlem (düzeltilmedi, bilgi amaçlı):** `symphony agent` komutunu ben (Claude Code)
piped/sabit stdin ile (`printf "e\n" | ...`) test ederken readline zamanlaması yüzünden
`ERR_USE_AFTER_CLOSE` ile izin cevabı gönderilemedi — ama TOOL YİNE DE ÇALIŞMADI (izin
kapısı beklemede kaldı, hiçbir şey yürütülmedi). `yes "e" | ...` deseni sorunsuz çalıştı.
Gerçek bir terminalde (kullanıcı gerçekten yazarken) stdin hiç EOF'a düşmediği için bu
senaryo oluşmaz — CLI'ye dokunmaya gerek yok.

## TUI agent modu düzeltmesi: cwd + model artık sessizce varsayılmıyor (2026-07-05)

Kullanıcı gerçek terminalde TUI'yi denedi: ev dizininden (`C:\Users\brkn2`, Desktop'tan değil)
başlattı, model router'a bırakıldı (qwen3:8b, ücretsiz yerel model) → agent ev dizinindeki
`.gradle`/`.android`/`.cache` gibi onlarca alakasız geliştirme klasörünü gezip konudan koptu,
alakasız bir "Android Gradle" cevabı üretti. İki kök neden: (1) TUI `cwd`'yi hep "neredeysen
orası" alıyordu, sormuyordu; (2) TUI model seçtirmiyordu, sessizce router'a (küçük yerel
modele) bırakıyordu — kullanıcı hangi modelin çalıştığını bilmiyordu.

Düzeltme: `agent-run.tsx`'e görev girişinden ÖNCE iki adım eklendi — (1) çalışma dizini
(metin girişi, varsayılan: bulunduğun dizin, değiştirilebilir), (2) model seçici (yeni
`AgentModelPicker`, "Router seçsin (önerilen)" ilk seçenek + tüm modeller). `app.tsx` artık
`models` prop'unu `AgentRun`'a da geçiyor. 4 yeni test (cwd varsayılanı, belirli model seçimi
→ request'e provider/model eklenir, router seçimi → eklenmez) — toplam 147/147 yeşil.

**Yine dürüst not:** Bu düzeltmeyi de gerçek terminalde bizzat deneyemedim (aynı raw-mode TTY
sınırı). 11 agent-run testi mantığı kanıtlıyor; kullanıcının bir kez daha denemesi gerekiyor —
bu sefer masaüstü dizinini AÇIKÇA girip (varsayılanı değiştirerek) güçlü bir model seçerek.

## Bekleyenler / kullanıcıdan gerekenler

- [ ] **TUI agent modu canlı doğrulaması** (yukarıda — Faz 3'ü tamamen kapatan son adım).
      Bu sefer: çalışma dizini adımında Desktop yolunu YAZ, model adımında Claude seç.
- [ ] OpenAI/Google API anahtarları (gelince: `pnpm --filter @symphony/core key:set openai`).
- [ ] Faz 4 öncesi: Rust toolchain (rustup+MSVC) kurulumu.
- [ ] `duzenleyici` agent'ının masaüstü önerisini kullanıcı onaylarsa: gerçek taşıma işlemi
      (bir sonraki oturumda ya da bu oturumda kullanıcı isterse).

## Geçmiş fazlar (özet — ayrıntı oturum günlüklerinde)

- **Faz 0-1** ✅: monorepo, daemon (Fastify+ws, token auth), 4 provider adapter'ı,
  SecretStore (keychain), SQLite v1 (requests+telemetry), router v1, tek-kopya kilidi.
  Canlı kanıt: Claude Opus 4.8 streaming ($0.0028) + Ollama qwen3:8b ($0).
- **Faz 2** ✅ (2026-07-03): DaemonClient, otomatik daemon başlatma, Ink TUI, global
  kurulum (`link:`), `symphony watch`, sohbet geçmişi (SQLite v2 + REST + `history`).
- **Faz 2.5** ✅: TUI karşılama ekranı + tesseract/sinaps logosu (cyan/magenta/red paleti —
  Faz 4 masaüstü de bu paleti kullanacak).
- **Faz 3** ✅ 2026-07-05: araç seti + jail + izin motoru + koşu motoru (2026-07-04) →
  canlı doğrulama + MCP istemcisi (ADR-007) + eklenti sistemi (`symphony add`) + TUI agent
  modu (2026-07-05, bu oturum). Teknik özet aşağıda; tam ayrıntı oturum günlüklerinde.

## Kalıcı teknik notlar

- Claude 4.7+/GPT-5 aileleri `temperature` KABUL ETMEZ → adapter `forwardsTemperature`
  bayrağı tek doğruluk kaynağı (ADR-008 diğerlerinde geçerli).
- AI SDK v7: system mesajı `messages`'ta yasak → `instructions`; geçersiz araç çağrısı
  `invalid: true` gelir (fırlatmaz). MCP araçları `jsonSchema()` sarmalı ile aynı `tool()`
  arayüzüne uyuyor (`AgentToolSpec.inputSchema: FlexibleSchema<unknown>`).
  Ayrıntı ve diğer tuzaklar: `memo/DEVIR.md`.
- MCP istemcisi (`core/src/agent/mcp.ts`): stdio-only v1; araçlar `mcp__<sunucu>__<araç>`
  adıyla hep `mutating` risk sınıfında; koşu başında bağlan/koşu bitince kapat (engine.ts).
  Kayıt defteri `~/.symphony/mcp-servers.json`; `symphony add <npm-paketi>` CANLI doğrulayıp
  yazar (yanlış paket adı hemen görülür, dosyaya yazılmaz).
  Test için gerçek stdio fixture: `core/src/agent/__fixtures__/echo-mcp-server.mjs`
  (network'e bağımlı değil, CI-güvenli) — npx tabanlı canlı testler network ister.
  Ink `useInput` raw-mode TTY ister; Bash aracından (ve winpty'den) otomatik sürülemez.
- Kurulu: Node 24.14.1, pnpm 11.9.0, TS 6.0.3, ESLint 10, Vitest 4, zod 3, AI SDK 7,
  @modelcontextprotocol/sdk 1.29.0.
