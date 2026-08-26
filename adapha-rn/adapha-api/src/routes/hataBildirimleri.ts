import { Router } from "express";
import { prisma } from "../lib/prisma";
import { getIo } from "../index";

const router = Router();

// Bant bilgisini (isim/hatAdi) her satırda tekrar tekrar sorgulamamak için
// standart include — liste ve detay uçlarında ortak kullanılıyor.
const bantSecimi = { bant: { select: { id: true, isim: true, hatAdi: true } } };

// ── GET /api/hata-bildirimleri/bekleyenler ── Açıklaması girilmemiş tüm kayıtlar
// (Hata Bildirimleri listesi bu uçtan besleniyor — çoklu seçim burada yapılır)
router.get("/bekleyenler", async (req, res) => {
  try {
    const kayitlar = await prisma.hataBildirimi.findMany({
      where: { durum: "bekliyor" },
      include: bantSecimi,
      orderBy: { hataZamani: "desc" },
    });
    res.json(kayitlar);
  } catch (error) {
    console.error("Bekleyen hata bildirimleri çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/hata-bildirimleri/rapor/liste ── Açıklanmış kayıtlar (PDF rapor kaynağı)
router.get("/rapor/liste", async (req, res) => {
  try {
    const kayitlar = await prisma.hataBildirimi.findMany({
      where: { durum: "aciklandi" },
      include: bantSecimi,
      orderBy: { hataZamani: "desc" },
      take: 500,
    });
    res.json(kayitlar);
  } catch (error) {
    console.error("Hata raporu verisi çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/hata-bildirimleri/rapor/makine-sayilari ── Makinelere göre açıklanmış hata sayısı
router.get("/rapor/makine-sayilari", async (req, res) => {
  try {
    const gruplar = await prisma.hataBildirimi.groupBy({
      by: ["bantId"],
      where: { durum: "aciklandi" },
      _count: { _all: true },
    });
    if (gruplar.length === 0) {
      res.json([]);
      return;
    }
    const bantlar = await prisma.uygulamaVerisi.findMany({
      where: { id: { in: gruplar.map(g => g.bantId) } },
      select: { id: true, isim: true },
    });
    const isimMap = new Map(bantlar.map(b => [b.id, b.isim]));
    const sonuc = gruplar
      .map(g => ({ bantId: g.bantId, isim: isimMap.get(g.bantId) || g.bantId, adet: g._count._all }))
      .sort((a, b) => b.adet - a.adet);
    res.json(sonuc);
  } catch (error) {
    console.error("Makine hata sayıları çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── PATCH /api/hata-bildirimleri/toplu/gonder ── Çoklu seçim: aynı açıklama,
// her makineye (satıra) AYRI kayıt olarak işlenir — tek satırda birleştirilmez.
router.patch("/toplu/gonder", async (req, res) => {
  const { ids, aciklama } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "En az bir makine seçilmeli." });
    return;
  }
  if (!aciklama || typeof aciklama !== "string" || !aciklama.trim()) {
    res.status(400).json({ error: "Açıklama gereklidir." });
    return;
  }

  const temizAciklama = aciklama.trim();
  const zaman = new Date();
  const guncellenenler: any[] = [];

  for (const id of ids) {
    const guncel = await prisma.hataBildirimi.update({
      where: { id: Number(id) },
      data: { aciklama: temizAciklama, durum: "aciklandi", aciklamaZamani: zaman },
      include: bantSecimi,
    }).catch(() => null);
    if (guncel) {
      guncellenenler.push(guncel);
      getIo().emit("hata_bildirimi_aciklandi", guncel);
    }
  }

  res.json({ ok: true, guncellenen: guncellenenler.length, kayitlar: guncellenenler });
});

// ── GET /api/hata-bildirimleri/:id ── Tek kayıt detayı (makinenin kendi sayfası)
router.get("/:id", async (req, res) => {
  try {
    const kayit = await prisma.hataBildirimi.findUnique({
      where: { id: Number(req.params.id) },
      include: bantSecimi,
    });
    if (!kayit) {
      res.status(404).json({ error: "Kayıt bulunamadı." });
      return;
    }
    res.json(kayit);
  } catch (error) {
    console.error("Hata bildirimi detayı çekilemedi:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── PATCH /api/hata-bildirimleri/:id ── Tek makine için açıklama gir
router.patch("/:id", async (req, res) => {
  const { aciklama } = req.body;
  if (!aciklama || typeof aciklama !== "string" || !aciklama.trim()) {
    res.status(400).json({ error: "Açıklama gereklidir." });
    return;
  }
  try {
    const guncel = await prisma.hataBildirimi.update({
      where: { id: Number(req.params.id) },
      data: { aciklama: aciklama.trim(), durum: "aciklandi", aciklamaZamani: new Date() },
      include: bantSecimi,
    });
    getIo().emit("hata_bildirimi_aciklandi", guncel);
    res.json(guncel);
  } catch (error) {
    console.error("Hata açıklaması kaydedilemedi:", error);
    res.status(500).json({ error: "Açıklama kaydedilemedi." });
  }
});

export default router;
