---
title: "Symphony v0.2.0 — Yayım ve Kurulum Rehberi (Kullanıcı Adımları)"
---

# 🎼 Symphony v0.2.0 — Senin Yapacağın Adımlar

> **Bu belge kime?** Sana (brkn2319). Kod tarafındaki her şey bitti, test edildi, GitHub'a
> gönderildi. Bundan sonrası **senin elinle** yapılacak adımlar: masaüstü uygulamasını kurmak,
> istersen yayımlamak ve CLI'ı npm'e açmak. Her adımda **hangi siteye gireceğin, hangi düğmeye
> basacağın** yazılı. Sırayla git; her bölümün sonunda bir ✅ kontrol satırı var.
>
> **Tarih:** 2026-07-13 · **Sürüm:** v0.2.0 · **Repo:** `github.com/lrgendie/symphony` (private)

---

## 0. Şu an ne durumda? (özet)

| Ne | Durum |
|---|---|
| Kod (H1–H5 Bağlam Haritası v2 + tüm fazlar) | ✅ Bitti, 701 test yeşil, GitHub'da |
| Sürüm | 0.1.0 → **0.2.0** yükseltildi, `v0.2.0` tag'i atıldı |
| GitHub Release | ✅ **Draft** hazır — 6 kurulum dosyası (Win x64/ARM64, macOS ARM64) |
| Çalışan daemon | ✅ v0.2.0, ayakta (127.0.0.1:7770) |
| Masaüstü uygulaman | ⚠️ Hâlâ **ESKİ sürüm** — yeni haritayı görmüyor (bu rehber onu düzeltir) |
| npm yayını | ⛔ Henüz yok (Bölüm 4 — istersen) |

**Neden masaüstü eski?** Uygulamanın içindeki arayüz kurulum anında gömülür. Eski uygulaman
Bağlam Haritası'nın yeni özelliklerini (kürasyon, animasyon, hafta düğümleri) içermiyor. Bugün
"harita bağlantı yok" hatası tam bundan: eski arayüz, yeni daemon'ın gönderdiği `week` düğümünü
tanımıyor. **Çözüm = Bölüm 2 (yeni installer'ı kur).**

---

## 1. Terminal / CLI doğrulaması (2 dakika)

Amacımız: `symphony` komutunun 0.2.0 olduğundan ve daemon'a bağlandığından emin olmak.

### Adım 1.1 — CLI sürümünü kontrol et
Bir **PowerShell** penceresi aç, şunu yaz:
```powershell
symphony --version
```
- **`0.2.0` yazıyorsa** → ✅ CLI güncel, Adım 1.2'ye geç.
- **`0.1.0` yazıyorsa** → CLI eski link'te kalmış. Şunu çalıştır:
  ```powershell
  cd C:\Users\brkn2\Desktop\OPTIMUS\symphony
  pnpm build
  pnpm add -g link:packages/cli
  symphony --version
  ```
  Artık `0.2.0` görmelisin.

### Adım 1.2 — Daemon bağlantısını kontrol et
```powershell
symphony status
```
Sağlayıcılar (anthropic/ollama up) ve kullanım özeti görünüyorsa → ✅ daemon sağlıklı.

> ⚠️ **"Geçersiz token" (AUTH_TOKEN_INVALID) alırsan** → aynı anda iki daemon çalışıyor demektir
> (eski + yeni). Bölüm 5.1'deki token temizleme adımını uygula.

**✅ Kontrol:** `symphony --version` → 0.2.0 · `symphony status` → sağlıklı.

---

## 2. Masaüstü uygulamasını kurma (asıl iş — bugünkü harita hatasını çözer)

### Adım 2.1 — Kurulum dosyasını GitHub'dan indir

1. Tarayıcıda şu adrese git:
   **https://github.com/lrgendie/symphony/releases**
2. En üstte **"Symphony v0.2.0"** yazan, yanında gri **"Draft"** rozeti olan release'i göreceksin.
   Başlığına tıkla (ya da sağdaki kalem/✏️ "Edit" simgesine).
3. Sayfayı aşağı kaydır → **"Assets"** (Dosyalar) bölümünü bul. Şu dosyaları göreceksin:
   - `Symphony_0.2.0_x64-setup.exe` ← **BUNU İNDİR** (normal Windows, yönetici gerekmez)
   - `Symphony_0.2.0_x64_en-US.msi` (alternatif — Program Files'a kurar, yönetici ister)
   - `..._arm64_...` (yalnız ARM Windows cihazlar için — senin makinen x64, bunları ATLA)
   - `..._aarch64.dmg` / `.app.tar.gz` (yalnız Mac için — ATLA)
4. **`Symphony_0.2.0_x64-setup.exe`** dosyasına tıkla → indirilsin (İndirilenler klasörüne düşer).

> Repo **private** olduğu için bu dosyaları yalnız sen (giriş yaptığın GitHub hesabınla)
> indirebilirsin. Başkasının indirmesi için Bölüm 3 (yayımlama) gerekir.

### Adım 2.2 — Eski uygulamayı kapat, sonra kur

1. **Açık olan ESKİ Symphony masaüstü penceresini kapat** (varsa). Ayrıca terminalden
   `desktop:dev` ile açtıysan onu da kapat — iki sürüm aynı anda çakışmasın.
2. İndirdiğin **`Symphony_0.2.0_x64-setup.exe`** dosyasına çift tıkla.
3. Kurulum sihirbazı açılır → **Next / İleri** → **Install / Kur** → **Finish / Bitir**.
   (Windows "bilinmeyen yayıncı" uyarısı verirse → "Daha fazla bilgi" → "Yine de çalıştır".)

### Adım 2.3 — Aç ve doğrula

1. Başlat menüsünden **"Symphony"** yaz → aç. (Ya da terminalde `symphony` yaz — kuruluysa
   masaüstünü otomatik açar.)
2. Uygulama açılınca üstteki **"Bağlam Haritası"** sekmesine tıkla.
3. **Kontroller:**
   - Harita artık **hata vermemeli** (eski "daemon'a bağlantı yok" gitti).
   - Düğümleri göreceksin. **NOT:** Şu an gerçek verinde çoğu şey eski/katlanmış olduğu için
     harita yalnız birkaç **hafta (week) düğümü** gösterebilir — bu normal.
   - Bir sohbet ya da agent koşusu başlat (`symphony` → sohbet) → haritaya yeni düğümler düşer,
     canlı animasyon (hafif kayma + akış) çalışır.
   - Bir düğüme tıkla → yan panelde **kürasyon düğmeleri** (Haritaya sabitle / Bağla / Grupla).

**✅ Kontrol:** Masaüstünde "Bağlam Haritası" sekmesi hatasız açılıyor ve düğümler görünüyor.

---

## 3. GitHub Release'i yayımlama (OPSİYONEL — sadece başkaları indirsin istiyorsan)

> **Repo private olduğu için:** yayımlasan bile release'i yalnız repo'ya erişimi olanlar görür.
> **Sadece kendin kullanacaksan bu bölümü ATLA** — Bölüm 2'de draft'tan indirmen yetti.
> Herkese açık dağıtım istiyorsan önce repo'yu Public yapman gerekir (ayrı karar).

Yayımlamak istersen:
1. **https://github.com/lrgendie/symphony/releases** → "Symphony v0.2.0" (Draft) → sağdaki
   ✏️ **"Edit"** (kalem) simgesine tıkla.
2. Açılan sayfada notları oku (macOS paketlerinin imzasız olduğu uyarısı orada).
3. Sayfanın en altındaki yeşil **"Publish release"** düğmesine bas.
   - Draft rozeti kalkar, release herkese (repo erişimi olanlara) görünür olur.
4. İstersen "Set as the latest release" kutusunu işaretle.

**✅ Kontrol:** Release'in "Draft" rozeti kalktı.

---

## 4. CLI'ı npm'e yayımlama (F2 — OPSİYONEL, `symphony`'yi dünyaya açmak)

> Bu, `npm install -g @symphony/cli` ile herkesin kurabilmesi içindir. **Zorunlu değil** —
> kendi makinende zaten çalışıyor. Yapmak istersen aşağıdaki 4 adım.

### Adım 4.1 — npm hesabı + giriş
1. **https://www.npmjs.com/** → sağ üst **"Sign Up"** (yoksa) → hesap oluştur, **e-postanı doğrula**.
2. Terminalde giriş yap:
   ```powershell
   npm login
   ```
   Tarayıcı açılır, onaylarsın. Kontrol: `npm whoami` → kullanıcı adın çıkmalı.

> ⚠️ **Paket adı sorunu (önemli):** Paketler `@symphony/cli`, `@symphony/core`, `@symphony/shared`
> adında (scoped). npm'de **`symphony` organizasyonu senin değilse yayımlanamaz.** İki seçenek:
> **(a)** npm'de "symphony" adında bir **Organization** oluştur (npmjs.com → sağ üst profil →
> "Add Organization" → ücretsiz plan public paketler için yeter), **VEYA** **(b)** paketleri
> kendi kullanıcı adınla yeniden adlandır (ör. `@brkn2319/symphony-cli`) — bu, `package.json`
> `name` alanlarını + aralarındaki bağımlılıkları değiştirmeyi gerektirir (bunu bana yaptırabilirsin).

### Adım 4.2 — npm token üret (CI'nin yayımlaması için)
1. **https://www.npmjs.com/** → sağ üst profil resmi → **"Access Tokens"**.
2. **"Generate New Token"** → tür olarak **"Automation"** seç (CI için doğrusu bu) → oluştur.
3. Çıkan token'ı **kopyala** (bir daha gösterilmez — güvenli yere al).

### Adım 4.3 — Token'ı GitHub'a secret olarak ekle
1. **https://github.com/lrgendie/symphony/settings/secrets/actions** adresine git.
   (Manuel: repo → **Settings** → sol menü **"Secrets and variables"** → **"Actions"**.)
2. Yeşil **"New repository secret"** düğmesine bas.
3. **Name:** `NPM_TOKEN` (bire bir böyle) · **Secret:** az önce kopyaladığın npm token'ı yapıştır.
4. **"Add secret"** ile kaydet.

### Adım 4.4 — Yayını tetikle
Release iş akışı `v*` tag'inde çalışır. Zaten `v0.2.0` var; npm işini yeniden koşturmak için
ya yeni bir yama sürümü (`v0.2.1`) atarsın ya da mevcut tag'i yeniden itersin. **En temizi yeni
yama sürümü** — bunu bana söyle, `0.2.1`e çıkarıp tag'i atarım; CI bu sefer `NPM_TOKEN` olduğu
için npm'e de yayımlar.

**✅ Kontrol:** `npm view @symphony/cli version` → 0.2.x döner (yayım başarılı).

---

## 5. Sık karşılaşılan sorunlar (sorun çıkarsa buraya bak)

### 5.1 — "AUTH_TOKEN_INVALID: Geçersiz token" (bugün yaşadık)
**Neden:** Aynı anda iki daemon çalışıyor (biri eski token'la). **Çözüm:**
```powershell
# 7770'i dinleyen daemon'ın PID'sini bul:
netstat -ano | findstr :7770
# Çıkan son sütundaki PID numarasını kullanarak öldür (ör. 24008):
taskkill /F /PID <PID>
# Eski token'ı sil, taze üretilsin:
del "$env:USERPROFILE\.symphony\daemon.token"
# Yeni daemon'ı başlat:
symphony status
```
Sonra masaüstü uygulamasını **kapat/yeniden aç** (token'ı yeniden okusun).

### 5.2 — Harita "daemon'a bağlantı yok" diyor ama daemon çalışıyor
**Neden:** Masaüstü uygulaman ESKİ sürüm (yeni düğüm türlerini tanımıyor). **Çözüm:** Bölüm 2
(v0.2.0 installer'ını kur). Bu, bugünkü hatanın kalıcı çözümü.

### 5.3 — İki Symphony penceresi / eski daemon takılması
Görev Yöneticisi'nden eski `app.exe` ve fazladan `node.exe` (daemon) süreçlerini kapat, tek bir
daemon kalsın. Sonra `symphony` ile temiz başlat.

---

## 6. Özet Kontrol Listesi (sırayla işaretle)

- [ ] **1.** `symphony --version` → 0.2.0, `symphony status` → sağlıklı
- [ ] **2A.** GitHub releases → `Symphony_0.2.0_x64-setup.exe` indirildi
- [ ] **2B.** Eski uygulama kapatıldı, installer kuruldu
- [ ] **2C.** Masaüstü açıldı → "Bağlam Haritası" hatasız çalışıyor
- [ ] **3.** *(opsiyonel)* Release yayımlandı (başkaları için)
- [ ] **4.** *(opsiyonel)* npm hesabı + NPM_TOKEN secret + yayım tetiklendi
- [ ] **✔** Her şey çalışıyor → v0.2.0 canlı!

---

## Sırada ne var? (bu rehberden sonra — bana söyle, ben yaparım)

Bunlar **kod tarafı** işler (senin değil, benim/modelin): `rapor/mimari-tarama-2026-07-13.md` ve
`ROADMAP.md §4.5`'teki açık maddeler — en önemlisi **Y1/B2** (patch merge çakışması), sonra
**Y7** (bugünkü token sorununun kalıcı düzeltmesi), **N1** (isim standardı kararı — bu senin
kararın). Yayım/kurulum bitince "hadi Y1'e geç" dersin, oradan devam ederiz.
