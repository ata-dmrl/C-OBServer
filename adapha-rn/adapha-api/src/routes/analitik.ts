import { Router } from "express";
import { prisma } from "../lib/prisma";
import { aylikUretimGetir, tarihlikUretimGetir } from "../services/piRestClient";

const router = Router();

// ── GET /api/analitik/aylik-uretim ── Ay bazında birleşik üretim (nokta grafiği için)
router.get("/aylik-uretim", async (req, res) => {
  try {
    const veri = await aylikUretimGetir();
    res.json(veri);
  } catch (error) {
    console.error("Aylık üretim verisi çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/analitik/makine-uretimi ── Her makinenin toplam üretimi (hangi makine daha çok çalıştı)
router.get("/makine-uretimi", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany({
      select: { id: true, isim: true, toplamUretim: true },
      orderBy: { toplamUretim: "desc" },
    });
    res.json(bantlar.map(b => ({ id: b.id, isim: b.isim, toplamUretim: b.toplamUretim || 0 })));
  } catch (error) {
    console.error("Makine üretim verisi çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/analitik/radar ── Radar grafik verisi
router.get("/radar", async (req, res) => {
  try {
    const aktifBantlar = await prisma.uygulamaVerisi.findMany({ where: { durum: "acik" } });
    if (aktifBantlar.length === 0) {
      return res.json([
        { label: "Hız", value: 0 }, { label: "Kalite", value: 0 }, { label: "Verimlilik", value: 0 },
        { label: "Çalışma", value: 0 }, { label: "Hassasiyet", value: 0 }, { label: "Güvenilir.", value: 0 },
      ]);
    }

    const n = aktifBantlar.length;
    let hz = 0, kal = 0, ver = 0, cal = 0, has = 0, guv = 0;

    aktifBantlar.forEach(b => {
      // Hız 100 üzerinden standardize ediliyor (Farazi max hız 100 kabul ediliyor veya o anlık hızın orantısı)
      hz += Math.min(100, (b.anlikHiz || 0) * 1.5); 
      kal += b.qualityOrani || 0;
      ver += b.oee || 0;
      cal += b.availability || 0;
      has += b.sertifikaOrani || (b.qualityOrani || 0); 
      guv += b.calismaSuresi ? Math.max(0, 100 - ((b.duruşSuresiSn || 0) / (b.calismaSuresi * 60)) * 100) : 100;
    });

    res.json([
      { label: "Hız", value: Math.round(hz / n) },
      { label: "Kalite", value: Math.round(kal / n) },
      { label: "Verimlilik", value: Math.round(ver / n) },
      { label: "Çalışma", value: Math.round(cal / n) },
      { label: "Hassasiyet", value: Math.round(has / n) },
      { label: "Güvenilir.", value: Math.round(guv / n) },
    ]);
  } catch (error) {
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/analitik/performans-tablosu ── Kritik hat durumları
router.get("/performans-tablosu", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany();
    const uyariTablosu: any[] = [];

    bantlar.forEach(b => {
      if (b.durum === "kapali" || b.baglantiDurumu === "SINYAL_YOK") {
        uyariTablosu.push({ oncelik: "Yüksek", hat: b.isim, durum: "Sinyal Yok / Kapalı", aksiyon: "Kontrol" });
      } else {
        if ((b.oee || 0) < 60) {
          uyariTablosu.push({ oncelik: "Acil", hat: b.isim, durum: `OEE %${b.oee?.toFixed(1)} < 60`, aksiyon: "İncele" });
        } else if ((b.qualityOrani || 0) < 90) {
          uyariTablosu.push({ oncelik: "Orta", hat: b.isim, durum: `Kalite %${b.qualityOrani?.toFixed(1)} < 90`, aksiyon: "İzle" });
        } else {
          uyariTablosu.push({ oncelik: "Canlı", hat: b.isim, durum: `Optimum %${b.oee?.toFixed(1)}`, aksiyon: "Aktif" });
        }
      }
    });

    res.json(uyariTablosu);
  } catch (error) {
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/analitik/isi-haritasi ── Isı haritası (Heatmap) verisi
router.get("/isi-haritasi", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany({ orderBy: { id: 'asc' } });
    
    const hatlar = bantlar.map(b => b.isim);
    const sutunlar = ["Hız", "Kal", "OEE", "Çal", "Has", "Güv"];
    
    const degerler = bantlar.map(b => {
      const hz = Math.min(100, Math.round((b.anlikHiz || 0) * 1.5));
      const kal = Math.round(b.qualityOrani || 0);
      const ver = Math.round(b.oee || 0);
      const cal = Math.round(b.availability || 0);
      const has = Math.round(b.sertifikaOrani || b.qualityOrani || 0);
      const guv = b.calismaSuresi ? Math.max(0, 100 - ((b.duruşSuresiSn || 0) / (b.calismaSuresi * 60)) * 100) : (b.durum === "acik" ? 100 : 0);
      return [hz, kal, ver, cal, has, guv];
    });

    res.json({ hatlar, sutunlar, degerler });
  } catch (error) {
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/analitik/tarih-raporu?tarih=YYYY-MM-DD ── Belirli bir güne ait
// makine bazlı üretim + hata özeti (indirilebilir "günlük rapor" için).
router.get("/tarih-raporu", async (req, res) => {
  try {
    const tarih = String(req.query.tarih || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
      return res.status(400).json({ error: "Geçersiz tarih formatı, YYYY-MM-DD bekleniyor." });
    }

    const [uretimVerisi, bantlar] = await Promise.all([
      tarihlikUretimGetir(tarih),
      prisma.uygulamaVerisi.findMany({ select: { id: true, isim: true } }),
    ]);
    const isimMap = new Map(bantlar.map(b => [b.id, b.isim]));

    // Gün sınırları yerel saatle - hataZamani UTC ISO olarak tutuluyor ama
    // burada sadece "o güne ait" kaba bir aralık yeterli (raporun amacı
    // mikrosaniye kesinliği değil, hangi güne ait olduğu).
    const gunBaslangic = new Date(`${tarih}T00:00:00`);
    const gunBitis = new Date(`${tarih}T23:59:59.999`);
    const hatalar = await prisma.hataBildirimi.findMany({
      where: { hataZamani: { gte: gunBaslangic, lte: gunBitis } },
      orderBy: { hataZamani: "asc" },
    });

    const hataSayilariMap = new Map<string, number>();
    hatalar.forEach(h => hataSayilariMap.set(h.bantId, (hataSayilariMap.get(h.bantId) || 0) + 1));

    const makineler = uretimVerisi
      .map(u => ({
        id: u.makine,
        isim: isimMap.get(u.makine) || u.makine,
        toplamUretim: u.toplamUretim,
        iyiUretim: u.iyiUretim,
      }))
      .sort((a, b) => b.toplamUretim - a.toplamUretim);

    const hataListesi = Array.from(hataSayilariMap.entries())
      .map(([bantId, adet]) => ({ id: bantId, isim: isimMap.get(bantId) || bantId, adet }))
      .sort((a, b) => b.adet - a.adet);

    const toplamUretim = makineler.reduce((s, m) => s + m.toplamUretim, 0);
    const toplamIyi = makineler.reduce((s, m) => s + m.iyiUretim, 0);

    res.json({
      tarih,
      toplamUretim,
      toplamIyi,
      sertifikaOrani: toplamUretim > 0 ? (toplamIyi / toplamUretim) * 100 : 0,
      makineler,
      hatalar: hataListesi,
      hataDetaylari: hatalar.map(h => ({
        id: h.id,
        bantId: h.bantId,
        isim: isimMap.get(h.bantId) || h.bantId,
        hataZamani: h.hataZamani,
        aciklama: h.aciklama,
        durum: h.durum,
      })),
    });
  } catch (error) {
    console.error("Tarihe göre rapor verisi çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

export default router;
