import { PrismaClient } from "@prisma/client";

// Ortamına göre Prisma'nın tekrar tekrar instantiate edilmesini engeller
// ve tek bir bağlantı havuzu (connection pool) kullanılmasını sağlar.
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// piSync.ts (canlı Pi verisi) sık sık yazıyor; aynı anda bir okuma/başka bir
// yazma (ör. analitik ekranının trend senkronizasyonu) gelirse SQLite'ın
// tek-yazarlı kilidi birkaç saniyelik beklemeye sebep olabiliyordu. WAL modu
// okuma/yazmayı birbirini bloklamadan yürütür, busy_timeout ise kilit anında
// hemen hata vermek yerine kısa bir süre beklemesini sağlar.
//
// Not: bu PRAGMA'lar SQLite'ta bir SONUÇ SATIRI döndürüyor (ör. "wal"),
// $executeRaw ise sadece etkilenen satır sayısı bekleyen komutlar için —
// Prisma bu yüzden "Execute returned results" hatası veriyordu (yakalanıp
// yutuluyordu ama WAL modu de hiç etkinleşmiyordu). $queryRaw kullanmak
// sonuç döndüren sorgular için doğru olanı.
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => {});
prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;").catch(() => {});

// wal_autocheckpoint: SQLite normalde -wal dosyası ~1000 sayfaya ulaşınca
// kendiliğinden jwc.db'ye "checkpoint" yapıp birleştiriyor. Burada 0 ile
// kapatılıp günde bir kez elle checkpoint yapılıyor (bkz. dailyCheckpoint
// çağrısı, index.ts) — WAL dosyası gün içinde büyür ama bu veri kaybı
// DEMEK DEĞİL, WAL modu zaten çökme-güvenli; sadece jwc.db'ye ne zaman
// "yazılıp toparlanacağı" değişiyor. merkez (Python) tarafı da kendi
// bağlantısında aynısını yapıyor (bkz. db.py).
prisma.$queryRawUnsafe("PRAGMA wal_autocheckpoint=0;").catch(() => {});

// Günde bir kez elle checkpoint — WAL dosyasını jwc.db'ye birleştirir.
// PASSIVE mod: o an süren okuma/yazmaları bloklamaz, sadece uygunsa
// birleştirir (bu yüzden "kapatma" gibi işlemlerde ayrıca tam bir
// checkpoint gerekebilir, ama günlük bakım için yeterli).
setInterval(() => {
  prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(PASSIVE);").catch(() => {});
}, 24 * 60 * 60 * 1000);
