import axios from "axios";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Axios instance with a timeout so we don't hang if Pi is down
const createClient = (ip: string, port: number = 8100) => axios.create({
  baseURL: `http://${ip}:${port}`,
  timeout: 5000,
});

/**
 * Pi'deki Trend (Samples) verisini çeker ve veritabanına kaydeder
 */
export async function syncSamples(bantId: string, piIp: string, piPort: number = 8000) {
  try {
    const api = createClient(piIp, piPort);
    // Ekranda zaten sadece son 20 kayıt gösteriliyor (bkz. pi.ts /samples),
    // 2000 örnek çekip tek tek (2000 ayrı sorguyla) yazmanın anlamı yoktu —
    // bu, analitik ekranının yavaş açılmasının asıl sebebiydi. Son birkaç
    // dakikalık pencere yeterli, tek seferlik toplu (createMany) yazıyoruz.
    const res = await api.get(`/machines/${bantId}/samples?hours=8&limit=50`);

    const samples = Array.isArray(res.data) ? res.data : [];
    const gecerli = samples.filter((s: any) => s.valid !== false);

    if (gecerli.length > 0) {
      // Prisma'nın SQLite bağlayıcısı createMany'de skipDuplicates
      // desteklemiyor — SQLite'ın kendi "INSERT OR IGNORE"ını tek seferlik
      // toplu bir sorguyla kullanıyoruz (aynı bantId+timestamp varsa atlar).
      // Prisma DateTime alanlarını SQLite'ta ISO metin değil, Unix ms
      // (INTEGER) olarak saklıyor — .getTime() ile aynı formatı kullanmazsak
      // aynı ana ait satırlar "farklı" görünüp tekilliği bozabilirdi.
      const satirlar = gecerli.map((s: any) => Prisma.sql`(
        ${bantId},
        ${(s.ts ? new Date(s.ts) : new Date()).getTime()},
        ${Number(s.speed || 0)},
        ${Number(s.total || 0)},
        ${Number(s.rate || 0)}
      )`);
      await prisma.$executeRaw`
        INSERT OR IGNORE INTO "UygulamaTrend" ("bantId", "timestamp", "hiz", "miktar", "kaliteOrani")
        VALUES ${Prisma.join(satirlar)}
      `;
    }
    return samples;
  } catch (err: any) {
    console.error(`❌ [Bant ${bantId}] Samples çekilemedi:`, err.message);
    return [];
  }
}

/**
 * Pi'den anlık OEE değerini çeker (ve Trend'e yazar veya ayrı bir işlem yapar)
 */
export async function syncOee(bantId: string, piIp: string, piPort: number = 8000) {
  try {
    const api = createClient(piIp, piPort);
    const res = await api.get(`/machines/${bantId}/oee`);
    
    const oeeData = res.data;
    const oeeVal = oeeData?.oee ? oeeData.oee * 100 : 0; // 0.886 -> %88.6
    
    if (oeeVal > 0) {
      // Dakika bazında timestamp (saniye ve milisaniye sıfırla)
      const simdi = new Date();
      simdi.setSeconds(0, 0);

      await prisma.uygulamaTrend.upsert({
        where: {
          bantId_timestamp: {
            bantId,
            timestamp: simdi,
          }
        },
        update: {
          oee: oeeVal,
        },
        create: {
          bantId,
          timestamp: simdi,
          oee: oeeVal,
        }
      });
    }

    // Dönen değer de yüzdelik olmalı — merkez 0-1 arası oran gönderiyor,
    // DB'ye yazarken zaten x100 yapılıyordu ama burada ham haliyle
    // dönüyordu (uygulamada "%0.96" gibi yanlış görünmesinin sebebi buydu).
    return { ...oeeData, oee: oeeVal };
  } catch (err: any) {
    console.error(`❌ [Bant ${bantId}] OEE çekilemedi:`, err.message);
    return { oee: 0 };
  }
}

/**
 * Pi'den doğrudan CSV raporunu stream/proxy etmek için kullanılabilir.
 */
export async function getExportCsv(piIp: string, piPort: number = 8000) {
  try {
    const api = createClient(piIp, piPort);
    const res = await api.get("/export.csv?hours=24", { responseType: 'stream' });
    return res.data;
  } catch (err: any) {
    console.error(`❌ CSV çekilemedi:`, err.message);
    return null;
  }
}
