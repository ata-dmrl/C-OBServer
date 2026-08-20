# Backend API — Mobil Entegrasyon Sözleşmesi

Sunucu: `http://<MERKEZ_IP>:8000`
Etkileşimli dokümantasyon: `http://<MERKEZ_IP>:8000/docs`

Tüm zaman damgaları **UTC**, ISO 8601 formatında. Cihaz saat diliminde
göstermek istemcinin işi.

---

## 1. Makine listesi — ana ekranın kaynağı

```
GET /machines
```

```json
[
  {
    "id": "MAK-01",
    "name": "MAK-01",
    "status": "CALISIYOR",
    "model": "Type-M",
    "total": 43624,
    "good": 42909,
    "rate": 98.36,
    "speed": 198,
    "last_seen": "2026-08-10T12:08:59.205573",
    "oee": {
      "availability": 0.929,
      "quality": 0.997,
      "performance": 0.957,
      "oee": 0.886,
      "planned_s": 6835.8,
      "downtime_s": 486.2,
      "uretim": 8796
    }
  }
]
```

### `status` alanı — dört değer

| Değer | Anlamı | Önerilen renk |
|---|---|---|
| `CALISIYOR` | Sayaç artıyor | yeşil |
| `DURDU` | Sayaç eşik süresince artmadı | kırmızı |
| `SINYAL_YOK` | Cihazdan geçerli okuma gelmiyor | gri |
| `BILINMIYOR` | Henüz hiç okuma alınmamış | gri |

### Dikkat edilecekler

`oee` **null olabilir** — makine için henüz canlı oturum yoksa. Ayrıca
`oee.performance` ve `oee.oee` alanları, makinenin nominal hızı tanımlı
değilse gelmez. İkisini de opsiyonel kabul edin.

`model`, `rate`, `runtime` alanları **null gelebilir**. Bunlar yavaş değişen
alanlar; saha cihazı sayaçları her okumada gönderirken bu üçünü daha seyrek
tazeliyor. İlk saniyelerde boş olmaları normal.

`last_seen` üzerinden tazelik kontrolü yapın: üzerinden 60 saniyeden fazla
geçtiyse veriyi "eski" olarak işaretleyin, `status` ne derse desin.

---

## 2. Olay geçmişi — duruş listesi ve zaman çizelgesi

```
GET /machines/{id}/events?hours=24
```

`hours`: 1–720 arası, varsayılan 24.

```json
[
  {
    "type": "DURUS",
    "start": "2026-08-10T10:15:05.276492",
    "end": null,
    "duration_s": null,
    "meta": { "esik_sn": 30.0 }
  }
]
```

Sonuçlar **en yeniden eskiye** sıralı.

### `type` değerleri

| Değer | Ne zaman | `meta` içeriği |
|---|---|---|
| `DURUS` | Sayaç eşik süresince artmadı | `esik_sn` |
| `MODEL_DEGISIMI` | Ürün tipi değişti | `eski`, `yeni` |
| `SAYAC_RESET` | Sayaç sıfırlandı | `eski`, `yeni` |
| `KALITE_UYARISI` | Kalite oranı eşiğin altına indi | `oran` |
| `SINYAL_KAYBI` | Ardışık geçersiz okuma | `ardisik_hatali` |

### Açık olaylar

`end` ve `duration_s` **null ise olay hâlâ devam ediyor**. Duruş süresini
göstermek için `now - start` hesaplayın ve canlı saydırın. Kapalı olaylarda
`duration_s` saniye cinsinden gelir.

`MODEL_DEGISIMI` ve `SAYAC_RESET` anlık olaylardır; `duration_s` sıfır gelir.
Süre göstermeyin.

---

## 3. Trend verisi — grafikler için

```
GET /machines/{id}/samples?hours=8&limit=2000
```

```json
[
  { "ts": "2026-08-10T12:00:01", "total": 43624, "good": 42909,
    "rate": 98.36, "speed": 198, "valid": true }
]
```

**Eskiden yeniye** sıralı — grafiğe doğrudan verilebilir.

`valid: false` olan kayıtlar doğrulamadan geçemeyen okumalardır. Grafikte
göstermeyin ya da farklı işaretleyin.

Üretim hızı grafiği için ardışık `total` farkını zamana bölün; `speed` alanı
makinenin kendi gösterdiği anlık hızdır, ikisi farklı şeylerdir.

---

## 4. OEE — tek makine

```
GET /machines/{id}/oee
```

Makine için canlı oturum yoksa **404** döner. Bunu hata olarak göstermeyin,
"henüz veri yok" olarak ele alın.

---

## 5. Canlı yayın — WebSocket

```
ws://<MERKEZ_IP>:8000/live
```

Sunucu her yeni okumada tüm abonelere yayın yapar:

```json
{
  "kind": "update",
  "machine_id": "MAK-01",
  "status": "CALISIYOR",
  "total": 43624,
  "good": 42909,
  "rate": 98.36,
  "speed": 198,
  "events": [
    { "type": "DURUS", "start": "...", "end": "...",
      "duration_s": 231.4, "meta": {} }
  ]
}
```

`events` dizisi **sadece o an oluşan** olayları içerir, çoğu mesajda boştur.
Bildirim tetiklemek için bu diziyi kullanın.

### Kritik iki nokta

**Açılışta önce REST, sonra WebSocket.** WebSocket mevcut durumu göndermez,
sadece değişiklikleri yayınlar. Uygulama açılınca önce `GET /machines` ile
tabloyu doldurun, sonra sokete abone olun. Aksi halde ilk okuma gelene kadar
boş ekran görürsünüz.

**Yeniden bağlanma istemcinin sorumluluğu.** Bağlantı koptuğunda sunucu bir
şey yapmaz. Üstel geri çekilmeli yeniden bağlanma yazın (1s, 2s, 4s… en fazla
30s) ve her başarılı bağlantıdan sonra `GET /machines` ile durumu tazeleyin —
kopukken kaçırdığınız güncellemeler olabilir.

Bağlantıyı canlı tutmak için periyodik bir metin gönderebilirsiniz; sunucu
gelen mesajları yok sayar.

---

## 6. Rapor çıktısı

```
GET /export.csv?hours=24
```

CSV döner, `Content-Disposition: attachment`. Mobilde muhtemelen gerekmez;
panel tarafı için.

---

## Şu an bilinmesi gereken kısıtlar

**Kimlik doğrulama yok.** İlk sürümde uçlar açık. Fabrika iç ağında
çalışacağı için kabul edildi, ama sonra API anahtarı eklenecek — mobil
tarafta istek başlıklarına bir token ekleyebilecek bir yapı bırakın.

**Vardiya kavramı yok.** OEE şu an "servis başladığından beri" hesaplıyor,
vardiya bazlı değil. Vardiya raporu ekranını şimdilik planlamayın.

**Sunucu tek worker.** WebSocket abone listesi süreç belleğinde tutuluyor.
Ölçek büyürse değişecek ama API sözleşmesi aynı kalacak.

**Test verisi karışabilir.** Veritabanında `MAK-02` ve `MAK-03` diye eski
simülasyon kayıtları var. Gerçek sahada tek makine (`MAK-01`) yayın yapıyor.
`last_seen` alanına bakarak eski kayıtları eleyebilirsiniz.
