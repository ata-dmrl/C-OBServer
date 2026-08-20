import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Veritabanı temizleniyor...');
  await prisma.uygulamaLog.deleteMany();
  await prisma.uygulamaVerisi.deleteMany();

  console.log('Bantlar oluşturuluyor...');
  const bloklar = ['A Blok', 'A Blok', 'B Blok', 'B Blok', 'C Blok', 'C Blok', 'D Blok', 'D Blok'];
  for (let i = 1; i <= 8; i++) {
    const id = `MAK-0${i}`;
    await prisma.uygulamaVerisi.create({
      data: {
        id,
        hatAdi: `Hat ${i} – ${bloklar[i - 1]}`,
        blok: bloklar[i - 1],
        // Karışıklığa yol açtığı için isimde "Hat X" değil, dogrudan makine
        // kodu geciyor — hangi karti hangi makineye ait oldugu net olsun.
        isim: `Bant ${i} - ${id}`,
        durum: 'kapali',
        anlikHiz: 0,
        // Gerçek bir Pi'ye bağlanınca IP/kameraUrl admin ekranından girilir.
        // Sahte "çalışıyor" verisiyle başlatmıyoruz — gerçek veri gelene kadar kapalı görünür.
      },
    });
  }

  console.log('Sadece temel bantlar eklendi, geçmiş veriler temizlendi.');
  console.log('✅ Seed işlemi başarıyla tamamlandı!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
