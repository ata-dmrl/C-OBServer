import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

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

export default router;
