import WebSocket from "ws";
import { prisma } from "../lib/prisma";
import { Server } from "socket.io";

// Sistemde tek bir merkez (FastAPI/uvicorn) var — fabrikadaki tüm Pi'ler
// oraya veri gönderiyor, biz de oradan tek bir WebSocket ile dinliyoruz.
// Bant başına ayrı bağlantı kurmuyoruz; gelen her mesaj machine_id'sine
// göre ilgili banta yönlendiriliyor.
const MERKEZ_URL = process.env.MERKEZ_URL || "http://localhost:8100";
const MERKEZ_WS_URL = MERKEZ_URL.replace(/^http/, "ws") + "/live";

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
// Merkez bağlantısı çırpınırsa (kısa aralıklarla kopup bağlanırsa) aynı
// "bağlandı"/"koptu" mesajını art arda kaydetmeyelim.
let lastConnStatus: "baglandi" | "koptu" | null = null;
// Aynı şekilde bant başına son bildirilen pasif/aktif durumu takip edip
// aynısını tekrar yazmayı engelliyoruz — olay motorunda kısa süreli bir
// çırpınma olursa (ör. hız okuması gürültülüyse) bildirim spam'ine düşülmesin.
const lastMachineNotif = new Map<string, "pasif" | "aktif">();

// Bant başına en son bilinen anlık hız — hız >0'dan 0'a geçişi (hattın
// durduğu, hatalı ürünün çıktığı an) yakalamak için. cihaz_durumu'ndaki DURUS
// olayı stall_seconds kadar gecikmeli geliyor; bu, kullanıcının istediği gibi
// "hız 0 olduğu an"ı ANINDA yakalayan, ondan bağımsız ayrı bir tetikleyici.
const lastSpeedByMachine = new Map<string, number>();

// Bir bandın Pi IP'si değiştiğinde (admin.ts) çağrılır: eski atamadan kalan
// pasif/aktif durumu temizlenmezse, yeni atamadaki İLK gerçek "pasif"
// bildirimi -- eski durumla tesadüfen aynı geldiği için -- sessizce yutulabiliyordu.
export function bantBildirimDurumunuSifirla(bantId: string) {
  lastMachineNotif.delete(bantId);
}

export async function baslatPiSync(io: Server) {
  console.log(`📡 Merkez'e bağlanılıyor: ${MERKEZ_WS_URL}`);
  baglan(io);
}

function baglan(io: Server) {
  ws = new WebSocket(MERKEZ_WS_URL);

  ws.on("open", async () => {
    console.log(`✅ Merkez'e başarıyla bağlandı.`);
    reconnectAttempts = 0;
    if (lastConnStatus !== "baglandi") {
      lastConnStatus = "baglandi";
      await bildirimAt("bilgi", "baglandi", "✅ Merkez sunucusuna bağlanıldı.");
    }
  });

  ws.on("message", async (data) => {
    try {
      const payload = JSON.parse(data.toString());

      // API-MOBIL.md şeması
      // kind: "update", machine_id, status: "CALISIYOR", total, good, rate, speed
      if (payload.kind !== "update" || !payload.machine_id) return;
      const bantId = payload.machine_id;

      const guncellenecekVeri: any = {
        sonGuncelleme: new Date(),
        durum: payload.status || "BILINMIYOR"
      };

      // Pi henüz bir alanı hiç okumadıysa null gönderiyor — bunu 0/boş olarak
      // yazıp önceki iyi değeri ezmemek için "!= null" (hem null hem
      // undefined'ı eler), sadece "!== undefined" değil.
      if (payload.speed != null) {
        const yeniHiz = Number(payload.speed);
        guncellenecekVeri.anlikHiz = yeniHiz;
        const eskiHiz = lastSpeedByMachine.get(bantId);
        if (eskiHiz !== undefined && eskiHiz > 0 && yeniHiz === 0) {
          await hataliUrunTespitEt(bantId, io);
        }
        lastSpeedByMachine.set(bantId, yeniHiz);
      }
      if (payload.total != null) guncellenecekVeri.toplamUretim = Number(payload.total);
      if (payload.good != null) guncellenecekVeri.iyiUretim = Number(payload.good);
      if (payload.rate != null) guncellenecekVeri.sertifikaOrani = Number(payload.rate);

      // B1 Eklemeleri
      if (payload.model != null) guncellenecekVeri.mevcutModel = String(payload.model);
      if (payload.runtime != null) guncellenecekVeri.calismaSuresi = Number(payload.runtime);
      if (payload.oee) {
        const o = payload.oee;
        if (o.oee != null)          guncellenecekVeri.oee = Number(o.oee) * 100;
        if (o.availability != null)  guncellenecekVeri.availability = Number(o.availability) * 100;
        if (o.quality != null)       guncellenecekVeri.qualityOrani = Number(o.quality) * 100;
        if (o.downtime_s != null)    guncellenecekVeri.duruşSuresiSn = Number(o.downtime_s);
        // Oturuma özel üretim sayıları — "hatalı birim" hesabı bunlardan
        // yapılmalı, toplamUretim'in ham (yaşam boyu) değerinden değil.
        if (o.uretim != null)        guncellenecekVeri.oeeUretim = Number(o.uretim);
        if (o.uretim_iyi != null)    guncellenecekVeri.oeeUretimIyi = Number(o.uretim_iyi);
      }

      switch (payload.status) {
        case "CALISIYOR":
          guncellenecekVeri.durum = "acik";
          guncellenecekVeri.baglantiDurumu = "ONLINE";
          break;
        case "DURDU":
          guncellenecekVeri.durum = "kapali";
          guncellenecekVeri.baglantiDurumu = "ONLINE";
          // Duruş tespiti güvenilir sayaca (total) dayanıyor, ama anlık hız
          // yukarıda ayrı ve bağımsız olarak analog kadran OCR'ından geliyor —
          // gürültülü olduğu için (test: aynı üretim penceresinde 0/2/7/27/198
          // gibi dağınık değerler görüldü) makine gerçekten durduğunda bile
          // sıfır olmayan bir değer taşıyabiliyordu. Durum "kapali" olduğunda
          // ekranda gösterilen hız da bununla tutarlı olsun diye sıfırlıyoruz.
          guncellenecekVeri.anlikHiz = 0;
          break;
        case "SINYAL_YOK":
        case "BILINMIYOR":
          guncellenecekVeri.baglantiDurumu = payload.status;
          break;
      }

      // machine_id'ye karşılık gelen bant henüz tanımlı değilse sessizce atla
      const guncelBant = await prisma.uygulamaVerisi.update({
        where: { id: bantId },
        data: guncellenecekVeri
      }).catch(() => null);
      if (!guncelBant) return;

      // Mobil uygulamalara canlı olarak fırlat
      io.emit("bant_guncellendi", guncelBant);

      // Merkez'in bu istekte ürettiği olayları (DURUS başladı/bitti vb.)
      // bildirim panosuna düşür — "MAK-01 pasif duruma geçti" gibi.
      if (Array.isArray(payload.events)) {
        for (const ev of payload.events) {
          await bildirEvent(bantId, guncelBant.piIp, ev, io);
        }
      }

    } catch (err) {
      console.warn(`⚠️ Gelen veri işlenemedi veya parse edilemedi.`);
    }
  });

  ws.on("close", async () => {
    ws = null;
    if (lastConnStatus !== "koptu") {
      lastConnStatus = "koptu";
      await bildirimAt("hata", "koptu", "⚠️ Merkez sunucusuyla bağlantı koptu!");
    }

    let delay = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000);
    console.log(`❌ Merkez bağlantısı koptu. ${delay / 1000} saniye sonra tekrar denenecek...`);

    reconnectAttempts++;
    reconnectTimeout = setTimeout(() => baglan(io), delay);
  });

  ws.on("error", (err) => {
    console.error(`⚠️ Merkez WebSocket hatası:`, err.message);
    ws?.close(); // tetiklenince on("close") çalışıp reconnect yapacak
  });
}

// Aynı makine için art arda (gürültülü hız okumasından kaynaklanan) tekrar
// tekrar kayıt açılmasını önlemek için minimum aralık. Bundan daha eski bir
// duruş, kullanıcı henüz açıklamamış olsa bile YENİ ve AYRI bir olay sayılır.
const HATA_BILDIRIMI_MIN_ARALIK_MS = 60_000;

// Hattın anlık hızı >0'dan 0'a düştüğü an çağrılır — "hatalı ürün çıktı" anı.
// Kullanıcının makine sayfasından gireceği açıklamayı bekleyen bir kayıt açar.
//
// Eskiden "aynı makine için bekleyen bir kayıt varsa hiç açma" kuralı vardı -
// ama bu, kullanıcı bir açıklamayı girmeden önce AYNI makine tekrar durursa
// (gerçekten farklı bir olay, sadece önceki henüz açıklanmamış) o ikinci
// duruşun sessizce kaybolmasına sebep oluyordu ("aynı makine farklı zaman
// diliminde hata verdiğinde listelenmiyor" şikayeti). Artık sadece SON
// kayıttan (durumu ne olursa olsun) bu yana yeterince zaman geçtiyse yeni
// kayıt açılıyor - gürültülü art arda sıçramalar hâlâ tek kayda toplanır,
// ama gerçekten ayrı zamanlı duruşlar ayrı ayrı listelenir.
async function hataliUrunTespitEt(bantId: string, io: Server) {
  try {
    const sonKayit = await prisma.hataBildirimi.findFirst({
      where: { bantId },
      orderBy: { hataZamani: "desc" },
    });
    if (sonKayit && Date.now() - sonKayit.hataZamani.getTime() < HATA_BILDIRIMI_MIN_ARALIK_MS) {
      return;
    }

    const yeniKayit = await prisma.hataBildirimi.create({
      data: { bantId, hataZamani: new Date(), durum: "bekliyor" },
    });
    io.emit("hata_bildirimi_olustu", yeniKayit);
  } catch (e) {
    console.warn("⚠️ Hata bildirimi kaydı oluşturulamadı:", e);
  }
}

// Merkezden gelen bir olayı (events.py -> EventType) bildirime çevirir.
// Şu an sadece DURUS (duruş) ile ilgileniyoruz: başlarken "pasif oldu",
// biterken "tekrar çalışmaya başladı" bildirimi düşer.
async function bildirEvent(bantId: string, piIp: string | null, ev: any, io: Server) {
  if (ev?.type !== "DURUS") return;
  const yeniDurum: "pasif" | "aktif" = ev.end == null ? "pasif" : "aktif";
  if (lastMachineNotif.get(bantId) === yeniDurum) return; // aynı durum tekrar bildirilmesin
  lastMachineNotif.set(bantId, yeniDurum);
  try {
    const baslarken = yeniDurum === "pasif";
    // merkez "start"/"end"i UTC datetime string olarak yolluyor — duruşun
    // GERÇEKTE başladığı an (sayacın son ilerlediği an), bildirimin DB'ye
    // yazıldığı an değil. Bildirimin zaman damgasını buna eşitliyoruz.
    const olayZamani = new Date(baslarken ? ev.start : (ev.end || ev.start));
    const ipEtiketi = piIp ? ` (${piIp})` : "";
    const mesaj = baslarken
      ? `⏸️ ${bantId} pasif duruma geçti (üretim durdu)${ipEtiketi}.`
      : `▶️ ${bantId} tekrar çalışmaya başladı${ipEtiketi}.`;
    const yeniBildirim = await prisma.uygulamaLog.create({
      data: { bantId, tip: baslarken ? "hata" : "bilgi", mesaj, createdAt: olayZamani }
    });
    io.emit("sistem_bildirimi", {
      id: yeniBildirim.id, bantId,
      tip: baslarken ? "pasif" : "aktif",
      mesaj, tarih: yeniBildirim.createdAt
    });
    // Uygulama arka plandayken bile telefona düşsün — IP'siz, kısa mesaj.
    // Tarih + saat birlikte (sadece saat değil) — "hangi gün" de belli olsun.
    const pushBaslik = baslarken ? `${bantId} pasif duruma geçti` : `${bantId} çalışır duruma geçti`;
    const tarihSaat = olayZamani.toLocaleString("tr-TR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
    await pushGonder(pushBaslik, tarihSaat);
  } catch (e) {}
}

// Kayıtlı tüm cihazlara Expo Push API üzerinden bildirim yollar. Başlık
// sabit uygulama adı/logosu olsun diye title'ı sade tutuyoruz — Expo bunu
// zaten uygulama ikonu/adıyla birlikte gösteriyor.
async function pushGonder(title: string, body: string) {
  try {
    const tokenlar = await prisma.pushToken.findMany();
    if (tokenlar.length === 0) return;

    const mesajlar = tokenlar.map(t => ({
      to: t.token, sound: "default", title, body,
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(mesajlar),
    });
  } catch (e) {
    console.warn("⚠️ Push bildirimi gönderilemedi:", e);
  }
}

async function bildirimAt(tip: string, olayTipi: string, mesaj: string) {
  try {
    const yeniBildirim = await prisma.uygulamaLog.create({ data: { bantId: null, tip, mesaj } });
    return yeniBildirim;
  } catch (e) {
    return null;
  }
}

