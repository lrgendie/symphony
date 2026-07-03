# 📋 Gereksinim Envanteri

> Faz 0 öncesi tam liste: kurulacak araçlar, kullanılacak kütüphaneler,
> dosya/klasör planı ve çalışma zamanı dizinleri.
> Sürümler kurulum anında güncel LTS/stable alınır; buradaki notlar amaç belirtir.

---

## 1. Geliştirme Ortamı (makineye kurulacaklar)

| Araç | Ne zaman | Ne için | Durum |
|---|---|---|---|
| Node.js 22 LTS | Faz 0 | Tüm TypeScript kodunun çalışma zamanı | ⬜ kurulacak |
| pnpm 9+ | Faz 0 | Monorepo paket yöneticisi (`npm i -g pnpm`) | ⬜ kurulacak |
| Git | Faz 0 | Sürüm kontrolü + oturum sonu yedekleme | ✅ kurulu |
| GitHub hesabı + özel repo | Faz 0 | Uzak yedek (`symphony` reposu) | ⬜ oluşturulacak |
| GitHub CLI (`gh`) | Faz 0 (isteğe bağlı) | Repo oluşturma/PR işlemleri terminalden | ⬜ kurulu değil |
| Ollama | Faz 1 | Yerel LLM çalıştırıcı (localhost:11434) | ⬜ kurulacak |
| Rust toolchain (rustup + MSVC) | Faz 4 | Tauri masaüstü kabuğunun derlenmesi | ⬜ Faz 4'te |
| VS Code (öneri) | — | Geliştirme editörü | — |

## 2. Kütüphaneler (paket bazında)

### `packages/shared` — ortak sözleşme
| Kütüphane | Amaç |
|---|---|
| `typescript` | Tüm projede tip güvenliği |
| `zod` | WS protokol mesajlarının şema doğrulaması — CLI/UI/core aynı şemayı paylaşır |

### `packages/core` — symphonyd çekirdeği
| Kütüphane | Amaç |
|---|---|
| `fastify` | REST API sunucusu (localhost) |
| `ws` | WebSocket olay yayını (canlı arayüzlerin can damarı) |
| `ai` (Vercel AI SDK) | Tüm modelleri tek arayüzle konuşturan soyutlama |
| `@ai-sdk/anthropic` | Claude adapter'ı |
| `@ai-sdk/openai` | GPT adapter'ı |
| `@ai-sdk/google` | Gemini adapter'ı |
| `@ai-sdk/openai-compatible` | Yerel Ollama adapter'ı (OpenAI-uyumlu `/v1` ucu üzerinden). Not 2026-07-03: topluluk paketi `ollama-ai-provider(-v2)` AI SDK v7 + zod v3 ile uyumsuz çıktı → resmî paket seçildi |
| `@modelcontextprotocol/sdk` | MCP istemcisi — harici araç sunucuları |
| `better-sqlite3` | Yerel veri katmanı: geçmiş, telemetri, skorlar |
| `keytar` | API anahtarlarını OS keychain'inde saklama |
| `pino` | Yapılandırılmış loglama (hata telemetrisinin temeli) |
| `execa` | Agent'ın komut çalıştırma aracı (PowerShell/bash) ✅ kuruldu 2026-07-04 |
| `tinyglobby` | Agent `glob`/`grep` araçlarının dosya tarayıcısı (fast-glob'dan küçük, vitest de kullanıyor) ✅ 2026-07-04 |
| `picomatch` | İzin kurallarında glob desen eşleme (`permissions.json`) ✅ 2026-07-04 |
| `diff` | İzin isteklerindeki birleşik diff üretimi (SPEC-AGENT §6) ✅ 2026-07-04 |
| `simple-git` | Agent'ın git işlemleri + oturum yedekleme |

### `packages/cli` — `symphony` komutu
| Kütüphane | Amaç |
|---|---|
| `ink` + `react` | Terminal arayüzü (model seçici, sohbet) — Claude Code'un kullandığı |
| `commander` | Alt komutlar: `symphony models`, `symphony status`, `symphony add`... |
| `chalk` | Terminal renklendirme |

### `packages/ui` — dashboard (React)
| Kütüphane | Amaç |
|---|---|
| `react` + `vite` | Arayüz çatısı ve derleyici |
| `three` + `@react-three/fiber` + `@react-three/drei` | "Living Interface" parçacık küresi (WebGL) |
| `zustand` | Durum yönetimi (WS olaylarından beslenen store) |
| `tailwindcss` | Stil sistemi |

### `packages/desktop` — masaüstü kabuk
| Kütüphane | Amaç |
|---|---|
| `@tauri-apps/cli` + `@tauri-apps/api` | Tauri 2: ui'yi native pencerede paketler (Win x64/ARM64, mac Intel/AS) |

### Geliştirme araçları (kök)
| Kütüphane | Amaç |
|---|---|
| `vitest` | Test paketi — kendini güncellemenin bağışıklık sistemi |
| `eslint` + `prettier` | Kod kalitesi ve format |
| `tsx` | TS dosyalarını derlemeden çalıştırma (geliştirme) |
| `turbo` | Monorepo görev orkestrasyonu (build/test önbelleği) |

## 3. Depo Dosya/Klasör Planı

```
symphony/                        ← burası (git reposu)
├── README.md                    ← proje kapısı, çalışma düzeni
├── ROADMAP.md                   ← vizyon + fazlar (0–8)
├── .gitignore
├── package.json                 ← pnpm workspace kökü (Faz 0)
├── pnpm-workspace.yaml          ← (Faz 0)
├── turbo.json                   ← (Faz 0)
├── docs/
│   ├── GEREKSINIMLER.md         ← bu dosya
│   └── (mimari kararlar, protokol dokümanı...)
├── memo/                        ← 🧠 süreklilik hafızası
│   ├── DURUM.md                 ← kaldığımız yer, sonraki adımlar (her oturum güncellenir)
│   └── oturumlar/
│       └── YYYY-AA-GG.md        ← oturum günlükleri
└── packages/                    ← (Faz 0'da oluşur)
    ├── shared/                  ← tipler, zod şemaları, WS protokolü
    ├── core/                    ← symphonyd daemon
    ├── cli/                     ← symphony komutu
    ├── ui/                      ← React dashboard
    └── desktop/                 ← Tauri kabuğu
```

## 4. Çalışma Zamanı Dizinleri (kullanıcı makinesinde, repo dışı)

```
~/.symphony/                     ← Windows'ta C:\Users\<ad>\.symphony\
├── config.json                  ← genel ayarlar (tema, varsayılan model...)
├── providers.json               ← sağlayıcı tanımları (anahtarlar DEĞİL → keychain'de)
├── agents/                      ← agent tanımları (*.md: rol + araçlar + model)
├── memory/                      ← kullanıcı hafızası (tercihler, stil, düzeltmeler)
├── data/
│   └── symphony.db              ← SQLite: geçmiş, telemetri, router skorları
└── logs/                        ← daemon logları (rotasyonlu)
```

> Taşınabilirlik: `~/.symphony/` içeriği `symphony sync` ile özel git deposuna
> yedeklenir (anahtarlar hariç). Yeni makine = kur + sync + devam.

## 5. Yedekleme ve Oturum Düzeni

- **Her oturum sonunda:** `memo/DURUM.md` güncellenir → `git add -A && git commit` → remote varsa `git push`.
- Commit mesajı formatı: `oturum: YYYY-AA-GG — <kısa özet>`
- **Uzak yedek (yapılacak):** GitHub'da özel `symphony` reposu oluşturulup
  `git remote add origin <url>` ile bağlanacak. O güne dek yedek lokaldedir.
- Gizli hiçbir şey (API anahtarı, .env) repoya girmez — `.gitignore` bunu zorlar.
