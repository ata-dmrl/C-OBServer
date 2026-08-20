# Test Videosunu Mobil Uygulamada Görmek

Zincirin tamamı:

```
Laptop (test videosu tam ekran)
   ↓ HDMI
USB Capture → Raspberry Pi          OCR okur, /ingest'e gönderir
   ↓ POST
Merkezi API (Mac, :8100)            olay motoru, OEE, veritabanı
   ↓ REST + WebSocket
adapha-api (Mac, :3000)             Prisma, Socket.IO
   ↓ REST + Socket.IO
Mobil uygulama
```

İlk iki halka çalışıyor. Kalan iş: **adapha-api'yi ayağa kaldırıp
MAK-01'i merkezi API'ye yönlendirmek.**

Bu belgede `MAC_IP` yazan her yere Mac'inin adresini yaz. Öğrenmek için:

```bash
ipconfig getifaddr en0
```

---

## Kritik nokta: bant kimliği eşleşmeli

`piSync.ts` gelen WebSocket mesajlarını şöyle filtreliyor:

```js
if (payload.machine_id !== bantId) return;
```

Yani `Bant.id` ile merkezi API'nin gönderdiği `machine_id` **birebir aynı**
olmalı. Neyse ki seed dosyası bantları `MAK-01` … `MAK-08` diye
oluşturuyor, merkezi API de `MAK-01` gönderiyor. Eşleşiyor, ekstra iş yok.

Eğer bant kimliğini değiştirirsen Pi tarafındaki
`/etc/default/pi-capture-ocr` içindeki `JWC_MACHINE_ID` değerini de
aynı yapman gerekir.

---

## 1. Merkezi API çalışıyor mu

Mac'te, uvicorn'un olduğu terminal:

```bash
cd ~/Desktop/jwc_ocr && source .venv/bin/activate
uvicorn api:app --host 0.0.0.0 --port 8100
```

Doğrula:

```bash
curl -s http://MAC_IP:8100/machines | python3 -m json.tool
```

`MAK-01` görünmeli. Görünmüyorsa Pi'nin veri gönderdiğinden emin ol:

```bash
# Pi'de
journalctl -u pi-capture-ocr -f | grep "changed"
```

---

## 2. adapha-api'yi kur ve başlat

**Yeni bir terminal** aç (uvicorn'unkini kapatma):

```bash
cd ~/Desktop/adapha-rn/adapha-api      # klasörün gerçek yolu

npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts                  # MAK-01…MAK-08 bantlarını oluşturur
npm run dev
```

Çıktıda şunu görmelisin:

```
🚀 Adapha API çalışıyor: http://0.0.0.0:3000
```

**Not:** Şemada yeni alanlar var (`oee`, `availability`, `qualityOrani`,
`baglantiDurumu`, `merkezSunucuIp`, `merkezPort`). Eski bir veritabanı
dosyası varsa `prisma db push` uyumsuzluk verebilir. O durumda
`prisma/dev.db` dosyasını silip komutları tekrarla.

---

## 3. MAK-01'i merkezi API'ye yönlendir

adapha-api varsayılan olarak port **8000** kullanıyor, bizimki **8100**'de.
Bu yüzden portu da göndermek şart:

```bash
curl -X PUT http://localhost:3000/api/admin/bant/MAK-01/ip \
  -H "Content-Type: application/json" \
  -d '{"merkezSunucuIp":"MAC_IP","merkezPort":8100}'
```

**Aynı makinedeyse** `MAC_IP` yerine `127.0.0.1` de yazabilirsin.

Cevap `{"success":true,...}` olmalı. Hemen ardından `npm run dev`
terminalinde şu satırı göreceksin:

```
✅ [Bant MAK-01] Raspberry Pi'ye başarıyla bağlandı!
```

(Mesaj "Raspberry Pi" diyor ama bağlandığı yer merkezi API — düzeltilecek
kozmetik bir metin.)

Doğrula:

```bash
curl -s http://localhost:3000/api/bantlar | python3 -m json.tool
```

`MAK-01` için `toplamUretim`, `mevcutModel`, `durum` alanları dolmuş olmalı.
Video oynuyorsa `toplamUretim` her sorguda artar.

---

## 4. Mobil uygulamayı sunucuya bağla

`adapha-rn/app.json` içinde:

```json
{
  "expo": {
    "extra": {
      "serverUrl": "http://MAC_IP:3000"
    }
  }
}
```

`localhost` **yazma** — telefon kendi kendine bağlanmaya çalışır.
Mac'in ağdaki gerçek IP'si olmalı.

Sonra:

```bash
cd ~/Desktop/adapha-rn/adapha-rn
npm install
npx expo start
```

Telefon ve Mac aynı Wi-Fi'da olmalı. Expo Go ile QR kodu okut.

---

## 5. Videoyu oynat ve izle

Laptopta test videosunu tam ekran, **döngüde** oynat.

Mobilde göreceklerin:

| Ekran öğesi | Beklenen |
|---|---|
| Bant 1 (MAK-01) durumu | AÇIK, yeşil |
| Toplam çıktı | saniyeler içinde artıyor |
| Mevcut model | Type-M / Type-K (video değiştirdikçe) |
| Diğer 7 bant | KAPALI (veri gelmiyor, normal) |

Videonun 1:30–3:00 arası duruş segmentinde MAK-01 **KAPALI**'ya düşmeli,
3:00'te tekrar AÇIK olmalı. Bildirim geçmişinde duruş kaydı belirmeli.

---

## Çalışmazsa sırayla bak

**Bant güncellenmiyor**

```bash
curl -s http://localhost:3000/api/admin/bantlar | python3 -m json.tool
```

`merkezSunucuIp` ve `merkezPort` doğru mu? Boşsa 3. adım tutmamış.

**"Bağlanılamadı" hatası**

Merkezi API `0.0.0.0` ile mi başlatıldı? Sadece `127.0.0.1` dinliyorsa
başka makineden erişilemez. Mac'in güvenlik duvarı Python ve Node'a izin
veriyor mu?

**Telefon bağlanamıyor**

`app.json`'da `localhost` mu yazıyor? Telefon ve Mac aynı ağda mı?

**Veri geliyor ama değerler `null`**

`model`, `rate`, `runtime` alanları ilk 30–60 saniyede boş gelir — bunlar
yavaş tazelenen alanlar, normal. `oee.performance` ise **hep null** olacak,
çünkü makinenin nominal hızı henüz tanımlanmadı.

**Sayaçlar duruyor ama video oynuyor**

Pi'de OCR akıyor mu:

```bash
journalctl -u pi-capture-ocr -f | grep "total changed"
```

Saniyede bir artan değer görmelisin.

---

## Sıralama özeti

1. Mac terminal 1 → uvicorn (:8100)
2. Mac terminal 2 → adapha-api (:3000)
3. `curl PUT` ile MAK-01'e IP + port ver
4. `app.json` → `serverUrl`
5. Mac terminal 3 → `npx expo start`
6. Laptop → video tam ekran döngüde
7. Pi → servis çalışıyor (zaten açık)
