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

  // Trend (Samples)
  await prisma.uygulamaTrend.createMany({
    data: [
      { bantId, hiz: 140, miktar: 1000, oee: 92.4 },
      { bantId, hiz: 145, miktar: 2050, oee: 93.1 },
      { bantId, hiz: 152, miktar: 3200, oee: 94.5 },
      { bantId, hiz: 148, miktar: 4300, oee: 94.0 },
    ]
  });

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
