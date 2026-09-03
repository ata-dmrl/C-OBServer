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
 * Ay bazında toplam üretim (tüm makineler birleşik) — merkez_veri ham okuma
 * geçmişinden türetilir, ayrı bir tabloya yazılmaz (bkz. samplesGetir notu).
 *
 * total/good ömür boyu artan sayaçlar; bir ayın üretimi o ay içindeki
 * MAX(total)-MIN(total) farkıdır. Sayaç o ay içinde sıfırlanırsa (bkz.
 * events.py COUNTER_RESET) bu fark olduğundan düşük çıkabilir — kabul
 * edilebilir bir yaklaşıklık, projedeki diğer "plausible" sayaç
 * toleranslarıyla aynı mantıkta (bkz. events.py _check_counter).
 * Her makine için ayrı hesaplanıp ay bazında toplanır.
 */
export async function aylikUretimGetir() {
  const rows = await prisma.$queryRaw<
    { ay: string; makine: string; ilkTotal: bigint | null; sonTotal: bigint | null; ilkGood: bigint | null; sonGood: bigint | null }[]
  >`
    SELECT
      strftime('%Y-%m', ts) AS "ay",
      machine_id AS "makine",
      MIN(total) AS "ilkTotal", MAX(total) AS "sonTotal",
      MIN(good) AS "ilkGood", MAX(good) AS "sonGood"
    FROM merkez_veri
    WHERE valid = 1
    GROUP BY ay, machine_id
    ORDER BY ay ASC
  `;

  // SQLite'ın MIN/MAX'ı INTEGER kolonda Prisma tarafında BigInt olarak
  // dönüyor (bkz. samplesGetir'deki aynı not) — aritmetik öncesi Number'a
  // çevrilmeli, yoksa "Cannot convert a BigInt value to a number" hatası alınır.
  const aylar = new Map<string, { uretim: number; iyi: number }>();
  for (const r of rows) {
    const ilkTotal = Number(r.ilkTotal ?? 0), sonTotal = Number(r.sonTotal ?? 0);
    const ilkGood = Number(r.ilkGood ?? 0), sonGood = Number(r.sonGood ?? 0);
    const uretimFarki = Math.max(0, sonTotal - ilkTotal);
    const iyiFarki = Math.max(0, sonGood - ilkGood);
    const mevcut = aylar.get(r.ay) || { uretim: 0, iyi: 0 };
    mevcut.uretim += uretimFarki;
    mevcut.iyi += iyiFarki;
    aylar.set(r.ay, mevcut);
  }

  return Array.from(aylar.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ay, v]) => ({ ay, uretim: v.uretim, iyi: v.iyi }));
}

/**
 * Tek bir güne ait, makine bazlı üretim (total/good farkı) — aylikUretimGetir
 * ile aynı MIN/MAX-fark mantığı, sadece "ay" yerine tek bir "gün"e (tarih,
 * "YYYY-MM-DD") ve GROUP BY machine_id'ye daraltılmış hali. Tarihe göre
 * indirilebilir rapor (AnalizEkrani.tsx) için kullanılıyor.
 */
export async function tarihlikUretimGetir(tarih: string) {
  const rows = await prisma.$queryRaw<
    { makine: string; ilkTotal: bigint | null; sonTotal: bigint | null; ilkGood: bigint | null; sonGood: bigint | null }[]
  >`
    SELECT
      machine_id AS "makine",
      MIN(total) AS "ilkTotal", MAX(total) AS "sonTotal",
      MIN(good) AS "ilkGood", MAX(good) AS "sonGood"
    FROM merkez_veri
    WHERE valid = 1 AND strftime('%Y-%m-%d', ts) = ${tarih}
    GROUP BY machine_id
  `;

  return rows.map(r => {
    const ilkTotal = Number(r.ilkTotal ?? 0), sonTotal = Number(r.sonTotal ?? 0);
    const ilkGood = Number(r.ilkGood ?? 0), sonGood = Number(r.sonGood ?? 0);
    return {
      makine: r.makine,
      toplamUretim: Math.max(0, sonTotal - ilkTotal),
      iyiUretim: Math.max(0, sonGood - ilkGood),
    };
  });
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
