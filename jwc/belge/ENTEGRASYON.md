# Entegrasyon — hocanın hattına bizim parçaları takmak

Hocanın kodu yeniden yazılmıyor. Capture, GStreamer `tee`/passthrough,
dispatcher, değişim tespiti, `Stabilizer`, yeniden bağlanma mantığı —
hepsi aynen kalıyor. Sadece iki nokta değişiyor.

---

## Dosyaları yerleştir

```bash
cp rapid_engine.py   ~/project/src/pi_capture_ocr/
cp ingest_bridge.py  ~/project/src/pi_capture_ocr/
cp config.yaml       ~/project/config/config.yaml     # eskisini yedekle!
```

```bash
cd ~/project && source .venv/bin/activate   # onun venv'i
pip install rapidocr==3.9.1 onnxruntime
```

---

## Değişiklik 1 — OCR motorunu değiştir

`src/pi_capture_ocr/main.py`, `_worker` fonksiyonunun ilk satırları:

```python
    def _worker(self):
        try:
            engine = OCREngine(self.config.ocr.language)          # ← ESKİ
```

yerine:

```python
    def _worker(self):
        try:
            from .rapid_engine import RapidEngine
            engine = RapidEngine(self.config.ocr.language)        # ← YENİ
```

Başka hiçbir şey değişmiyor: `recognize()` ve `close()` imzaları birebir aynı,
`OCRResult` aynı sınıf, `cfg.min_confidence` / `cfg.regex` / `cfg.whitelist`
kontrolleri aynı şekilde uygulanıyor.

**Geri dönüş kolay:** iki satırı geri al, Tesseract'a dönersin. İkisini
karşılaştırmak için `--benchmark` modunu kullanabilirsin.

---

## Değişiklik 2 — Merkeze köprüyü ekle

### a) `Service.__init__` sonuna

```python
        from .ingest_bridge import IngestBridge
        self.bridge = IngestBridge(
            api_url="http://MERKEZ_IP:8000",
            machine_id="MAK-01",       # her Pi'de farklı olacak
            min_interval=2.0,
        )
```

### b) `_worker` içinde, `self.store.update(...)` satırının hemen altına

```python
                    if stable is not None:
                        self.store.update(cfg.id, stable, result.raw_value,
                                          result.confidence, changed)
                        self.bridge.update(cfg.id, stable, result.confidence)   # ← EKLE
                        if changed:
                            LOG.info(...)
```

### c) `Service.stop` içine

```python
    def stop(self):
        self.stop_event.set()
        self.bridge.stop()          # ← EKLE, kuyruktakiler diske alınsın
        self.capture.stop()
```

### d) `Service.health` içine (isteğe bağlı ama faydalı)

```python
        return {..., **self.bridge.health()}
```

Tek Pi'ye tek capture kararından sonra 10 cihaz sahada duracak. Bu satır
sayesinde hangi Pi'nin merkeze ulaşamadığını uzaktan görürsün.

---

## Çalıştır

```bash
sudo systemctl restart pi-capture-ocr
journalctl -u pi-capture-ocr -f
```

Beklenen log akışı:

```
ROI total changed: 43624 (100.0%)
ROI good changed: 42909 (100.0%)
Merkezi servise bağlanıldı: http://MERKEZ_IP:8000/ingest
```

Anlık durumu görmek için:

```bash
curl -s localhost:8080/health | python3 -m json.tool
cat ~/project/output/results.json
```

---

## Doğrulama sırası

1. **ROI'ler doğru mu** — servisi durdurup kalibrasyon önizlemesi al:
   ```bash
   sudo systemctl stop pi-capture-ocr
   cd ~/project && python -m pi_capture_ocr.main --preview-rois /tmp/onizleme.png
   ```
   Kutular altı değerin üstüne oturmalı.

2. **Okuma doğru mu** — `results.json` içinde `43624`, `42909`, `Type-M`,
   `98.36`, `4.1`, `0` görünmeli.

3. **Merkez alıyor mu** — merkezde `GET /machines`, makine listede
   ve `CALISIYOR` durumda olmalı.

4. **Kesinti dayanıklılığı** — merkezi kapat, birkaç dakika bekle, geri aç.
   `output/spool.jsonl` dolmalı, merkez açılınca boşalmalı.

---

## Bilinen noktalar

**`stability_mode` alanları config'e eklenmedi.** `config.py`'yi görmediğim
için geçerli değerleri bilmiyorum; varsayılanlar devrede. Sayaçlar için
ardışık doğrulama sıkılaştırılabilir, `config.py`'deki `ROIConfig` tanımına
bakıp ekleyin.

**`workers: 1` yaptım.** Tek capture var, tek makine okunuyor; ikinci worker
çekirdek için kavga etmekten başka bir şey yapmaz. `RapidEngine` zaten
`intra_op_num_threads=1` ile geliyor.

**Çapraz doğrulama merkezde çalışıyor.** `good/total` = `rate` kontrolü
saha cihazında değil, `parsing.py` içinde — yani `/ingest` sonrasında.
Saha tarafı hatalı okumayı gönderir, merkez reddeder ve `problems` alanına
yazar. İstersen bunu cihaza da taşıyabiliriz ama merkezde tutmak, kural
değiştiğinde 10 Pi'yi güncellemekten kurtarıyor.

**`fps: 1` yeterli.** Bu donanımda alan başına ~272 ms ölçtük. Değişim
tespiti sayesinde pratikte çok daha az iş yapılacak: sayaç durduğunda
hiçbir alan OCR'a gitmiyor.
