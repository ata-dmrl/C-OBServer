import { Router } from "express";
import { prisma } from "../lib/prisma";
import { bantBildirimDurumunuSifirla } from "../services/piSync";
import { getIo } from "../index";

const router = Router();

// Merkez'in kendisi ayrı, sistem geneli bir adres (MERKEZ_URL env değişkeni)
// — bant başına ayarlanmaz. Burada girilen IP/port sadece Pi'deki anlık
// görüntü sunucusuna (saha/main.py, varsayılan 8090) ait.
const VARSAYILAN_PI_PORT = 8090;

// ── GET /api/admin/bantlar ── IP ve durum dahil bantları listele
router.get("/bantlar", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany({
      orderBy: { id: "asc" }
    });
    res.json(bantlar);
  } catch (error) {
    res.status(500).json({ error: "Bantlar çekilemedi." });
  }
});

// ── PUT /api/admin/bant/:id/ip ── Bandı izleyen Raspberry Pi'nin IP/port'unu güncelle
router.put("/bant/:id/ip", async (req, res) => {
  const { id } = req.params;
  const { piIp, piPort } = req.body;

  if (piIp === undefined) {
    return res.status(400).json({ error: "IP adresi gereklidir." });
  }

  // Boş string = IP'yi temizle (bant artık hiçbir Pi'ye bağlı değil)
  const ip: string | null = typeof piIp === "string" && piIp.trim() === "" ? null : piIp;
  const port = piPort ? Number(piPort) : VARSAYILAN_PI_PORT;
  const kameraUrl = ip ? `http://${ip}:${port}/frame.jpg` : null;

  try {
    const eskiBant = await prisma.uygulamaVerisi.findUnique({ where: { id } });
    const ipDegisti = eskiBant && eskiBant.piIp !== ip;

    // IP gerçekten değiştiyse (yeni bir makineye atandı ya da boşaltıldı),
    // eski canlı veriler artık bu banda ait değil — donup kalmış eski
    // rakamlar göstermemesi için sıfırlıyoruz. Merkez artık kimliği IP'ye
    // göre belirliyor (bkz. api.py /ingest): bir Pi başka bir makineye
    // atanınca, eski makine bir daha veri almaz ve son bildiği durumda
    // "takılı" görünürdü — bu yüzden burada temizliyoruz.
    const sifirlamaVerisi = ipDegisti ? {
      durum: "kapali",
      anlikHiz: 0,
      baglantiDurumu: null,
      mevcutModel: null,
      toplamUretim: null,
      iyiUretim: null,
      sertifikaOrani: null,
      calismaSuresi: null,
      oee: null,
      availability: null,
      qualityOrani: null,
      duruşSuresiSn: null,
      oeeUretim: null,
      oeeUretimIyi: null,
    } : {};

    const guncelBant = await prisma.uygulamaVerisi.update({
      where: { id },
      data: { piIp: ip, piPort: port, kameraUrl, ...sifirlamaVerisi }
    });

    // IP değişikliği log tablosuna düşsün — kim, ne zaman, hangi bandın
    // IP'sini değiştirdi görülebilsin.
    if (ipDegisti) {
      await prisma.uygulamaLog.create({
        data: {
          bantId: id,
          tip: "bilgi",
          mesaj: `🔧 ${id}'in Pi IP'si "${eskiBant!.piIp || "boş"}" → "${ip || "boş"}" olarak değiştirildi.`,
        }
      });
      // Eski atamadan kalan pasif/aktif bildirim durumunu temizle — yoksa
      // yeni atamadaki ilk gerçek "pasif" bildirimi eski durumla tesadüfen
      // aynı geldiğinde sessizce yutulabiliyordu.
      bantBildirimDurumunuSifirla(id);
    }

    // Mobil uygulamalara anında yayınla — yoksa ekran açıkken IP sıfırlanınca
    // (ör. Ana Sayfa) bir sonraki merkez güncellemesine kadar (ki artık bu
    // banda hiç gelmeyebilir) eski canlı sayılarla "takılı" görünmeye devam ediyordu.
    getIo().emit("bant_guncellendi", guncelBant);

    res.json({ success: true, bant: guncelBant });
  } catch (error) {
    res.status(500).json({ error: "IP adresi güncellenemedi." });
  }
});

// ── GET /api/admin/bildirimler ── Sistem bildirimlerini çek
//
// Kalıcı log zaten cihaz_durumu tablosunda (merkez tarafı) ve bu tabloda
// (uygulama tarafı) tutuluyor; bu uç "gelen kutusu" gibi davranıyor — sadece
// henüz görülmemiş bildirimleri döndürür ve döndürürken hepsini okundu
// işaretler. Ekranı bir daha açtığında eskiler bir daha çıkmaz.
router.get("/bildirimler", async (req, res) => {
  try {
    const bildirimler = await prisma.uygulamaLog.findMany({
      where: { okundu: false },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    if (bildirimler.length > 0) {
      await prisma.uygulamaLog.updateMany({
        where: { id: { in: bildirimler.map(b => b.id) } },
        data: { okundu: true }
      });
    }
    res.json(bildirimler);
  } catch (error) {
    res.status(500).json({ error: "Bildirimler çekilemedi." });
  }
});

export default router;
