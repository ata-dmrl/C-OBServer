import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// ── GET /api/bantlar ── Tüm bantları getir
router.get("/", async (req, res) => {
  try {
    const bantlar = await prisma.uygulamaVerisi.findMany();
    res.json(bantlar);
  } catch (error) {
    console.error("Bantları çekerken hata:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

// ── GET /api/bantlar/:id ── Spesifik bir bandı getir
router.get("/:id", async (req, res) => {
  try {
    const bant = await prisma.uygulamaVerisi.findUnique({
      where: { id: req.params.id },
    });

    if (!bant) {
      // return ekleyerek typescript hatasını önlüyoruz
      res.status(404).json({ error: "Bant bulunamadı." });
      return; 
    }

    res.json(bant);
  } catch (error) {
    console.error("Bant detayı çekerken hata:", error);
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  }
});

export default router;
