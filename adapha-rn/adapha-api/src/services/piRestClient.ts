import axios from "axios";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Axios instance with a timeout so we don't hang if Pi is down
const createClient = (ip: string, port: number = 8100) => axios.create({
  baseURL: `http://${ip}:${port}`,
  timeout: 5000,
});

/**
 * Trend/grafik verisi merkezin kendi merkez_veri tablosundan okunur — aynı
 * fiziksel jwc.db dosyasını paylaştığımız için ayrıca HTTP ile çekip ayrı
 * bir tabloya (eskiden UygulamaTrend) kopyalamaya gerek yok. Bu fonksiyon
 * artık sadece pi.ts'in kullandığı bir yardımcı: ham SQL ile son N kaydı
 * döndürür.
 */
export async function samplesGetir(bantId: string, limit: number = 20) {
  // İki ayrı Prisma+SQLite tuhaflığına takıldık:
  // 1) LIMIT'i parametre olarak bağlamak "Conversion failed: input contains
  //    invalid characters" veriyordu — limit hep sabit, dahili bir değer
  //    olduğu için (kullanıcı girdisi değil) güvenle ham literal gömülüyor.
  // 2) merkez_veri.ts kolonunu (SQLAlchemy'nin DateTime(timezone=True) ile
  //    yazdığı, "2026-08-20 08:17:11.803585" gibi metin) OLDUĞU GİBİ
  //    seçmek de aynı hatayı veriyordu — Prisma'nın motoru kolonu DATETIME
  //    tipli sanıp kendi tarih ayrıştırıcısıyla okumaya çalışıyor, format
  //    uyuşmayınca patlıyor. strftime ile Unix ms'ye çevirip INTEGER olarak
  //    almak bu ayrıştırmayı devre dışı bırakıyor (saniye hassasiyeti
  //    yeterli, grafik için mikrosaniye gerekmiyor).
  const rows = await prisma.$queryRaw<
    { timestamp: bigint; hiz: number | null; miktar: number | null; kaliteOrani: number | null }[]
  >`
    SELECT strftime('%s', ts) * 1000 AS "timestamp", speed AS "hiz", total AS "miktar", rate AS "kaliteOrani"
    FROM merkez_veri
    WHERE machine_id = ${bantId} AND valid = 1
    ORDER BY ts DESC
    LIMIT ${Prisma.raw(String(Math.max(1, Math.floor(limit))))}
  `;
  // strftime INTEGER döndürüyor, Prisma bunu BigInt'e eşliyor — JSON.stringify
  // BigInt'i seri hale getiremediği için Number'a çeviriyoruz.
  return rows.map(r => ({ ...r, timestamp: Number(r.timestamp) }));
}

/**
 * Pi'den (aslında merkezden — bkz. pi.ts'teki adres notu) anlık OEE değerini
 * çeker. OEE bellekteki olay motorundan geliyor, ham okumalardan yeniden
 * hesaplanamaz — bu yüzden hâlâ HTTP ile canlı sorgulanıyor. Artık ayrı bir
 * tabloya yazılmıyor; en güncel değer zaten her ingest'te
 * UygulamaVerisi.oee'ye yazılıyor (piSync.ts).
 */
export async function syncOee(bantId: string, piIp: string, piPort: number = 8000) {
  try {
    const api = createClient(piIp, piPort);
    const res = await api.get(`/machines/${bantId}/oee`);

    const oeeData = res.data;
    // Dönen değer yüzdelik olmalı — merkez 0-1 arası oran gönderiyor.
    const oeeVal = oeeData?.oee ? oeeData.oee * 100 : 0; // 0.886 -> %88.6
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
