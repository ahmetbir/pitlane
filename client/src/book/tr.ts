// Sürücü el kitabı, Türkçe. Sayılar parts.ts'ten gelir (kod, ayarlar, kurallar); burada yalnız metin var.
import { ABS, TC } from "../car/car.ts";
import { keysLabel } from "../input/bindings.ts";
import { b, figure, kbd, list, note, p, steps, sub, type BookCtx, type ChapterBody } from "./kit.ts";
import { absTable, chord, F, keyOf, keyTable, pairOf, launchTable, lightsArt, padTable, RULES as R, settingName, setupTable, tcTable, z100Art } from "./parts.ts";
import type { ChapterName } from "./chapters.ts";

const start = ({ keys }: BookCtx) => [
  p(`Pitlane tarayıcıda oynanan çok oyunculu bir formül yarışı. Bir odada en fazla ${R.cars} araba yarışır; boş yerleri botlar doldurur, yani tek başına da hemen yarışabilirsin.`),
  sub("Yarışa girmenin üç yolu"),
  list(
    [b("Hızlı yarış"), ": boş yeri olan bir odaya oturursun; yoksa yeni bir oda açılır (Arcade, yumuşak temas, 3 tur)."],
    [b("Oda kur"), `: sürüş modelini (Arcade ya da Sim), temas kuralını (hayalet, yumuşak, tam) ve tur sayısını (${F.laps}) sen seçersin. Oda listede görünmesin istersen kodu yalnız arkadaşlarına verirsin.`],
    [b("Kodla katıl"), ": arkadaşının verdiği dört karakterli kodu yaz ya da onun paylaştığı /r/KOD bağlantısını aç."],
  ),
  sub("Gridden ışıklara"),
  steps(
    ["Grid ekranında ", b("Garaj"), "'a gir ve ayarını yap. Her değişiklik bu tarayıcıda hemen saklanır."],
    [b("Hazırım"), "'a bas: ayarın sunucuya gider. Sonradan değiştirirsen ", b("Ayarı güncelle"), " ile yeniden gönder."],
    [`Herkes hazır olunca, oda sahibi başlatınca ya da ilk sürücü girdikten ${R.humanGridS} sn sonra ${R.lightCount} ışık birer birer yanar.`],
    ["Işıklar sönünce yarış başlar. Daha iyi bir kalkış için ", chord(keys, "launch", "throttle"), " ile devri tut (Kalkış bölümü)."],
  ),
  note("tip", `Yarış sürerken katılırsan son sıradaki botun arabasını devralırsın. Bağlantın koparsa ${R.reconnectS} sn içinde aynı arabaya, sıran ve turunla geri dönersin.`),
  note("warn", `${F.idleMin} dakika boyunca ne klavyeye ne gamepad'e dokunursan yarıştan çıkarılır, ana sayfaya dönersin.`),
];

const controls = ({ keys }: BookCtx) => [
  p("Pitlane klavyeyle rahat oynansın diye ayarlandı. Bütün tuşları Ayarlar > Kontroller'den değiştirebilirsin; aşağıdaki tablo senin şu anki tuşlarını gösterir."),
  sub("Klavye"),
  keyTable(keys),
  sub("Gamepad"),
  p(`Standart eşlemeli her gamepad çalışır (Xbox, PlayStation ve benzerleri). Bir tetiğe, tuşa ya da çubuğa dokunduğun an gamepad arabayı alır; ${F.padHoldS} sn hiç dokunmazsan klavye geri gelir.`),
  padTable(),
  sub("Yarış sırasında ayar değiştirmek"),
  p("Dört ayar pistte değiştirilebilir; her basış bir kademe oynatır ve HUD'daki gösterge yeni değeri vurgular. Donanım ayarları (kanatlar, vites, süspansiyon) yalnız garajda değişir."),
  list(
    [pairOf(keys, "bbBack", "bbFwd"), ": fren dengesi %1 arkaya / öne."],
    [pairOf(keys, "diffDown", "diffUp"), ": diferansiyel bir kademe daha açık / daha kilitli."],
    [pairOf(keys, "tcDown", "tcUp"), ": çekiş kontrolü bir seviye azalır / artar (Sim odalarında; Arcade'de sabit)."],
    [pairOf(keys, "absDown", "absUp"), ": ABS bir seviye azalır / artar (Sim odalarında; Arcade'de sabit)."],
    ["Gamepad'de bunu yön tuşları yapar: yukarı / aşağı fren dengesi, sol / sağ çekiş kontrolü. Değişiklik saklanır, sonraki yarış onunla başlar."],
  ),
  sub("Fren ve geri vites"),
  list(
    [keyOf(keys, "brake"), " her zaman frendir."],
    [keyOf(keys, "brakeReverse"), ` araba ileri giderken frendir. Araba durunca (${F.stoppedVX()} m/sn ve altı) geri vitese geçer ve basılı tuttukça geri gidersin; geride en fazla yaklaşık ${F.revKmh} km/sa. HUD'da vites `, b("R"), " olur."],
    ["Gaz basılıyken ", keyOf(keys, "brakeReverse"), " geri vitese geçmez, fren olur. Dururken ikisi birlikte kalkış tutuşudur."],
    ["Geri giderken direksiyon gerçek arabadaki gibidir: arkayı sola atmak için sola çevir."],
  ),
  sub("Kamera ve yardım"),
  p(keyOf(keys, "camera"), " takip ve kokpit kamerası arasında geçer (varsayılanı Ayarlar'dan seçersin). ", keyOf(keys, "lookBack"), " basılıyken arkaya bakarsın. Yarışta ", kbd(`${keysLabel(keys.help)} / ?`), " kontrol kartını açar."),
];

const handling = () => [
  p("Her odanın bir sürüş modeli vardır. Oda kurulurken seçilir ve odadaki herkes için aynıdır; liderlik tablosu en iyi turları iki model için ayrı tutar."),
  sub("Arcade"),
  list(
    [`Lastikler ${F.arcadeGrip()} daha fazla tutar.`],
    [`Çekiş kontrolü hep açıktır. Pay Sim'in 3. seviyesiyle aynıdır (${F.arcadeTC()}), virajın arka lastikte bıraktığı tutuş üzerinden ölçülür.`],
    [`ABS hep açıktır, 1. seviyenin payıyla (${F.arcadeABS()}): her aksın freni virajın ona bıraktığı tutuşun içinde kalır, frenlerken de dönebilirsin.`],
    ["Denge yardımı arabanın kendi etrafında dönmesini sınırlar; direksiyon daha çabuk tepki verir ve hız arttıkça daha az kırılır."],
    ["Direksiyon yardımı: direksiyon sonuna kadar kırılsa bile ön lastiklerin tutuş sınırından fazlası istenmez; direksiyonu daha çok çevirmek burnu dışarı kaydırmaz."],
  ),
  sub("Sim"),
  list(
    [`Normal tutuş; denge yardımı yok. ABS'yi garajda sen seçersin: Kapalı, 1, 2 ya da 3; varsayılan ${F.simDefaultABS()}. Kapalıyken sert frenlerken direksiyon çevirirsen ön lastiklerin bütün tutuşu frene gider ve araba düz gider.`],
    [`Çekiş kontrolünü garajda sen seçersin: Kapalı, 1, 2 ya da 3. Varsayılan ${F.simDefaultTC()}.`],
    ["Direksiyon yardımı: direksiyon sonuna kadar kırılsa bile ön lastiklerin tutuş sınırının biraz altında tutulur; klavyede tam direksiyon burnu dışarı kaydırmaz, arabayı döndürür."],
  ),
  sub("Çekiş kontrolü seviyeleri"),
  p("Çekiş kontrolü (TC), arka lastiğin virajda kullanmadığı tutuşun yalnız bir payını gaza bırakır. Pay küçüldükçe araba daha güvenli, ama daha yavaş hızlanır."),
  tcTable(),
  figure(z100Art(), "0–100 km/sa: varsayılan ayar, düz yolda tam gaz, rölantiden. Sim'de her TC seviyesi ve karşılaştırma için Arcade. Süreler araba modelinin kendisinde ölçülür."),
  sub("ABS seviyeleri"),
  p("ABS, her aksın freninin virajın ona bıraktığı tutuşun yalnız bir payını kullanmasını sağlar; böylece araba yavaşlarken de dönmeye devam eder. Kapalıyken frenler hepsini alabilir: virajda sert frenleyince ön tekerlekler kilitlenir ve araba düz gider, arka kilitlenirse döner."),
  absTable(),
  sub("Klavyeyle ne beklemeli"),
  list(
    [`Klavye tuşu ya hep ya hiçtir: gaz ${F.throttleRampS()} sn'de tama çıkar. TC kapalıyken bu virajda tam gaz demektir; arka kayar ve araba döner.`],
    ["TC 1 lastiği sınırına kadar kullandırır: düzlükte TC kapalıdan biraz yavaştır, ama klavyeyle tam gaz ve tam direksiyonda bile araba dönmez."],
    ["TC 2 ve 3 daha affedicidir; bedelini viraj çıkışında ve düzlükte ödersin."],
    ["Gamepad tetiği gazı kademeli verir; Sim'de düşük TC'yi kullanmak gamepad'le daha kolaydır."],
  ),
];

const garage = () => [
  p("Garajda sekiz ayar var. Her değişiklik bu tarayıcıda saklanır; gridde Hazırım'a bastığında sunucuya gider ve yarış boyunca o ayarla sürersin."),
  setupTable(),
  sub(settingName(0)),
  p("Ön kanat ön lastiklere bastırma kuvveti verir; her kademe biraz da hava direnci ekler."),
  list([b("Artır"), ": burun virajda daha keskin döner."], [b("Azalt"), ": düzlükte biraz daha hızlısın, hızlı virajda önden kayarsın."]),
  sub(settingName(1)),
  p("Arka kanat arkaya bastırma kuvveti verir."),
  list([b("Artır"), ": hızlı virajda arka sağlam durur; düzlükte son hız düşer."], [b("Azalt"), ": son hız yükselir, hızlı virajda arka hafifler."]),
  sub(settingName(2)),
  p("Fren kuvvetinin ön ve arka arasındaki payı: ilk sayı ön."),
  list([b("Öne"), ": frenleme kararlı, ama ön lastikler çabuk doyar ve virajda burun dışarı açılır."], [b("Arkaya"), ": araba frenlerken döner; çok arkaya alırsan arka kayar."]),
  sub(settingName(3)),
  p("Vites oranı: küçük sayı kısa, büyük sayı uzun vites."),
  list([b("Kısa"), ": güçlü ivme; düzlük sonunda devir sınırına erken gelirsin."], [b("Uzun"), ": son hız yükselir, viraj çıkışında ivme azalır."]),
  sub(settingName(4)),
  p("Diferansiyel iki arka tekerleği gazda ne kadar birlikte döndüreceğini belirler: 1 açık, büyük sayı daha kilitli."),
  list([b("Kilitle"), ": çıkışta daha iyi çekiş; ama gazla arka daha kolay dışarı atar."], [b("Aç"), ": virajın içinde daha sakin, çıkışta daha az çekiş."]),
  sub(settingName(5)),
  p("Viraj yükünün ön ve arka aks arasında nasıl paylaşılacağını seçer."),
  list([b("Yukarı"), ": önden kayma; araba geniş açılır ama güvenlidir."], [b("Aşağı"), ": arkadan kayma; araba çevik döner, gazla arka kaçabilir."]),
  sub(settingName(TC)),
  p("Seviyeler ve etkisi Arcade ve Sim bölümünde. Yalnız Sim odalarında senin seviyen geçerlidir; Arcade'de hep 3."),
  list([b("Yükselt"), ": daha güvenli çıkış, daha yavaş ivme."], [b("Düşür"), ": daha hızlı ivme; gazda daha çok özen ister."]),
  sub(settingName(ABS)),
  p("Seviyeler Arcade ve Sim bölümünde. Yalnız Sim odalarında senin seviyen geçerlidir; Arcade'de hep 1."),
  list([b("Yükselt"), ": frenlerken daha kararlı, fren mesafesi daha uzun."], [b("Düşür"), ": daha kısa fren mesafesi, ama tekerlek kilitlenebilir; Kapalı temiz bir çizgi ister."]),
  p("Fren dengesi, diferansiyel, çekiş kontrolü ve ABS yarışırken de değiştirilebilir (bkz. Kontroller)."),
  note("tip", "Emin olmadığında Varsayılana dön: varsayılan ayar dengeli bir başlangıçtır. Bir seferde tek ayarı değiştir, farkı hisset."),
];

const race = () => [
  sub("Evreler"),
  list(
    [b("Grid"), `: sürücüler ayarını yapıp hazır olur. Herkes hazır olunca, oda sahibi başlatınca ya da ilk sürücüden ${R.humanGridS} sn sonra ışıklara geçilir.`],
    [b("Işıklar"), `: ${R.lightCount} ışık ${R.lightS} sn arayla yanar, sonra hepsi birlikte söner.`],
    [b("Yarış"), `: ${F.laps} tur. İlk tur gridden başlar; grid çizginin arkasındadır.`],
    [b("Bitiş"), `: ilk araba yarışı bitirince diğerleri içinde bulundukları turu tamamlar; en fazla ${R.finishWindowS} sn.`],
    [b("Sonuçlar"), `: tablo ${R.resultsS} sn görünür; sonra grid yeniden kurulur ve hasar onarılır.`],
  ),
  figure(lightsArt(), "Işıklar birer saniye arayla yanar; hepsi sönünce yarış başlar."),
  sub("Erken kalkış"),
  p(`Işıklar yanarken araban grid yerinden ${R.jumpStartM} m'den fazla kıpırdarsa toplam süreye ${R.jumpStartPenS} sn ceza eklenir. Fren basılıyken gaz vermek (kalkış tutuşu) arabayı kıpırdatmaz, ceza değildir.`),
  p(`Erken kalktığın anda kırmızı bir bant, "${F.jumpBanner()}", birkaç saniye görünür ve ${F.jumpBadge()} rozeti yarışın sonuna kadar HUD'da kalır; diğer sürücüler adınla kısa bir satır görür. Ceza sonuç tablosunda da görünür.`),
  sub("Turlar, sektörler ve geçerlilik"),
  list(
    ["Tur üç sektöre bölünür. HUD'da mor: odanın en hızlısı, yeşil: kendi en iyin, sarı: daha yavaş."],
    [`Dört tekerlek birden pist dışındayken geçen süre ${R.offTrackS} sn'yi aşarsa tur geçersiz olur: yarışta sayılır, ama en iyi tura ve liderlik tablosuna girmez. HUD "PİST DIŞI" diye uyarır.`],
    ["Ters yöne gidersen HUD \"TERS YÖN\" der; çizgiyi geriye geçmek tur saymaz."],
  ),
  sub("Görevliler"),
  p(`Araban sürülemez durumda kalırsa (pistin dışında ya da piste ${R.drivableDeg}°'den fazla açıyla) ve ${R.resetS} sn boyunca ${R.resetSpeed} m/sn'den yavaşsa görevliler onu yarış çizgisine, yola bakacak şekilde koyar; gerekirse ${R.dropBackM} m'ye kadar geriye. Arkadan trafik geliyorsa en fazla ${R.holdMaxS} sn bekler. Kaybettiğin zaman cezandır; çoğu zaman geri vitesle kendin kurtulmak daha hızlıdır.`),
  sub("Sonuçlar ve istatistikler"),
  list(
    ["Bitirenler tamamladıkları tur ve cezalı toplam süreye göre sıralanır; bitiremeyenler DNF olur."],
    [`Kimse bitiremezse yarış tur sayısı × ${F.lapCapMin} dakikada sona erer.`],
    ["İstatistiklerin: yarış, galibiyet, podyum, tur ve her sürüş modeli için ayrı en iyi geçerli tur; bu hafta ve tüm zamanlar. Bir botu devraldıysan yalnız kendi sürdüğün kısım sayılır."],
  ),
];

const contact = () => [
  p("Oda kurulurken üç temas kuralından biri seçilir; hızlı yarış yumuşak temasla açılır."),
  list(
    [b("Hayalet"), ": arabalar birbirinin içinden geçer. Bariyerler yine durdurur."],
    [b("Yumuşak"), ": arabalar gerçek gövde ölçüsüyle (5,4 × 1,9 m) itişir ve temas sürdükçe ikisi de biraz hız kaybeder; hasar yok."],
    [b("Tam"), ": gerçek çarpışma. Arabalara ve bariyerlere vurmak hasar verir."],
  ),
  sub("Hasar"),
  list(
    ["Darbe arabanın ön üçte birine gelirse ön kanada, arka üçte birine gelirse arka kanada, ortasına gelirse süspansiyona yazılır. Hafif sürtünmeler hasar vermez."],
    [`Ön kanat hasarı önün bastırma kuvvetini azaltır. Hasar sınırı aşınca kanat kopar (sınır: ${F.wingLost()}); önde kalan bastırma kuvveti: ${F.lostWingCL()}. Araba virajda önden kayar; HUD "Ön kanadın koptu!" der.`],
    ["Arka kanat hasarı arkanın bastırma kuvvetini azaltır: hızlı virajlarda arka hafifler."],
    [`Süspansiyon hasarı tutuşu en fazla ${F.suspLoss()} düşürür.`],
    ["Hasar yarış boyunca kalır; grid yeniden kurulunca araba onarılır."],
  ),
  note("tip", "Tam temasta frene erken bas: arkadan vurmak senin ön kanadına, öndekinin de arka kanadına hasar yazar."),
];

const launch = ({ keys }: BookCtx) => [
  p("Kalkış, ışıklar sönerken motoru doğru devirde tutup arabayı bir anda bırakmaktır. Fren arabayı yerinde tutar, böylece ceza almadan devri hazırlarsın."),
  sub("Nasıl yapılır"),
  steps(
    ["Işıklar yanarken ", chord(keys, "launch", "throttle"), " (ya da ", chord(keys, "brake", "throttle"), ") basılı tut. Frenler arabayı tutar; motor yaklaşık ", `${F.launchRevS()} sn'de ${F.launchRPM} devre çıkar ve orada kalır. HUD'da `, b("KALKIŞ"), " yazar, devir çubuğu yeşile döner."],
    ["Işıklar sönünce ", keyOf(keys, "launch"), " (ya da ", keyOf(keys, "brake"), ") tuşunu bırak, ", keyOf(keys, "throttle"), " basılı kalsın."],
    [`Debriyaj kayar: motor devri tekerleklerinkine inene kadar (en geç ${F.launchEndKmh} km/sa) çekiş kontrolü lastiği sınırına kadar kullandırır.`],
    ["Gamepad'le: dururken A'yı basılı tut ve RT'ye bas; ışıklar sönünce A'yı bırak."],
  ),
  sub("Neden"),
  p("Kalkış, ilk metrelerde çekiş kontrolünün kestiği gücü geri verir. Kazanç sürüş moduna ve TC seviyesine bağlı:"),
  launchTable(),
  list(
    ["Arcade ve Sim'de TC 2–3: kalkış her startta zaman kazandırır."],
    ["Sim'de TC 1: TC zaten lastiği sınırına kadar kullandırdığı için kalkış ek bir şey kazandırmaz, zararı da yoktur."],
    ["Sim'de TC kapalı: kazanç yok; düzlükte en hızlısı budur, ama klavyeyle virajda tam gaz arkayı kaydırır."],
  ),
  note("tip", "Sol Shift'i basılı tut ya da ", chord(keys, "brake", "throttle"), " kullan: Windows'ta Sağ Shift'i 8 saniye kadar basılı tutmak Filtre Tuşları'nı açabilir."),
  note("warn", `Işıklar yanarken frensiz gaz verirsen araba kıpırdar: ${R.jumpStartM} m sonra ${R.jumpStartPenS} sn ceza. Tablodaki süreler araba modelinde varsayılan ayarla ölçülür; yaklaşık ${F.launchRevS()} sn'lik devir hazırlığı dahil değildir.`),
];

export const TR_BOOK: Record<ChapterName, ChapterBody> = { start, controls, handling, garage, race, contact, launch };
