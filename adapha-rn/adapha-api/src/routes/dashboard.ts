import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// ── GET /api/dashboard/ozet ── Ana ekrandaki üst metrikler
router.get("/ozet", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany();
    const acikBantlar = bantlar.filter(b => b.durum === "acik");

    // Eskiden burada Hat.count() ve boş UretimPartisi tablosundan toplam
    // çıktı hesaplanıyordu — UretimPartisi hiç dolu olmadığı için
    // toplamCikti her zaman 0 dönüyordu. Artık diğer ekranlardaki gibi
    // canlı bant verisinden hesaplanıyor.
    const aktifHatSayisi = acikBantlar.length;
    const toplamCikti = bantlar.reduce((sum, b) => sum + (b.toplamUretim || 0), 0);

    const toplamHiz = acikBantlar.reduce((sum, b) => sum + (b.anlikHiz || 0), 0);
    const anlikHizOrta = acikBantlar.length > 0 ? (toplamHiz / acikBantlar.length).toFixed(1) : 0;

    res.json({
      aktifHatSayisi,
      toplamCikti,
      anlikHizOrta: Number(anlikHizOrta),
    });
  } catch (error) {
    console.error("Dashboard özeti çekerken hata:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

export default router;
