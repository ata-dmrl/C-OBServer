# JWC Hat İzleme Sistemi

Üretim makinelerinin ekranlarındaki canlı veriyi otomatik okuyup kalıcı
kayda dönüştüren, duruş ve kalite olaylarını tespit eden izleme sistemi.

Makinelerde PLC çıkışı, veritabanı ya da rapor dosyası yok — veri sadece
operatör panosunda görünüyor ve orada kalıyor. Bu sistem o veriyi HDMI
üzerinden yakalayıp okunabilir hale getiriyor.

---

## Çerçeveleme

**Bu bir "kamera + OCR" projesi değil, dağıtık bir olay izleme sistemidir.**

Sistemin ürünü "ekrandaki sayı" değil, **"şu makinede, şu saatte, şu olay
oldu"** kaydıdır. OCR bu zincirin sadece bir halkası. Bu çerçeveleme diğer
bütün mimari kararları belirledi.

---

## Mimari

```
Makine panosu (HDMI)
      │
      ▼
USB Capture (MacroSilicon MS2109)
      │
      ▼
Raspberry Pi                          ../raspberry-pi/saha/  (ayrı klasör)
  GStreamer tee ─┬─ kmssink           TV'ye görüntü kesintisiz devam eder
                 └─ appsink           kare → ROI → RapidOCR → doğrulama
      │ POST /ingest  (IP admin panelinden atanmış makineyi belirler)
      ▼
Merkezi API (FastAPI, :8100)          merkez/
  olay motoru · OEE · veritabanı · WebSocket
      │
      ├─── panel.html                 tarayıcı paneli (tek dosya)
      │
      └─── adapha-api (Node/Prisma, :3000)   ayrı depo (adapha-rn)
                │
                └─── React Native (Expo)     ayrı depo (adapha-rn)
```

Merkez ve adapha-api aynı fiziksel SQLite dosyasını (`data/jwc.db`)
paylaşır — iki ayrı veritabanı yok. Tüm sistem `JWC/baslat.ps1` ile tek
komutla, doğru sırayla ayağa kalkar (`JWC/durdur.ps1` ile durur). Uçtan
uca kurulum adımları için bkz. **`JWC/KURULUM.md`**.

### Neden bu katmanlar

**Saha cihazı (Pi)** görüntüyü hem TV'ye basıyor hem okuyor. GStreamer
`tee` sayesinde passthrough kesilmiyor — operatör panoyu görmeye devam
ediyor. Ağa kare değil, saniyede birkaç yüz bayt JSON gidiyor.

**Merkezi API** ham okumaları olaya çeviriyor. Sayaç durgunluğu → duruş,
model alanı değişimi → model değişimi, sayaç düşüşü → reset. Kalıcılık,
OEE hesabı ve çapraz doğrulama burada.

**Ara katman (adapha-api)** mobil için Türkçe alan adları, hat/bant
kavramı, bildirim geçmişi ve yönetim uçları ekliyor.

---

## Depo yapısı

| Klasör | İçerik |
|---|---|
| `merkez/` | FastAPI servisi, olay motoru, veritabanı, panel |
| `belge/` | Ayrıntılı teknik belgeler |

Raspberry Pi'de çalışan kod (`saha/`) ve kalibrasyon araçları (`arac/`)
bu depoda **değil** — `jwc/` reposundan bağımsız, bir üstteki
`JWC/raspberry-pi/` klasöründe. Sebep: bu kod merkezle birlikte
sunucuya yüklenmiyor, Pi'ye kopyalanıyor; ayrı tutmak hangi dosyanın
nereye gideceğini netleştiriyor. Bkz. `../raspberry-pi/` ve
`JWC/KURULUM.md`.

### `merkez/`

| Dosya | İşlevi |
|---|---|
| `api.py` | REST + WebSocket servisi |
| `events.py` | Durum makinesi ve OEE hesabı — **projenin kalbi** |
| `parsing.py` | Ayrıştırma ve çapraz doğrulama |
| `db.py` | SQLAlchemy şeması (`merkez_veri`, `cihaz_durumu`) |
| `panel.html` | Tarayıcı paneli — tek dosya, kurulum yok |
| `simulate.py` | Olay motorunu donanımsız test eder |
| `feed.py` | Simülasyon verisini API'ye besler |

### `../raspberry-pi/` (bu deponun dışında)

| Klasör | İçerik |
|---|---|
| `saha/` | Pi'ye kopyalanan 4 dosya: `main.py`, `rapid_engine.py`, `ingest_bridge.py`, `config.yaml` |
| `arac/` | Kalibrasyon, kıyaslama ve test araçları (`capture_check.py`, `check_rois.py`, `compare.py`, `raw_scores.py`, `make_test_video.py`) + bunların bağımlı olduğu `rois.py`/`readers.py`/`parsing.py` (merkez'deki `parsing.py`'nin kopyası) |

---

## Kurulum

Aşağıdaki kısa özet. Tüm sistemin (merkez + adapha-api + mobil uygulama)
uçtan uca kurulumu, gerçek bir sunucuya taşıma dahil, **`JWC/KURULUM.md`**
dosyasında.

### Merkezi servis

```bash
cd merkez
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn api:app --host 0.0.0.0 --port 8100
```

Geliştirmede SQLite kendiliğinden oluşur; `.env`'deki `DATABASE_URL`
adapha-api ile **aynı** dosyayı (`../data/jwc.db`) göstermeli — tek
veritabanı, iki servis. Üretimde Postgres'e geçmek istenirse:

```bash
export DATABASE_URL="postgresql+psycopg://kullanici:parola@sunucu/jwc"
```

Panel için `merkez/panel.html` dosyasını tarayıcıda açın:

```
panel.html?api=http://SUNUCU_IP:8100
```

### Saha cihazı

Ön koşul: `pi-capture-ocr` paketi kurulu (GStreamer passthrough iskeleti,
hocanın sağladığı taban). Dosyalar artık bu depoda değil,
`../raspberry-pi/saha/` klasöründe:

```bash
cp ../raspberry-pi/saha/rapid_engine.py ../raspberry-pi/saha/ingest_bridge.py \
   ../raspberry-pi/saha/main.py ~/project/src/pi_capture_ocr/
cp ../raspberry-pi/saha/config.yaml ~/project/config/config.yaml

cd ~/project && source .venv/bin/activate
pip install rapidocr==3.9.1 onnxruntime
pip install -e .
```

Makine kimliği ve merkez adresi `/etc/default/pi-capture-ocr` dosyasından
okunur — kod her cihazda aynı kalır:

```
JWC_MACHINE_ID=MAK-01
JWC_API_URL=http://MERKEZ_IP:8000
```

Servisin bu dosyayı okuması için:

```bash
sudo mkdir -p /etc/systemd/system/pi-capture-ocr.service.d
sudo tee /etc/systemd/system/pi-capture-ocr.service.d/override.conf <<'EOF'
[Service]
EnvironmentFile=-/etc/default/pi-capture-ocr
EOF
sudo systemctl daemon-reload && sudo systemctl restart pi-capture-ocr
```

---

## Yeni bir makine eklemek

1. Pi'yi kur, capture'ı bağla
2. `../raspberry-pi/arac/capture_check.py` ile HDCP ve format testi yap
3. Servisi durdurup kalibrasyon karesi al:
   `python -m pi_capture_ocr.main --preview-rois /tmp/onizleme.png`
4. Kutular yerinde değilse `config.yaml`'daki ROI koordinatlarını düzelt
5. `/etc/default/pi-capture-ocr` içinde `JWC_API_URL` ver (merkez adresi)
6. **Admin panelinden** (mobil uygulama → Admin) bir makineye Pi'nin
   IP'sini ata

**Önemli — kimliği artık Pi değil, admin paneli belirliyor.** `/ingest`,
isteğin geldiği IP'yi admin panelinde bir makineye atanmış IP'lerle
eşleştirir; eşleşme yoksa isteği reddeder (Pi'nin kendi `JWC_MACHINE_ID`
ayarına hiç bakılmaz). Yani 6. adım atlanırsa Pi veri gönderir ama
merkez hiçbirini kabul etmez. Bir Pi fiziksel olarak başka bir hatta
taşınınca da Pi'ye dokunmadan, sadece admin panelinden IP'yi yeni
makineye atamak yeterli.

---

## Doğrulanmış davranışlar

Gerçek donanımda, gerçek panoda ölçüldü:

| Yetenek | Sonuç |
|---|---|
| Altı alanın OCR ile okunması | %99+ güven, hatasız |
| Duruş tespiti | 88 sn'lik duruş, 2 sn hata payıyla |
| Model değişimi | her iki yönde yakalandı |
| Sayaç sıfırlanması | yakalandı |
| Olağandışı sıçrama koruması | çalışıyor |
| OEE tutarlılığı | duruş ≤ planlanan süre |
| Kesinti dayanıklılığı | 38 bekleyen okuma diskten geri yüklendi |

---

## Bilinen eksikler

| Konu | Durum |
|---|---|
| Kimlik doğrulama | **yok** — `/ingest` açık |
| Model dosyalarının imaja gömülmesi | yapılmadı, ilk açılışta internet gerekiyor |
| Vardiya bazlı raporlama | yok, OEE "servis başladığından beri" |
| Nominal hız tanımı | yok, OEE'nin Performance bileşeni hesaplanamıyor |
| `stall_seconds` kalibrasyonu | şu an 5 sn (hızlı test geri bildirimi için) — üretime çıkmadan gerçek saha verisinden makul bir eşik çıkarılmalı |
| Cihaz sağlığının merkeze akması | `:8080/health` var ama merkez görmüyor |

Ayrıntı: `belge/DURUM-RAPORU.md`

---

## Belgeler

| Dosya | İçerik |
|---|---|
| `belge/DURUM-RAPORU.md` | Tüm kararlar, testler, gerekçeler |
| `belge/ENTEGRASYON.md` | Saha cihazına kurulum adımları |
| `belge/API-MOBIL.md` | API sözleşmesi (istemci geliştiricileri için) |
| `belge/MOBILDE-GOSTERME.md` | Uçtan uca çalıştırma sırası |
| `belge/KOD-INCELEMESI.md` | Ara katman kod incelemesi |

---

## İlgili depolar

| Depo | İçerik |
|---|---|
| https://github.com/abdulkadirelaldi/jwc | Bu depo — saha, merkez, panel, araçlar |
| https://github.com/kaangeckin/adapha-rn | Mobil uygulama ve ara katman |

---

## Lisans ve kullanım

Bu depo bir müşteri projesine aittir. Dışarıya açılmadan önce
`../raspberry-pi/saha/pi-capture-ocr.ornek` ve `belge/` içindeki IP
adresleri ile makine adlarının gözden geçirilmesi gerekir.
