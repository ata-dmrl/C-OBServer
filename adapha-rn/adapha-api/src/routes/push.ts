import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// Mobil uygulama açılışta Expo push token'ını buraya kaydeder.
// Token zaten kayıtlıysa tekrar yazmıyoruz (unique alan, upsert ile).
router.post("/register", async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "token gerekli" });
  }
  await prisma.pushToken.upsert({
    where: { token },
    update: {},
    create: { token },
  });
  res.json({ ok: true });
});

export default router;
