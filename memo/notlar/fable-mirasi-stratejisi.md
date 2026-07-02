# 💎 Fable Mirası Stratejisi — Önemli Bulgu

> Kayıt tarihi: 2026-07-03. Kaynak: Fable 5 ile yapılan planlama oturumu.
> Kullanıcının isteğiyle kalıcı not alındı. Bu strateji projenin model/bütçe
> yönetiminin temelidir; her model geçişi kararında bu nota dönülür.

## Temel ilke

**Pahalı zekâyı KARARLARA, ucuz zekâyı YAZIMA harca.**

Üst sınıf model (Fable) ile alt sınıf model (Opus/Sonnet) arasındaki fark en çok şurada:
mimari muhakeme, uzun vadeli tutarlılık, kenar durumlarını önden görme, spesifikasyon
kalitesi. Kod yazmak ise — iyi bir spec ve test varsa — büyük ölçüde mekanik iştir ve
daha ucuz modeller bunu gayet iyi yapar.

Sonuç: güçlü model, projenin **"değiştirmesi pahalı"** katmanlarını üretir;
ucuz model o rayların üzerinde tren sürer.

## Fable'ın bıraktığı miras (tamamlananlar)

1. ✅ `CLAUDE.md` — proje anayasası: her modelin uyacağı dokunulmaz kurallar.
   *En yüksek kaldıraç: zayıf modelin çıktı kalitesini doğrudan yükseltir.*
2. ✅ `docs/PROTOKOL.md` — WS protokol spesifikasyonu. *En pahalı hata türü kötü
   protokoldür; en güçlü muhakemeyle donduruldu.*
3. ✅ `docs/SPEC-AGENT.md` — agent motoru + izin sistemi şartnamesi. *Projenin en zor
   %20'si; şartnamesi hazır olunca uygulaması boyama kitabı.*
4. ✅ `docs/kararlar/KARARLAR.md` — 11 ADR, reddedilen alternatiflerle. *Kararlar geri
   açılamaz; "acaba Electron mu" tartışması ölüdür.*
5. ✅ ROADMAP'te faz başına kabul testleri. *Zayıf modele "güzel görünüyor" değil,
   "testler geçiyor" hedefi.*
6. ⬜ Zor çekirdek kodlar (Faz 0–1'de Fable yazacak): shared protokol kodu, event bus,
   agent döngüsü iskeleti, router puanlama mantığı.
7. ⬜ Symphony'nin kendi agent sistem prompt'ları (Şef, Doktor, kod agent'ı — Faz 3/5'te).

## Ekonomik geçiş planı

| Dönem | Model | İş |
|---|---|---|
| Şimdi (Fable erişimi varken) | **Fable 5** | Tasarım, spec, protokol, zor çekirdek kod, faz tasarımları |
| Günlük geliştirme (sonrası) | **Sonnet 5** | Spec'e karşı uygulama — fiyat/performansta açık ara en mantıklı |
| Zor hata avı | **Opus 4.8** | Sonnet'in tıkandığı karmaşık debug işleri |
| Cımbızla (abonelik bitmeden) | **Fable 5** | Her faz geçişinde 1 "tasarım inceleme" oturumu: yeni fazın spec'i + biten fazın incelemesi |

## Simetri

Symphony'nin router'ına koyduğumuz ilke ile kullanıcının bütçe stratejisi aynıdır:
**zor iş pahalı modele, hacimli iş ucuza.** Sistem kendi felsefesiyle inşa ediliyor.
