import { Router } from "express";
import { prisma } from "../lib/prisma";
import { syncSamples, syncOee, getExportCsv } from "../services/piRestClient";

const router = Router();

// Sistemde tek bir merkez var, bant başına ayrı adres yok.
const MERKEZ_URL = process.env.MERKEZ_URL || "http://localhost:8100";
const merkezAddress = (() => {
  const u = new URL(MERKEZ_URL);
  return { ip: u.hostname, port: Number(u.port || 80) };
})();

async function getPiAddress(bantId: string) {
  const bant = await prisma.uygulamaVerisi.findUnique({ where: { id: bantId } });
  return bant ? merkezAddress : null;
}

// Trend Verisi (Samples)
router.get("/:bantId/samples", async (req, res) => {
  const { bantId } = req.params;
  const address = await getPiAddress(bantId);

  if (address) {
    await syncSamples(bantId, address.ip, address.port);
  }

  const dbSamples = await prisma.uygulamaTrend.findMany({
    where: { bantId },
    orderBy: { timestamp: "desc" },
    take: 20
  });
  res.json(dbSamples);
});

// Anlık OEE
router.get("/:bantId/oee", async (req, res) => {
  const { bantId } = req.params;
  const address = await getPiAddress(bantId);

  if (address) {
    const oeeData = await syncOee(bantId, address.ip, address.port);
    return res.json(oeeData);
  }

  // Simüle edilmiş / son kaydedilen OEE
  const lastTrend = await prisma.uygulamaTrend.findFirst({
    where: { bantId, oee: { not: null } },
    orderBy: { timestamp: "desc" }
  });
  res.json({ oee: lastTrend?.oee || 0 });
});

// Rapor Çıktısı (Export CSV)
router.get("/:bantId/export.csv", async (req, res) => {
  const { bantId } = req.params;
  const address = await getPiAddress(bantId);

  if (address) {
    const stream = await getExportCsv(address.ip, address.port);
    if (stream) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export-${bantId}.csv"`);
      return stream.pipe(res);
    }
  }

  res.status(404).send("CSV bulunamadı veya Pi bağlantısı yok.");
});

export default router;
