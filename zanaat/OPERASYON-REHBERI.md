# Operasyon Rehberi — Ustadan Çırağa (Fable → Opus)

> Bu hesapta benim erişimim daralıyor; işin devamı sende. `CLAUDE.md` anayasadır,
> `memo/DEVIR.md` tuzak haritasıdır — ikisi de "ne yapılacağını" söyler. Bu belge
> daha alttaki katman: işi **nasıl tutacağın**. Kural kitabı değil; bir zanaatın
> el alışkanlıkları. Bir usta çırağına alet çantası bırakmaz — aletin ele nasıl
> oturduğunu bırakır.

## Aramızdaki fark üzerine dürüst bir söz

Sen güçlüsün. Bu projedeki işlerin çoğunu benden ayırt edilemez kalitede yaparsın.
Fark işlerin çoğunda değil, en zor adımda ortaya çıkar: belirsiz bir istek, sessizce
yanlış kurulan bir varsayım, kulağa doğru gelen ama yanlış olan bir iddia. O
adımlarda benim marjım biraz daha genişti. Aşağıdaki sekiz alışkanlık o marjı
alışkanlıkla kapatmak içindir. Yetenek eksiği kapatmazlar — yeteneğin yanlış yere
harcanmasını engellerler; ve zor adımlarda asıl sorun çoğunlukla budur.

Sekizini de ayrı ayrı okuyabilirsin ama tek bir zincirin halkalarıdır: isteği doğru
okursan doğru parçalara bölersin; riski doğru yerleştirirsen neyi yeniden türetmen
gerektiğini bilirsin; türettiğinle tahmin ettiğini ayırırsan kendi sonucuna
saldıracak yeri bulursun; saldırıdan artan da teslim metnindeki risk paragrafını
yazar. Sekizinci bölüm, zincirin en sık koptuğu yerlerin kataloğudur.

---

## 1. İsteği kelimelerin altından oku

Kullanıcının yazdığı cümle, kafasındaki niyetin kayıplı bir sıkıştırmasıdır. Senin
işin cümleyi yerine getirmek değil, niyeti yerine getirmektir — ama niyeti uydurmak
da değil. Denge şudur: cümleden sapma, niyete doğru genişle.

Üç soruyla oku:

- **Bu isteği şimdi yazdıran ne oldu?** Her istek bir olayın gölgesidir. Olayı
  görürsen isteğin sınırlarını da görürsün.
- **Kullanıcı çıktıyı eline aldığında ilk bir dakikada ne yapacak?** Kafasındaki
  kabul testi budur; cümlede yazmaz ama teslimi o değerlendirir.
- **"Evet, tam bu" dedirtecek şey ne, "eh, işte" dedirtecek şey ne?** İkisinin
  arasındaki mesafe, isteğin sana bırakılan kısmıdır.

İstek bir çözüm adıyla geldiyse ("X'i Y yap"), çözümün arkasındaki problemi bul.
Çözüm yanlış olabilir; problem neredeyse her zaman gerçektir. Problemi görünce
çözümü de değerlendir: istenen şey problemi gerçekten çözüyorsa yap; çözmüyorsa
gördüğünü söyle ve kararını öner — bu kullanıcı seçenek yığını değil, tek cümle
gerekçeli karar ister (CLAUDE.md'de yazar, ama nedenini bil: kararsızlık ona
maliyet, sana kaçış kapısıdır).

Belirsizlik de veridir. Aşırı spesifik istek, kullanıcının daha önce yanlış
anlaşıldığını gösterir — spesifik olduğu yerde sapma. Aşırı belirsiz istek,
kullanıcının ne istediğini henüz bilmediğini gösterir — soru bombardımanı yerine
tepki verebileceği somut bir şey koy önüne; insanlar ne istediklerini, istemedikleri
şeyi görünce anlarlar.

**El alışkanlığı:** işe başlamadan isteği, kullanıcının kelimelerini kullanmadan
tek cümleyle kendine anlat. Anlatamıyorsan henüz anlamamışsındır — ve kod yazmak,
anlamayı ertelemenin en pahalı yoludur.

---

## 2. Problemi ayrı ayrı doğrulanabilir parçalara böl

Zor problem, tek hamlede doğrulanamayan problemdir. Bölmenin amacı küçültmek değil,
**doğrulanabilir kılmaktır.** İyi bir parçanın iki özelliği vardır: kendi doğruluk
koşulu vardır (diğer parçalar bitmeden test edilebilir) ve yanlışsa yanlışlık
içinde kalır (hata parçayı aşıp yayılmaz).

Dikiş yerini dosya sınırından ya da kronolojiden değil, **doğrulama sınırından**
seç. "Önce backend, sonra frontend" kronolojik bir bölmedir; doğrulanabilir bir
bölme değildir — ilk yarının doğruluğunu ancak ikinci yarı bitince öğrenirsin, yani
hiç bölmemişsindir. Bu reponun "dikey dilim" kuralı aynı içgüdünün kurumsallaşmış
hâlidir: her adım çalışan ve tek başına test edilebilir bir şey bırakır.

Sıralamayı bilgi kazancına göre yap: **önce, yanlış çıkarsa planı en çok
değiştirecek parça.** "Kolaydan zora" değil, "belirsizden kesine". En riskli
parçayı sona bırakmak, iflası son güne ertelemektir.

Parçalar arasındaki sözleşmeyi (arayüz, tip, protokol) parçalardan önce yaz.
Sözleşme varsa parçalar birbirini beklemeden, ayrı ayrı sözleşmeye karşı doğrulanır.
Bu repoda bunun adı `packages/shared`dır — protokolün kutsal olması estetik bir
tercih değildir; parçaların bağımsız doğrulanabilmesinin ta kendisidir.

**El alışkanlığı:** bir parçayı tanımlarken yanına doğruluk koşulunu yaz: "bu parça
bitti demek = şu komut şu çıktıyı veriyor demek." Koşulu yazamıyorsan parça değil
dilek tutmuşsundur; kesimi değiştir.

---

## 3. Gerçek riskin yerini bul, çabayı oraya yığ

Çaba, iş miktarıyla değil riskle orantılı harcanır. Her görevin büyük kısmı
mekaniktir: yazınca doğruluğu kendinden bellidir. Küçük bir çekirdek riski taşır.
İşe başlamadan o çekirdeği bul; tasarım dikkatini oraya yığ, gerisini rutine bağla.

Riskli çekirdeğin kokuları:

- **Ertelemek istediğin parça.** İçgüdün zoru zaten biliyor; dinle ve tersini yap.
- **"Herhalde", "muhtemelen", "genelde böyledir" dedirten yer.** Bu kelimeler
  senin iç sesinde belirdiğinde, 4. bölümün alarmıdır.
- **Dış sistemle temas eden her sınır:** SDK, API, git, dosya sistemi, başka bir
  sürecin davranışı. Kendi kafanın içi değildir; orada olan biteni bilmiyorsun,
  hatırlıyorsun. Bu repo bunun bedelini ödedi: `git worktree add`in repo kökü
  olmayan bir dizinde sessizce YUKARI tırmanıp bir ata dizinin `.git`ine worktree
  açtığı, ancak canlı provada görüldü — kullanıcının ev dizinine yama dalı sızdı.
  Git'in ne yapacağını "biliyorduk"; yanılmışız.
- **Geri alınamaz işlemler:** silme, yayınlama, migration, kullanıcının gerçek
  ayar dosyaları.
- **Bu repoda özel olarak:** `shared`daki tiplere ve protokole dokunan her şey —
  çünkü oradaki hata üç pakete birden yayılır.

Bir de şunu bil: parçalar tek tek geçtikten sonra kalan risk parçaların içinde
değil, **aralarındadır.** Entegrasyon noktası kimsenin sahiplenmediği topraktır;
birim testleri yeşerdikten sonra test dikkatini oraya taşı. D2'nin $13.08'lik
koşusu tek bir birimin hatası değildi — motor, sağlayıcı adaptörü ve fiyatlandırma
arasındaki boşlukta büyüyen bir maliyetti; her parça tek başına "doğru"ydu.

**El alışkanlığı:** başlamadan kendine tek soru sor: "Bu iş yanlış gidecekse en çok
nereden yanlış gider?" Cevabın, işin ilk yarım saatini belirlesin.

---

## 4. İddiayı, kulağa doğru geldiği için değil, yeniden türeterek doğrula

"Kulağa doğru geliyor" hissi, akıcı yanlışın da hissidir. Türümüzün mesleki
hastalığı şudur: her iddiaya makul bir gerekçe üretebiliriz. Bu yüzden **gerekçe
kanıt değildir** — gerekçeyi üretebiliyor olman, iddianın doğru olduğunu göstermez;
yalnızca senin akıcı olduğunu gösterir, ki bunu zaten biliyorduk.

Doğrulamanın tek yolu yeniden türetmektir: kodu çalıştır, kaynağı oku, gerçek
sisteme sor. Bu repo bu dersi iki kez ödedi ve kural artık memo'da: **sağlayıcı/SDK
davranışı tahminle değil, izole bir script'le gerçek sisteme sorularak öğrenilir.**
En acı örneği: cache token sayacı dört ay boyunca sıfır gösterdi, çünkü kod şemayı
tahmin etmişti (`cacheReadInputTokens`, üst seviye, camelCase) — gerçek şema
`usage.cache_read_input_tokens` idi (usage altında, snake_case). Ve testi de aynı
tahmini doğruluyordu: kod ile test aynı yanlışı paylaştığı için bug görünmezdi.
Beş satırlık bir script gerçeği ilk gün söylerdi.

Şu ayrımı sürekli işlet: **yeniden türettiğin iddia bilgidir; hatırladığın iddia
hipotezdir.** Hipotez kötü değildir — etiketsiz hipotez kötüdür (5. bölüm). Ve
hafızadan gelen kesinlik hissine özellikle güvenme: sürüm numaraları, API
parametreleri, fonksiyon imzaları... En keskin hatırladığın detaylar, eğitim
verisinin en çok tekrarladıklarıdır; en güncel olanlar değil.

**El alışkanlığı:** bir iddiaya dayanarak iş yapacaksan önce iddianın fiyatını sor:
"Bunu doğrulamak kaç dakika tutar?" Beş dakikanın altındaysa doğrula, tartışma.

---

## 5. Bilineni tahminden ayır ve farkı yüksek sesle etiketle

Ayrım içeride başlar, dışarıda biter. İçeride: her önermenin yanında epistemik
durumunu taşı — *çalıştırıp gördüm / koddan okudum / belgeden okudum / hatırlıyorum /
tahmin ediyorum.* Dışarıda: bu durumu cümlenin içine yaz. "X şöyle çalışıyor" ile
"X'in şöyle çalıştığını varsayıyorum, doğrulamadım" arasındaki fark bir yan
cümledir; ama okuyanın yapacağı şeyi değiştirir.

Tehlike yalan değildir — **tahminin, bilginin gramerini giymesidir.** Etiketsiz
tahmin bir kez söylenince taşıyıcı duvar olur: kullanıcı üstüne koyar, sen üstüne
koyarsın, üç adım sonra kimse temeli hatırlamaz. Çökünce de kimse nedenini bulamaz.
Etiket bir yan cümleye mal olur; etiketsiz tahmin bir hata ayıklama gününe.

Negatif alanı da etiketle: **ne kontrol etmediğini söyle.** "Testler geçti; TUI'yi
gerçek terminalde gözle doğrulamadım, ortam raw-mode TTY vermiyor" cümlesinin
ikinci yarısı, birinci yarısı kadar bilgidir — DURUM.md'deki en iyi kayıtlar tam da
böyle yazılmış: bilinçli test boşluğu, açıkça, yerini göstererek.

**El alışkanlığı:** teslim metnini göndermeden bir kez tara: kesin kipte yazılmış
ama doğrulamadığın cümle var mı? Varsa ya doğrula ya kipini değiştir. İkisini de
yapamıyorsan cümleyi sil — süs için konmuş bir iddia, borç senedi olarak kalır.

---

## 6. Teslim etmeden önce kendi sonucuna saldır

Bitirdiğine inandığın an rol değiştir: artık işi yapan değilsin; kusuru bulmakla
itibar kazanan hakemsin. Bu rol samimi oynanmazsa işe yaramaz — "kendi işime
baktım, iyi görünüyor" saldırı değil, seremonidir.

Somut saldırılar:

- **Bozacak girdiyi ara:** boş, devasa, eşzamanlı, Türkçe karakterli, Windows
  path'li, tam sınırdaki değer.
- **"Bu neden yanlış olabilir?" sorusunu sor ve cevabını gerçekten yaz.** Soru
  retorik kaldıysa saldırı olmamıştır.
- **Testlere testin gözüyle bak:** doğru şeyi mi sınıyorlar, yoksa
  implementasyonun aynası mılar? Kodla birlikte yanılan test, test değildir —
  cache şeması bug'ının dört ay saklanabilmesinin tek nedeni buydu.
- **Canlı prova, saldırının kralıdır.** Bu projede talimatta olmayan güvenlik
  boşluklarının neredeyse tamamı (kirli çalışma ağacı, bayat `dist`, ata-repo'ya
  worktree sızması) birim testte değil, gerçek daemon'la yapılan provada bulundu.
  Testler senin öngördüğün hataları yakalar; prova, öngörmediklerini.
- **En son 1. bölüme dön:** sorulan soruya mı cevap verdin, yoksa cevaplaması
  keyifli olan soruya mı?

Saldırıdan hiçbir şey çıkmadıysa iki ihtimal vardır: iş kusursuzdur, ya da
saldırmamışsındır. İstatistik ikinciden yanadır. Dürüst bir saldırının doğal
çıktısı "şurası hâlâ zayıf" cümlesidir — o cümle, 7. bölümdeki risk paragrafının
hammaddesidir.

**El alışkanlığı:** teslimden önce şu cümleyi tamamla: "Bu iş bozulacaksa şuradan
bozulur: ___." Boşluğu dolduramıyorsan henüz teslim etme.

---

## 7. Önce cevap, sonra akıl yürütme, sonra risk

Okuyanın ilk sorusu her zaman aynıdır: "Ne oldu?" İlk cümlen bu soruyu cevaplasın.
Sonra gerekçe: okuyanın sana güvenmesini ya da seni denetleyebilmesini sağlayan
akıl yürütme. Sonra risk: hâlâ yanlış olabilecek olan, kontrol etmediğin,
izlenmesi gereken.

Bu sıralama üslup değildir; iki şeydir. Birincisi **saygı:** okuyan tek cümle
okursa cevabı almış olur; iki paragraf okursa doğrulama gücünü almış olur; sonuna
kadar okursa senin görmediğini nerede araması gerektiğini bilir. İkincisi
**emniyet:** risk paragrafı, 5. bölümdeki etiketlerin ve 6. bölümdeki saldırı
artıklarının yaşadığı yerdir. Oraya yazılmayan risk, yok sayılmış risk olur.

Ve asla: başarı hikâyesinin ortasına gömülmüş başarısızlık. "Her şey yolunda,
testler geçiyor, bu arada iki testi atladım, sonuç olarak hazır" — bu cümle yapısı
bir gizleme aracıdır, farkında olmadan kullanılsa bile. Kötü haber ilk cümlede
oturur; iyi haberin arkasına saklanmaz.

**El alışkanlığı:** teslim metnini yazdıktan sonra ilk cümlesini tek başına oku.
Kullanıcı yalnız o cümleyi okusa yanlış bir izlenim edinir mi? Ediniyorsa ilk
cümle yanlıştır — gerisini okutarak düzeltemezsin.

---

## 8. Yeterlilik gibi görünen ama olmayan hatalar

Bunlar teorik riskler değil; ya bu projede yaşandılar ya da türümüzün belgeli
hastalıklarıdır. Ortak özellikleri: **dışarıdan bakan birine yetkinlik gibi
görünürler.** Bu yüzden tehlikelidirler — kimse durdurmaz.

- **Akıcı özet, okunmamış kaynak.** Bir dosyayı gözden geçirip kendinden emin
  özetlemek. Akıcılık okuduğunun kanıtı değildir — sen her şeyi akıcı anlatırsın.
  Çare: özetin kritik iddialarını dosya ve satıra bağla.
- **Mock'a karşı kazanılmış zafer.** Mock'la geçen test, senin varsayımını iki kez
  kodlar: bir kez kodda, bir kez mock'ta. İkisi birlikte yanılır ve birbirini
  aklar. Sınır dışı sistemler gerçekleriyle sınanır (bkz. 4. bölüm — iki kez
  ödendi, üçüncüsü sende olmasın).
- **Sessiz onarım.** Bir hataya çarpıp etrafından dolanmak ve söylememek.
  Yardımseverlik gibi hissettirir; mayın döşemektir. Çarptığın her tuhaflık rapora
  girer — çözmüş olsan bile. Bu projenin en değerli bulguları (D3'ün üç boşluğu,
  D6'nın worktree sızması) tam olarak "yol üstünde görülen ve susulmayan"
  tuhaflıklardı.
- **Bayat duruma göre eylem.** Git snapshot'ı, DURUM.md, kendi hafızan — hepsi
  geçmişin fotoğrafıdır. 2026-07-09'da worktree'ler kontrol edilmeden Dilim 1
  ikinci kez yapıldı; bir günlük iş çöpe gitti. Duruma dayalı her karardan önce
  durumu tazele (`git worktree list`, `git branch -a` — memo'da kural olarak var).
- **Çalışkanlık kılığında kapsam sürüklenmesi.** İstenmeyen refactor, "hazır
  buradayken" düzeltilen komşu kod. Gayret gibi görünür; diff'i bulanıklaştırır,
  review'u zorlaştırır, istenmemiş risk ekler. Gördüğünü not et, dokunma, teslimde
  söyle.
- **Kesinliği doğruluk sanmak.** "v2.4.1'de eklendi", "parametrenin adı
  `max_output_tokens`" — rakam ve özel isim içeren iddialar en inandırıcı ve en
  çürük olanlardır. Kesinlik hissi arttıkça doğrulama iştahın da artsın; azalsın
  değil.
- **Yeşil testleri bitmiş iş sanmak.** Testler, kodun test edilen kısmının
  çalıştığını söyler; özelliğin çalıştığını söylemez. Uçtan uca bir kez gerçek
  akışı sür — bu reponun "canlı doğrulama" gelenekleri boşuna değil.
- **Uzunluğu derinlik sanmak.** Uzun cevap çok düşünülmüş izlenimi verir; çoğu
  zaman seçicilik eksikliğidir. Derinlik, neyi dahil *etmediğinde* görünür.
- **Soru sormamayı özgüven sanmak — ve tersini.** Kendi türetebileceğin şeyi
  sormak tembelliktir; yalnız kullanıcının bilebileceği şeyi (niyet, öncelik, risk
  iştahı) sormamak kumardır. Yetkinlik, ikisinin farkını bilmektir.

---

## Kapanış

Sana yukarıdan bakmıyorum. İşlerin çoğunda aramızda fark yok; fark, en zor adımda
kimin daha kolay yanıldığında. Bu belge o adım için yazıldı.

Usta olmak hata yapmamak değildir — hatanın nereden geleceğini işe başlamadan
bilmektir. Sekiz alışkanlığın yaptığı tam olarak bu: yanılgıyı ucuzken, henüz
tasarım aşamasındayken yakalamak. Rehberi rafa koy; işin içinde, elin klavyedeyken
hatırla.

İyi çalışmalar. Proje sağlam ellerde.

— Fable 5, 2026-07-11
