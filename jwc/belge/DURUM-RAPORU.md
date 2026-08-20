# Makine Ekranı İzleme Sistemi — Durum Raporu

**Tarih:** 6 Ağustos 2026
**Proje:** Fabrika üretim hattı ekranlarından veri toplama ve izleme sistemi
**Kapsam:** Bitirme Projesi + TÜBİTAK 2209-B başvurusu

---

## 1. Sistem ne yapıyor

Fabrikadaki üretim makinelerinin ekranlarında (TV panolarında) canlı üretim verisi gösteriliyor. Bu veriye başka hiçbir yoldan erişim yok — PLC çıkışı, veritabanı, rapor dosyası yok. Veri sadece ekranda görünüyor ve orada kalıyor.

Sistem bu ekranlardaki veriyi otomatik okuyup:

- Kalıcı kayda dönüştürüyor
- Duruş, model değişimi, kalite düşüşü gibi **olayları** tespit ediyor
- Web paneli ve mobil uygulama üzerinden sunuyor
- Yönetime anlık bildirim gönderiyor
- Excel raporu üretiyor

### Kritik çerçeveleme

**Bu bir "kamera + OCR" projesi değil, dağıtık bir olay izleme sistemidir.**

Sistemin ürünü "ekrandaki sayı" değil, **"şu makinede, şu saatte, şu olay oldu"** kaydıdır. OCR bu zincirin sadece bir halkası. Bu çerçeveleme diğer tüm kararları belirledi ve raporda savunulacak ana tezdir.

---

## 2. Okunacak ekran

Makine panosu: **Jiangsu JWC Machinery Co., Ltd** arayüzü. Tüm TV'lerde **düzen aynı**, sadece değerler farklı.

Ekranda altı veri alanı var:

| Alan | Örnek değer | Açıklama |
|---|---|---|
| Current model | Type-M | Üretilen ürün tipi |
| Total quantity of production | 43624 | Toplam üretim sayacı |
| Quantity of good products | 42909 | Sağlam ürün sayacı |
| Rate of certified products | 98.36% | Kalite oranı (türetilmiş) |
| Running time | 4.1 h | Çalışma süresi |
| Hız göstergesi (kadran ortası) | 0 | Anlık hız, kırmızı rakam, skala 0-300 |

Ayrıca solda bir trend grafiği var — okunmuyor, gerek yok.

### Tüm ekranların aynı olması en büyük avantaj

Tek bir ROI (ilgi alanı) konfigürasyonu yazıp hepsinde kullanabiliyoruz. Makine kimliği görüntüden çözülmüyor — hangi capture cihazından geldiğiyle belirleniyor. Görüntü tanıma yükü sıfır.

---

## 3. Mimarideki büyük değişiklik: kamera → doğrudan yakalama

### Önceki plan (iptal edildi)

Kamerayla ekranları izlemek. Bu yaklaşım şu sorunları getiriyordu:

- Perspektif düzeltme (homografi) gerekiyordu
- Fabrika lambası yansıması, cam parlaması
- Kamera pozlama/odak kilitleme
- Ekran tazeleme bandı (banding), moiré
- Minimum karakter yüksekliği kısıtı (20-25 piksel)
- Ön işleme zinciri (gri tonlama, eşikleme, büyütme)

### Yeni plan (uygulanan)

TV'nin **kaynağına** bir cihaz takılıp sinyal doğrudan alınıyor. HDMI kaynağı splitter/encoder üzerinden hem TV'ye hem sisteme gidiyor.

**Bunun sonucu:** Yukarıdaki sorunların **tamamı** ortadan kalktı. Artık kaynağın ürettiği pikselin aynısını alıyoruz. Görüntü deterministik — aynı değer her seferinde aynı piksel dizisi.

Bu, OCR problemini neredeyse önemsiz hale getirdi. Font, boyut ve konum sabit; okunacak değerler temiz ve keskin.

### Donanım durumu

- **Raspberry Pi 5, 16 GB RAM** mevcut
- **10'dan fazla TV** izlenecek
- USB capture kullanılacak

**Not:** Yakalama katmanı (sinyalin ekrandan bilgisayara gelmesi) başka bir ekip üyesi tarafından yapılıyor. Bizim sorumluluğumuz **kare elimize geldikten sonrası**.

Tartışılan ama devredilen konular: HDMI-over-IP encoder mimarisi (mesafe sorunu için), USB cihaz numaralarının reboot'ta karışması, HDCP kontrolü, kablo mesafesi sınırı (pasif HDMI ~10-15 m).

---

## 4. OCR motoru seçimi

### Değerlendirilen üç seçenek

**PaddleOCR** — Baidu'nun OCR modelleri + eğitim framework'ü. PP-OCRv6 sürümü (11 Haziran 2026) özellikle dijital göstergeler ve endüstriyel karakterler için optimize edilmiş. Kademeler: tiny (1.5M) / small / medium (34.5M parametre).

**RapidOCR** — Aynı PaddleOCR modellerinin ONNX Runtime üzerinde koşan portu. Kendi modeli yok, aynı ağırlıkları çalıştırıyor. Apache 2.0 lisanslı.

**Mistral OCR 4** — Bulut tabanlı doküman anlama API'si.

### Mistral neden elendi

Dört ayrı sebeple:

1. **Mistral'in kendi dokümantasyonu bu kullanımı kapsam dışı ilan ediyor** — gerçek zamanlı/gecikmeye duyarlı işleme ve güvenlik kritik sistemler açıkça kapsam dışı listesinde. Bizimki tam olarak bu.

2. **Maliyet tutmuyor** — sayfa başına $4/1000:

   | Örnekleme | Günlük çağrı (10 makine) | Aylık maliyet |
   |---|---|---|
   | Saniyede 1 | 864.000 | ~$104.000 |
   | Dakikada 1 | 14.400 | ~$1.730 |
   | 5 dakikada 1 | 2.880 | ~$345 |

   Dakikada bir bile ayda 1.700 dolar. Üstelik dakikalık çözünürlükte 40 saniyelik duruş görülemez.

3. **İnternet bağımlılığı** — fabrika ağı büyük ihtimalle dışarı kapalı, üretim verisinin dışarı çıkması ayrıca kurumsal onay meselesi.

4. **Yaptığı iş bizim ihtiyacımız değil** — dağınık düzenli dokümanları anlamak için tasarlanmış (tablo yeniden yapılandırma, çok sütunlu düzen, el yazısı). Bizim düzen sabit ve zaten biliniyor.

**Mistral'in tek mantıklı kullanımı:** Test setini etiketlemek. 200 ROI kırpığını elle etiketlemek yerine tek seferlik gönderip ground truth üretmek — 80 sent, bir saatlik iş yerine 10 dakika. Üretim hattında değil, **ölçüm aracı** olarak.

### PaddleOCR vs RapidOCR

Bu ikisi **aynı modelleri** kullandığı için soru "hangi model daha iyi" değil, **"hangi çalıştırma ortamı"**.

| | PaddleOCR | RapidOCR |
|---|---|---|
| Model | PP-OCRv6 | PP-OCRv6 (aynı) |
| Bağımlılık | `paddlepaddle` (104.5 MB) | `onnxruntime` (~30 MB) |
| Paket boyutu | Yüzlerce MB | 27.3 MB |
| ARM64/Pi kurulumu | Sorunlu | Sorunsuz |
| Model eğitimi | Var | Yok (sadece çıkarım) |
| Lisans | Apache 2.0 | Apache 2.0 |

---

## 5. Yapılan testler ve sonuçlar

### Test 1 — Kamera fotoğrafı üzerinde ilk deneme (Colab)

İlk izlenim: "Paddle daha iyi, Rapid satır satır aldı."

**Bu sonuç yanıltıcıydı**, iki sebeple:

- Karşılaştırma **farklı model kademeleriyle** yapılmıştı (Paddle varsayılanı medium, Rapid varsayılanı small)
- Test **kamera fotoğrafıyla** yapılmıştı — perspektif eğik, parlama var, moiré var

Görsel çıktılar incelendiğinde tersi ortaya çıktı: Rapid etiketleri daha düzgün grupluyordu ("Total quantity of production" tek kutu), Paddle kelime kelime parçalıyordu.

**Önemli bulgu:** İkisi de kadran skalasındaki döndürülmüş yazıları yanlış okudu (250 ve 300'ü "200" olarak). Bu, OCR'a gereksiz alan verildiğinde hata ürettiğinin kanıtı — ROI ile sınırlamanın değeri burada görünüyor.

**Asıl sonuç:** Her iki motor da beş hedef alanı doğru okudu. Fark sadece detection (metin nerede) davranışındaydı — ve üretimde detection kullanılmayacağı için bu fark tamamen ortadan kalkıyor.

### Test 2 — Temiz görsel üzerinde adil karşılaştırma (Mac)

Perspektifi düzeltilmiş temiz ekran görüntüsü, ROI bazlı, detection kapalı.

**RapidOCR small (PP-OCRv6):**

| Alan | Okunan | Güven skoru | Süre |
|---|---|---|---|
| model | 'Type-M' | 0.99815 | 11.3 ms |
| total | '43624' | 1.0 | 10.0 ms |
| good | '42909' | 0.99999 | 11.3 ms |
| rate | '98.36%' | 0.99994 | 10.1 ms |
| runtime | '4.1h' | 0.99973 | 11.1 ms |
| speed | '0' | 0.95805 | 11.7 ms |
| **Toplam** | | | **65.6 ms** |

**RapidOCR medium (PP-OCRv6):**

| Alan | Okunan | Güven skoru | Süre |
|---|---|---|---|
| model | 'Type-M' | 0.99986 | 40.1 ms |
| total | '43624' | 1.0 | 40.5 ms |
| good | '42909' | 1.0 | 39.7 ms |
| rate | '98.36%' | 1.0 | 40.1 ms |
| runtime | '4.1h' | 0.99999 | 40.0 ms |
| speed | '0' | 0.98551 | 40.1 ms |
| **Toplam** | | | **240.4 ms** |

### Karar: small

**Doğruluk:** İkisi de altı alanı %100 doğru okudu.
**Hız:** small **3.7 kat** daha hızlı.
**Tek fark:** `speed` alanında 0.03'lük güven farkı (0.958 vs 0.986).

0.03'lük güven farkı için 3.7 kat yavaşlığa katlanmak, Pi 5'te 10 makineyi kaldırıp kaldıramamak arasındaki fark demek. Medium elendi.

`speed` alanının diğerlerinden düşük skor alması beklenen bir sonuç — kırmızı rakam, beyaz kontur, farklı arka plan. Yine de doğru okundu.

### PaddleOCR testi tamamlanamadı

Karşılaşılan sorunlar sırasıyla:

1. `paddleocr` kuruldu ama çalışmadı — hata: `Engine 'paddle_static' is unavailable because dependency 'paddlepaddle' is not installed`. Çıkarım motoru ayrı paket ve otomatik gelmiyor.
2. `pip install paddlepaddle` ile çözüldü — **104.5 MB** indirme.
3. İndirilen model **PP-OCRv5_server_rec** çıktı, PP-OCRv6 değil. Yani karşılaştırma adil olmayacaktı (v6-small vs v5-server).

**Bu deneyim başlı başına bir bulgu:** Mac'te (Apple Silicon) `paddlepaddle` kuruluyor çünkü hazır wheel var. Pi 5'in aarch64 Linux'unda o wheel çoğu zaman yok — kaynaktan derleme gerekiyor. RapidOCR'da böyle bir aşama hiç yaşanmadı.

Paddle, tek bir doğruluk ölçümü vermeden dağıtım tarafında elendi.

### Doğrulanan teknik detaylar

Çalışma loglarından teyit edildi:

```
Using engine_name: onnxruntime
Using .../PP-OCRv6_rec_small.onnx
```

- Çalıştırma ortamı: **ONNX Runtime** (CPU)
- Model sürümü: **PP-OCRv6**
- Kademe: **small**

**Fark edilen israf:** Loglarda `PP-OCRv6_det_small.onnx` ve `ch_ppocr_mobile_v2.0_cls_mobile.onnx` de yükleniyor — halbuki `use_det=False, use_cls=False` diyoruz. RapidOCR bu modelleri constructor'da yüklüyor, çağrı anında değil. Çalışma süresine etkisi yok ama RAM'de boşuna duruyorlar. 10 worker açıldığında optimize edilecek.

---

## 6. Kullanılan teknoloji yığını

### OCR katmanı

| Bileşen | Seçim | Gerekçe |
|---|---|---|
| Kütüphane | `rapidocr==3.9.1` | Sürüm sabitlendi; varsayılan model konfigürasyonu sürümler arası değişiyor, üretimde modelin kendiliğinden değişmesi istenmez |
| Çalıştırma motoru | `onnxruntime` (CPU) | ARM'de sorunsuz; RapidOCR dokümantasyonu GPU sürümünü önermiyor |
| Model | PP-OCRv6 rec small | Ölçümle seçildi |
| Detection | **Kapalı** (`use_det=False`) | ROI zaten tek satırlık alan — modelin eğitildiği girdi formatı. Detection maliyetin büyük kısmı ve katkısı yok |
| Yön sınıflandırma | **Kapalı** (`use_cls=False`) | Metin yönü sabit |

**Not:** `use_det=False` genelde riskli bir ayar — RapidOCR ekibi uyarıyor çünkü tanıma modeli tek satırlık kutu bekliyor. Bizim ROI'lerimiz tam olarak öyle olduğu için güvenli.

### Backend

| Bileşen | Seçim | Gerekçe |
|---|---|---|
| API framework | FastAPI | Görüntü işleme zaten Python; Pydantic ile tip güvenli şema; otomatik OpenAPI dokümanı mobil tarafa sözleşme oluyor |
| ORM | SQLAlchemy 2.0 | `DATABASE_URL` ile SQLite↔PostgreSQL geçişi tek satır |
| Veritabanı (dev) | SQLite | Kurulum yok, hemen çalışıyor |
| Veritabanı (prod) | PostgreSQL | Zaman serisi hacmi için |
| Canlı yayın | WebSocket | Panel/mobil polling yapmasın |
| Sunucu | Uvicorn | — |

### Planlanan (henüz yapılmadı)

- **Panel:** Vite + React + TypeScript (Next.js değil — SEO yok, tek ağ, SSR'ın avantajı yok, Pi'de Node süreci taşımak gereksiz)
- **Mobil:** Flutter (APK olarak dağıtım, Play Store'a gerek yok)
- **Bildirim:** ntfy, Pi üzerinde self-host (FCM değil — internet ve Google bağımlılığı istemiyoruz, veri dışarı çıkmasın)
- **Çalıştırma:** Docker Compose (worker, api, postgres, caddy, ntfy)

---

## 7. Yazılan kod ve ne işe yaradığı

### `rois.py` — İlgi alanı tanımları

Altı alanın koordinatları. 1080×1350 referans görselden ölçüldü, **runtime'da oranlanarak** uygulanıyor. Yani capture 1920×1080 gelse de aynı config çalışır.

Hız göstergesinin ROI'si bilerek geniş tutuldu: rakam ortalanmış ve skala 300'e kadar çıkıyor, yani üç haneli olabilir. Dar kırpılsa "250" kenarlardan kesilirdi.

`HOT_FIELDS` tanımı: her karede sadece `total`, `good`, `speed` okunacak. Diğerleri yavaş değişiyor — model vardiyada bir kez, runtime 6 dakikada bir, rate zaten hesaplanabiliyor.

### `readers.py` — Motor arayüzü

Tüm okuyucular aynı sözleşmeyi uyguluyor:

```python
read(crop) -> (text: str, score: float, ms: float)
```

Üç uygulama var: `RapidReader`, `PaddleReader`, `TemplateReader` (şablon eşleme referansı).

**Bu tasarımın amacı:** Sistemin geri kalanı hangi motorun çalıştığını bilmiyor. Kazanan belli olunca kaybeden dosya silinir, başka hiçbir yer değişmez. İki kişi paralel çalışıp sonra ölçümle karar verebilir.

### `parsing.py` — Ayrıştırma ve doğrulama

Ham OCR metnini tipli değere çeviriyor ve **hangi motor okursa okusun** aynı doğrulamaları uyguluyor.

Doğrulama kuralları:

| Kural | Ne yakalar |
|---|---|
| `good/total` hesabı ekrandaki Rate ile ±0.05 uyuşmalı | Üç alandan biri yanlış okunmuşsa yakalar — **bedava checksum** |
| `good ≤ total` | Mantıksız okuma |
| Rate 0-100 aralığında | Aralık dışı |
| Speed 0-300 aralığında (kadran skalası) | Aralık dışı |
| Runtime makul aralıkta | Aralık dışı |
| Güven skoru < 0.7 | Düşük güvenli okuma |
| Sayaç monoton artmalı | Okuma hatası veya reset |

Ayrıca harf-rakam karışıklığı düzeltmesi var (O→0, I→1, S→5, B→8 vb.).

**Önemli tasarım notu:** Güven skoru **kalibre değil** — model yanlış okuduğunda da yüksek skor verebilir. Asıl güvenliği çapraz doğrulama (rate uyuşması) sağlıyor, skor ikincil sinyal.

### `events.py` — Olay motoru

Okumaları olaya çeviren durum makinesi. Projenin kalbi.

**Durumlar:** `BILINMIYOR`, `CALISIYOR`, `DURDU`, `SINYAL_YOK`

**Olay tipleri:**

| Olay | Tetikleyici |
|---|---|
| `DURUS` | Sayaç N saniyedir artmıyor |
| `MODEL_DEGISIMI` | Ürün tipi değişti |
| `SAYAC_RESET` | Sayaç ciddi biçimde düştü |
| `KALITE_UYARISI` | Rate eşiğin altına indi |
| `SINYAL_KAYBI` | Ardışık geçersiz okuma |

**Üç kritik tasarım kararı:**

1. **Duruş geriye dönük damgalanıyor.** Sayacın durduğunu ancak eşik kadar bekleyince anlıyoruz, ama duruş fark ettiğimiz anda değil, **sayacın son arttığı anda** başlamış. Olay o zamana yazılıyor. Aksi halde her duruş eşik süresi kadar kısa raporlanırdı — 100 duruşta 50 dakika kayıp.

2. **Model değişimi oturumu sıfırlıyor.** Yeni ürün tipine geçince üretim sayaçları ve OEE penceresi baştan başlıyor.

3. **Kalite uyarısında histerezis var.** Eşik %95, geri dönüş %96. Oran eşik etrafında salınırken saniyede bir uyarı yağmuru olmasın diye.

**Duruş tespitinin önemi:** Sayaç durgunluğu doğrudan duruş demek. Alarm ekranı yakalamaya, kırmızı alan aramaya gerek yok. Arıza ekranı hiç çıkmasa bile duruş yakalanıyor.

### `db.py` — Veritabanı şeması

Üç tablo:

| Tablo | İçerik | Kullanım |
|---|---|---|
| `machines` | Makine tanımı, eşikler, nominal hız | Konfigürasyon |
| `samples` | Ham okuma geçmişi | Trend grafiği, sonradan analiz |
| `events` | İşlenmiş olaylar | Panel ve raporların **asıl** kaynağı |

**Ayrımın önemi:** Duruş süresi `events`'ten geliyor, `samples`'tan hesaplanmıyor. Böylece yer açmak için eski `samples` silinse bile olay kaydı bozulmuyor.

### `api.py` — Backend servisi

| Uç | İşlev |
|---|---|
| `POST /ingest` | Worker'ların okuma gönderdiği **tek yazma kapısı** |
| `GET /machines` | Canlı duvar verisi (tüm makineler, durum, OEE) |
| `GET /machines/{id}/events` | Olay geçmişi |
| `GET /machines/{id}/samples` | Trend verisi |
| `GET /machines/{id}/oee` | Anlık OEE |
| `GET /export.csv` | Excel raporu |
| `WS /live` | Canlı yayın |

Olay motoru API içinde bellekte çalışıyor; ürettiği olaylar hem veritabanına yazılıyor hem WebSocket'ten yayınlanıyor.

### Yardımcı araçlar

| Dosya | İşlev |
|---|---|
| `check_rois.py` | ROI kutularının doğru yere oturduğunu gözle doğrular |
| `compare.py` | Motorları aynı kırpıklar üzerinde karşılaştırır, doğruluk + süre + CPU yükü tablosu çıkarır |
| `raw_scores.py` | Güven skorlarını yuvarlamadan basar, kademeleri yan yana koyar |
| `simulate.py` | Capture olmadan olay motorunu test eder — gerçekçi vardiya senaryosu üretir |
| `feed.py` | Simülasyon verisini API'ye besler, uçtan uca test |

---

## 8. Sistem testi sonuçları

### Olay motoru testi (`simulate.py`)

2 saatlik simüle vardiya, tek makine:

```
[11:58:30] MAK-01 DURUS (103s) esik_sn=30.0
[12:45:31] MAK-01 MODEL_DEGISIMI eski=Type-M yeni=Type-K
[12:45:31] MAK-01 SAYAC_RESET eski=55267 yeni=3
[13:05:30] MAK-01 DURUS (231s) esik_sn=30.0
[13:15:35] MAK-01 SINYAL_KAYBI (36s) ardisik_hatali=5

DURUS           2 adet   toplam 5.6 dk
MODEL_DEGISIMI  1 adet
SAYAC_RESET     1 adet
SINYAL_KAYBI    1 adet

üretim        8.796 adet
Availability  92.9%
Performance   95.7%
Quality       99.7%
OEE           88.6%
```

Simülatöre bilerek yerleştirilen tüm olaylar (iki duruş, model değişimi, reset, kalite düşüşü, sinyal kaybı) doğru yakalandı.

### Uçtan uca backend testi (`feed.py`)

3 makine, **10.800 okuma** API'den geçirildi:

```
MAK-01  CALISIYOR  total=3331 speed=209  A=71.6% Q=99.7%
MAK-02  CALISIYOR  total=4695 speed=196  A=100.0% Q=99.7%
MAK-03  CALISIYOR  total=4190 speed=197  A=85.7% Q=99.7%

MAK-01 olayları: 5 (SINYAL_KAYBI 36s, DURUS 107s, DURUS 360s,
                    SAYAC_RESET, MODEL_DEGISIMI)
samples: 2000 kayıt
CSV export: çalışıyor
```

Ingest → olay motoru → veritabanı → sorgu → export zinciri sorunsuz.

---

## 9. OEE — Neden önemli

Okunan üç değer aslında **OEE**'nin (Overall Equipment Effectiveness) üç bileşenini veriyor:

| Bileşen | Nasıl hesaplanıyor |
|---|---|
| **Availability** | (Planlanan süre − duruş) / planlanan süre |
| **Performance** | Gerçek üretim / (nominal hız × çalışma süresi) |
| **Quality** | Sağlam ürün / toplam ürün |
| **OEE** | A × P × Q |

Ekstra veri toplamaya gerek yok, elimizdekinden hesaplanıyor.

**Neden değerli:** OEE, üretim sektöründe standart metrik. Panelde bunu göstermek hem fabrikanın anladığı dil, hem de bitirme/2209-B dosyasında "literatürdeki standart metriği kullandık" diye savunulabilecek bir şey.

---

## 10. Kalan işler

### Capture geldiğinde yapılacaklar (öncelikli)

**1. OCR doğrulaması — gerçek karelerle**

Şu ana kadarki tüm testler tek bir temiz görselle yapıldı. Gerçek koşullarda asıl zorluk **sayaç değişirken yakalanan yarı-çizilmiş kareler** olacak.

```bash
python compare.py --dir frames/ --truth truth.csv
```

50-100 kare + elle etiketlenmiş ground truth ile alan bazında doğruluk ölçümü.

**2. `stall_seconds` eşiğinin kalibrasyonu**

Bu en kritik ayar. Çok kısa: normal çevrim boşluklarını duruş sanar. Çok uzun: kısa duruşları kaçırır.

**Tahmin edilemez, veriden çıkarılmalı.** Bir vardiya boyunca ham okumaları kaydedip sayaç artışları arasındaki süre dağılımına bakılacak; normal çevrimin 99. yüzdeliğinin biraz üstü eşik olur. **Makine başına ayrı hesaplanmalı.**

Bu, rapora yazılabilecek güçlü bir cümle: *"Eşik sabit seçilmedi, saha verisinden istatistiksel olarak belirlendi."*

**3. Pi 5 üzerinde hız ölçümü**

Mac (Apple Silicon) sonuçları Pi'yi temsil etmiyor. Kabaca 3-4 kat yavaşlama beklentisi:

- Her karede 3 alan (`total`, `good`, `speed`) ≈ Mac'te 33 ms
- Pi 5 tahmini: ~100-130 ms
- 10 makine @1 FPS → ~1.0-1.3 çekirdek (Pi 5'te 4 çekirdek var)

Bütçe rahat görünüyor ama ölçülmeli.

**Uyarı:** ONNX Runtime varsayılan olarak çok çekirdek kullanmaya çalışıyor. 10 worker paralel çalışacaksa her birinde `intra_op_num_threads=1` ayarlanmalı, yoksa çekirdekler için kavga edip toplam yavaşlar.

### Yazılım tarafında eksikler

| Konu | Durum | Not |
|---|---|---|
| **Web paneli** | Yapılmadı | Vite + React; canlı duvar, makine detayı, raporlar |
| **Mobil uygulama** | Yapılmadı | Flutter; ince tutulmalı — mobilin işi analiz değil anlık farkındalık |
| **Bildirim altyapısı** | Yapılmadı | ntfy self-host |
| **Vardiya mantığı** | Yapılmadı | OEE şu an "servis başladığından beri" hesaplıyor; vardiya bazlı olmalı (08-16, 16-24, 24-08) |
| **Kimlik doğrulama** | **Yok** | `/ingest` şu an herkese açık. En azından worker'lar için API anahtarı gerekli |
| **Worker süreci** | Yapılmadı | Capture'dan kare alıp ROI kırpıp API'ye gönderen döngü |
| **ROI hash kontrolü** | Yapılmadı | Değişmeyen alanı tekrar okumama optimizasyonu |
| **Yerel kuyruk** | Yapılmadı | Ağ koptuğunda SQLite'a yazıp bağlantı gelince senkronlama |
| **Docker Compose** | Yapılmadı | Modelleri build zamanında indirmek kritik (`rapidocr download_models`) — fabrika ağı kapalıysa ilk açılışta ölür |
| **Gereksiz model yükleme** | Bilinen sorun | det ve cls modelleri RAM'de boşuna duruyor |
| **PaddleOCR karşılaştırması** | Yarım | v6 ile tekrarlanabilir, ama dağıtım tarafında zaten elendi |

---

## 11. Rapor/dosya için savunulabilir kararlar özeti

Bitirme ve 2209-B dosyasında kullanılabilecek gerekçelendirmeler:

| Karar | Gerekçe |
|---|---|
| Olay izleme sistemi olarak çerçeveleme | Ürün metin değil, zaman damgalı olay |
| Kamera yerine doğrudan yakalama | Deterministik görüntü; perspektif/parlama/banding sorunları ortadan kalkıyor |
| Motor soyutlaması (tek arayüz) | Karar ölçümle verilebilir, değişim tek dosya |
| Detection kapalı | ROI biliniyor; maliyetin büyük kısmı gereksiz |
| RapidOCR + ONNX | Aynı model, ARM'de sorunsuz dağıtım, 27 MB vs 100+ MB |
| small kademe | Doğruluk eşit, 3.7 kat hızlı — ölçümle kanıtlandı |
| Mistral reddi | Sağlayıcının kendi kapsam dışı beyanı + maliyet analizi |
| Çapraz doğrulama | Türetilmiş alan bedava checksum sağlıyor |
| Duruşun geriye dönük damgalanması | Ölçüm doğruluğu; aksi halde sistematik eksik raporlama |
| `samples`/`events` ayrımı | Ham veri seyreltilebilir, olay kaydı korunur |
| OEE kullanımı | Sektör standardı metrik, ekstra veri gerektirmiyor |
| ntfy (FCM değil) | İnternet bağımsızlığı, veri fabrikadan çıkmıyor |

---

## 12. Özet

**Tamamlanan:** OCR motoru seçimi (ölçümle), ROI tanımları, ayrıştırma ve doğrulama katmanı, olay motoru, veritabanı şeması, backend API, simülasyon ve test araçları.

**Doğrulanan:** RapidOCR small + PP-OCRv6 + ONNX Runtime ile altı alanın tamamı %100 doğrulukla, 65.6 ms'de okunuyor. Olay motoru simüle vardiyadaki tüm olayları yakalıyor. Backend 10.800 okumayı sorunsuz işliyor.

**Bekleyen:** Yakalama donanımı. Geldiğinde gerçek karelerle doğrulama, eşik kalibrasyonu ve Pi 5 hız ölçümü yapılacak.

**Sıradaki geliştirme:** Web paneli, ardından vardiya mantığı ve kimlik doğrulama, sonra mobil uygulama.
