import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Test olayları ve trend verileri ekleniyor...");

  const bantId = "MAK-01";

  // Olaylar artık merkez'in de yazdığı paylaşılan cihaz_durumu tablosunda —
  // Prisma şemasında modellenmediği için ham SQL ile ekliyoruz.
  await prisma.$executeRaw`
    INSERT INTO cihaz_durumu (machine_id, kayit_tipi, start_ts, end_ts, duration_s, meta_json)
    VALUES
      (${bantId}, 'DURUS', ${Date.now() - 3 * 3600_000}, ${Date.now() - 3 * 3600_000 + 120_000}, 120, '{"test": true}'),
      (${bantId}, 'MODEL_DEGISIMI', ${Date.now() - 1 * 3600_000}, ${Date.now() - 1 * 3600_000}, 0, '{"eski": "Type-K", "yeni": "Type-M"}')
  `;

  // Trend (Samples) — ayrı bir tablo yok, doğrudan merkez_veri'ye yazılır
  // (piRestClient.ts samplesGetir() buradan okuyor).
  const simdi = new Date();
  await prisma.$executeRaw`
    INSERT INTO merkez_veri (machine_id, ts, total, good, rate, speed, valid)
    VALUES
      (${bantId}, ${new Date(simdi.getTime() - 3 * 60_000).toISOString()}, 1000, 940, 94.0, 140, 1),
      (${bantId}, ${new Date(simdi.getTime() - 2 * 60_000).toISOString()}, 2050, 1930, 94.1, 145, 1),
      (${bantId}, ${new Date(simdi.getTime() - 1 * 60_000).toISOString()}, 3200, 3050, 95.3, 152, 1),
      (${bantId}, ${simdi.toISOString()}, 4300, 4100, 95.3, 148, 1)
  `;

  console.log("Veriler başarıyla eklendi!");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
