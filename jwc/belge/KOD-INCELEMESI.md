# adapha-rn + adapha-api — Kod İncelemesi

İnceleme tarihi: 11 Ağustos 2026

## Mimari

Sistem dört katmana çıkmış:

```
Raspberry Pi (:8080)          hocanın passthrough + OCR servisi
    ↓ POST /ingest
Merkezi FastAPI (:8000)       olay motoru, OEE, veritabanı
    ↓ REST + WebSocket
adapha-api (Node, :3000)      Prisma/SQLite, Socket.IO, toplama katmanı
    ↓ REST + Socket.IO
adapha-rn (React Native)      mobil uygulama
```

Ara katman mantıklı: mobil için Türkçe alan adları, bant/hat kavramı,
bildirim geçmişi ve admin yönetimi ekliyor. Ama isimlendirme yanıltıcı —
`piIpAdresi`, `piRestClient`, `baglanMakineye(... Raspberry Pi'ye bağlandı)`
aslında **merkezi sunucuyu** işaret ediyor, Pi'yi değil.

Sahada bu alana Pi'nin IP'si yazılırsa sistem çalışmaz. Alan adı
`merkezSunucuIp` olmalı, ya da en azından açıklama satırı düzeltilmeli.

---

## Öncelik 1 — Sahada veri bozacak hatalar

### 1.1 WebSocket çapraz bulaşma

`piSync.ts` her bant için ayrı WS bağlantısı açıyor ve gelen her mesajı
o bandın verisi kabul ediyor:

```js
const guncelBant = await prisma.bant.update({
  where: { id: bantId },      // ← mesaj başka makineden gelmiş olabilir
  data: guncellenecekVeri
});
```

Merkezi API'nin `/live` yayını **global** — tüm makinelerin güncellemesi
tüm bağlantılara gider. Tek makineyle sorun görünmez, 10 makinede
MAK-07'nin verisi MAK-01'in satırına yazılır.

**Düzeltme (asgari):**

```js
if (payload.kind !== "update") return;
if (payload.machine_id !== bantId) return;
```

**Düzeltme (doğrusu):** Aynı sunucuya 10 soket açmanın anlamı yok.
Tek bağlantı açıp `payload.machine_id` ile ilgili bandı bulmak hem
kaynak tasarrufu hem de bu hatanın yapısal olarak imkansız hale gelmesi.

### 1.2 Sınırsız kayıt çoğaltma

`syncEvents` her çağrıda 24 saatlik olayların hepsini yeniden `create`
ediyor. `routes/pi.ts` bunu her `GET /api/pi/:bantId/events` isteğinde
çağırıyor — yani mobil ekran her açıldığında.

```js
for (const ev of events) {
  await prisma.olay.create({ data: {...} });   // aynı olay tekrar tekrar
}
```

`syncSamples` daha ağır: çağrı başına 2000 satıra kadar.

**Düzeltme:** Doğal anahtar tanımlayıp `upsert` kullanın.

```prisma
model Olay {
  ...
  @@unique([bantId, tip, tarih])
}

model Trend {
  ...
  @@unique([bantId, timestamp])
}
```

```js
await prisma.olay.upsert({
  where: { bantId_tip_tarih: { bantId, tip: ev.type, tarih: new Date(ev.start) } },
  update: { sure: ..., durum: ev.end ? "Tamamlandı" : "Devam Ediyor" },
  create: { ... }
});
```

`upsert`'in ikinci faydası: açık bir duruş kapandığında aynı kayıt
güncellenir, ikinci bir satır oluşmaz.

### 1.3 `oee` alanına kalite oranı yazılıyor

```js
await prisma.trend.create({
  data: { ..., oee: Number(s.rate || 0) }
});
```

`rate` = sertifikalı ürün oranı (Quality bileşeni).
`oee` = Availability × Performance × Quality.

İkisi farklı metrik. Bu haliyle panelde gösterilen "OEE" yanlış olur —
müşteriye sunulan rakam yanlış demektir.

`samples` ucu zaten OEE döndürmüyor; OEE ayrı uçtan geliyor
(`/machines/{id}/oee`). Trend tablosundaki alanı `kaliteOrani` diye
yeniden adlandırın, OEE'yi `syncOee` üzerinden ayrı tutun.

---

## Öncelik 2 — Tutarlılık sorunları

### 2.1 `durum` alanında iki farklı sözlük

| Kaynak | Yazdığı değerler |
|---|---|
| Prisma varsayılanı / seed | `acik`, `kapali` |
| `piSync` (gerçek makine) | `CALISIYOR`, `DURDU`, `SINYAL_YOK`, `BILINMIYOR` |

`index.ts`'teki simülatör `where: { durum: "acik" }` ile sorguluyor.
Gerçek bir makine bağlandığında durumu `CALISIYOR` olur ve bu sorgudan
düşer — istenen davranış. Ama ekran görüntüsündeki "6 Açık / 2 Kapalı"
sayacı ve `AÇIK` rozetleri de aynı karşılaştırmayı yapıyorsa, gerçek
bantlar hiçbir kategoriye girmez.

**Düzeltme:** Tek sözlük seçin. Öneri: merkezi API'nin değerlerini
kanonik kabul edip, eski `acik`/`kapali` kullanan yerlere eşleme yazın.

```js
const CALISIYOR_SAYILANLAR = new Set(["acik", "CALISIYOR"]);
```

### 2.2 `sure` metin olarak saklanıyor

```js
sure: ev.duration_s ? `${ev.duration_s} sn` : "Belirsiz"
```

`"90.9698 sn"` gibi bir metin. Toplam duruş süresi hesaplanamaz,
sıralanamaz, grafiğe girmez. Sayısal alan olmalı:

```prisma
sureSn  Float?
```

Gösterim biçimlendirmesi arayüzün işi, veritabanının değil.

### 2.3 `baslik` ve `tip` aynı veriyi tutuyor

İkisi de `ev.type` alıyor. `baslik` insan tarafından okunacak metin
olmalı ("Duruş", "Model Değişimi"), `tip` makine tarafından
kullanılacak kod.

### 2.4 Null koruması yok

Ekran görüntüsündeki `Bant 3 – Hat B: undefined birim/dak` bunun sonucu.
`anlikHiz` null olabiliyor.

Merkezi API'de null gelebilecek alanlar: `model`, `rate`, `runtime`,
`oee` (tamamı), `oee.performance`. Hepsine varsayılan koyun.

---

## Öncelik 3 — Sahaya çıkmadan

### 3.1 Sabit IP adresi

```js
const API_URL = "http://192.168.1.187:3000/api";
```

Derleme zamanında gömülü. Fabrikada sunucu IP'si değişirse APK yeniden
derlenmeli. En azından `app.json` üzerinden okunacak bir yapılandırma,
ideali uygulama içinde ayarlanabilir bir alan.

### 3.2 Simülatör üretimde kapatılmalı

`index.ts` içindeki 3 saniyelik `setInterval` sahte veri üretiyor.
`piIpAdresi` olmayan bantlarda çalışıyor — doğru kısıt. Ama üretimde
tamamen kapalı olmalı, yoksa yanlış yapılandırılmış bir bant sessizce
uydurma veri gösterir.

```js
if (process.env.SIMULATOR === "1") { ... }
```

### 3.3 Kimlik doğrulama yok

Hem merkezi API'de hem burada. `origin: "*"` ile Socket.IO herkese açık.
Fabrika iç ağı için ilk sürümde kabul edilebilir ama planlanmalı.

### 3.4 Her dosyada yeni `PrismaClient`

`index.ts`, `piSync.ts`, `piRestClient.ts`, her router ayrı örnek
oluşturuyor. SQLite'ta bağlantı havuzu sorununa yol açar. Tek bir
`prisma.ts` modülünden paylaşılan örnek dışa aktarılmalı.

---

## İyi yapılmış şeyler

**Üstel geri çekilmeli yeniden bağlanma.** `piSync.ts`'te 1→2→4→8→16→30
saniye, üst sınırlı. Doğru uygulanmış.

**Bağlantı olayları bildirime dönüşüyor.** Cihaz bağlandı/koptu bilgisi
hem veritabanına yazılıyor hem mobile push ediliyor. 10 cihazlık sahada
bu gerçekten lazım olacak.

**`reconnectMakine` ile IP değişikliğinde temiz yeniden bağlanma.**
Eski soketin `close` dinleyicisi kaldırılıyor, yoksa çift reconnect
tetiklenirdi. İnce bir detay, düşünülmüş.

**Hata yakalama her yerde.** Pi erişilemezse boş dizi dönüyor, uygulama
çökmüyor.

**Şema kapsamlı.** Hat/Bant/Parti/Kalite/Performans ayrımı, gerçek bir
üretim takip sistemine yakışan bir model.

---

## Merkezi API tarafında yapılan düzeltme

`piSync.ts`'te şu satır dikkat çekti:

```js
if (payload.machine_id) guncellenecekVeri.mevcutModel = String(payload.machine_id);
```

`mevcutModel` alanına "MAK-01" yazılıyor — çünkü WebSocket yayınımızda
`model` alanı yoktu, arkadaşın koyacak veri bulamamış.

Bu bizim eksiğimizdi. `api.py` güncellendi, yayına eklendi:

```json
{
  "kind": "update",
  "machine_id": "MAK-01",
  "status": "CALISIYOR",
  "model": "Type-M",      ← yeni
  "total": 43624,
  "good": 42909,
  "rate": 98.36,
  "speed": 198,
  "runtime": 4.1,         ← yeni
  "oee": { ... },         ← yeni
  "events": []
}
```

Artık `piSync.ts` doğru alanı okuyabilir:

```js
if (payload.model) guncellenecekVeri.mevcutModel = String(payload.model);
if (payload.runtime !== undefined) guncellenecekVeri.calismaSuresi = Number(payload.runtime);
```

`oee` alanı da eklendi — `syncOee` ile ayrı REST çağrısı yapmaya gerek
kalmadan canlı OEE alınabilir.

---

## Önerilen sıra

1. WS mesajlarında `machine_id` filtresi (tek satır, en kritik)
2. `upsert`'e geçiş + unique kısıtları (veritabanı şişmesini durdurur)
3. `oee` / `rate` karışıklığının düzeltilmesi
4. `model` ve `runtime` alanlarının yeni yayından okunması
5. `durum` sözlüğünün birleştirilmesi
6. Null korumaları
7. IP'nin yapılandırılabilir hale gelmesi
