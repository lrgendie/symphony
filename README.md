# 🎼 Symphony

*[🇬🇧 English version](README.en.md)*

Yerel ve bulut LLM'leri, agent'ları ve yazılım projelerini tek merkezden yöneten,
koda müdahale edebilen, kendini geliştirebilen orkestrasyon platformu.
Windows / macOS / ARM üzerinde çalışır; terminal (`symphony`) ve masaüstü uygulaması
aynı çekirdeğe bağlı iki eş zamanlı arayüzdür.

## Proje Belgeleri

| Dosya | Ne için |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Proje anayasası** — bu repoda çalışan her AI modelin uyacağı kurallar |
| [ROADMAP.md](ROADMAP.md) | Vizyon, mimari, fazlar (0–8) ve faz başına kabul testleri |
| [docs/PROTOKOL.md](docs/PROTOKOL.md) | Daemon ⇄ arayüz iletişim protokolü spesifikasyonu |
| [docs/SPEC-AGENT.md](docs/SPEC-AGENT.md) | Agent motoru + izin sistemi şartnamesi |
| [docs/kararlar/KARARLAR.md](docs/kararlar/KARARLAR.md) | Mimari karar kayıtları (ADR) — "neden böyle?"nin cevabı |
| [docs/GEREKSINIMLER.md](docs/GEREKSINIMLER.md) | Tüm araç/kütüphane envanteri, dosya-klasör planı |
| [memo/DURUM.md](memo/DURUM.md) | **Kaldığımız yer** — her oturuma buradan başlanır |
| [memo/oturumlar/](memo/oturumlar/) | Oturum günlükleri (her çalışma seansının kaydı) |

## Çalışma Düzeni

1. Oturum başında `memo/DURUM.md` okunur → kaldığımız yerden devam.
2. Oturum boyunca yapılanlar oturum günlüğüne işlenir.
3. Oturum sonunda: `DURUM.md` güncellenir → commit → push (yedek).
