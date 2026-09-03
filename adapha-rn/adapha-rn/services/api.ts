import { io, Socket } from "socket.io-client";
import Constants from "expo-constants";

export type BantDurumu = "acik" | "kapali" | "SINYAL_YOK" | "BILINMIYOR";

export function normalizeDurum(d?: string): BantDurumu {
  if (d === "CALISIYOR" || d === "acik") return "acik";
  if (d === "DURDU" || d === "kapali") return "kapali";
  if (d === "SINYAL_YOK") return "SINYAL_YOK";
  return "BILINMIYOR";
}

// Güvenli Tarih Formatlayıcı (C5)
export function formatTarih(isoString?: string | Date | null): string {
  if (!isoString) return "Belirsiz";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "Belirsiz";
    const aylar = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
    const gun = d.getDate();
    const ay = aylar[d.getMonth()];
    const saat = d.getHours().toString().padStart(2, "0");
    const dak = d.getMinutes().toString().padStart(2, "0");
    return `${gun} ${ay} ${saat}:${dak}`;
  } catch(e) {
    return "Belirsiz";
  }
}

export interface Bant {
  id: string;
  isim: string;
  hatAdi?: string;
  durum: BantDurumu;
  anlikHiz?: number;
  sonGuncelleme?: string;
  kameraUrl?: string;
  mevcutModel?: string;
  toplamUretim?: number;
  iyiUretim?: number;
  sertifikaOrani?: number;
  calismaSuresi?: number;
  oee?: number;
  availability?: number;
  qualityOrani?: number;
  duruşSuresiSn?: number;
  baglantiDurumu?: string;
  oeeUretim?: number;
  oeeUretimIyi?: number;
}

export interface HataBildirimi {
  id: number;
  bantId: string;
  hataZamani: string;
  durum: "bekliyor" | "aciklandi";
  aciklama?: string | null;
  aciklamaZamani?: string | null;
  createdAt: string;
  bant?: { id: string; isim: string; hatAdi?: string };
}

// ── Sunucu IP Adresi (Dinamik) ──
const DEFAULT_SERVER = "http://192.168.1.187:3000";
const serverUrl = Constants.expoConfig?.extra?.serverUrl || DEFAULT_SERVER;

const API_URL = `${serverUrl}/api`;
console.log("API URL SU AN:", API_URL);
export { API_URL };
export const SOCKET_URL = serverUrl;

// Socket bağlantısını oluştur
export const socket: Socket = io(SOCKET_URL);

// ── Gerçek API Bağlantıları ────────────────────────────────────────────────
export async function bantVerisiniCek(): Promise<Bant[]> {
  try {
    const res = await fetch(`${API_URL}/bantlar`);
    if (!res.ok) throw new Error("Bantları çekerken hata oluştu");
    const data = await res.json();
    return (data || []).map((b: any) => ({ ...b, durum: normalizeDurum(b.durum) }));
  } catch (error) {
    console.error("Bant verisi çekilemedi:", error);
    return [];
  }
}

export const dashboardOzetiniCek = async () => {
  try {
    const res = await fetch(`${API_URL}/dashboard/ozet`);
    return await res.json();
  } catch (err) {
    console.error("Dashboard özeti çekilemedi", err);
    return { aktifHatSayisi: 0, toplamCikti: 0, anlikHizOrta: 0 };
  }
};

// ── RASPBERRY PI REST UÇ NOKTALARI (Proxy Üzerinden) ──

export const getPiSamples = async (bantId: string) => {
  try {
    const res = await fetch(`${API_URL}/pi/${bantId}/samples`);
    return await res.json();
  } catch (err) {
    console.error("Pi trend verisi çekilemedi", err);
    return [];
  }
};

export const getPiOee = async (bantId: string) => {
  try {
    const res = await fetch(`${API_URL}/pi/${bantId}/oee`);
    return await res.json();
  } catch (err) {
    console.error("Pi OEE verisi çekilemedi", err);
    return { oee: 0 };
  }
};


// ── Hata Bildirimleri (Kalite) ──────────────────────────────────────────────
// Hat durup anlıkHiz 0'a düştüğü an sunucu otomatik olarak "bekliyor"
// durumunda bir kayıt açar (bkz. adapha-api piSync.ts hataliUrunTespitEt).
// Burada sadece kullanıcının gireceği açıklamayı gönderiyoruz.

export async function bekleyenHataBildirimleriniCek(): Promise<HataBildirimi[]> {
  try {
    const res = await fetch(`${API_URL}/hata-bildirimleri/bekleyenler`);
    if (!res.ok) throw new Error("Bekleyen hata bildirimleri çekilemedi");
    return await res.json();
  } catch (error) {
    console.error("Bekleyen hata bildirimleri çekilemedi:", error);
    return [];
  }
}

export async function hataBildirimDetayiniCek(id: number): Promise<HataBildirimi | null> {
  try {
    const res = await fetch(`${API_URL}/hata-bildirimleri/${id}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Hata bildirimi detayı çekilemedi:", error);
    return null;
  }
}

export async function hataAciklamasiGonder(id: number, aciklama: string): Promise<HataBildirimi> {
  const res = await fetch(`${API_URL}/hata-bildirimleri/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aciklama }),
  });
  if (!res.ok) throw new Error("Açıklama gönderilemedi.");
  return await res.json();
}

// Çoklu seçim: aynı açıklama, seçilen her makineye AYRI kayıt olarak işlenir.
export async function topluHataAciklamasiGonder(ids: number[], aciklama: string): Promise<{ ok: boolean; guncellenen: number }> {
  const res = await fetch(`${API_URL}/hata-bildirimleri/toplu/gonder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, aciklama }),
  });
  if (!res.ok) throw new Error("Toplu açıklama gönderilemedi.");
  return await res.json();
}

export async function hataRaporunuCek(): Promise<HataBildirimi[]> {
  try {
    const res = await fetch(`${API_URL}/hata-bildirimleri/rapor/liste`);
    if (!res.ok) throw new Error("Hata raporu verisi çekilemedi");
    return await res.json();
  } catch (error) {
    console.error("Hata raporu verisi çekilemedi:", error);
    return [];
  }
}

// ── Grafik verisi ────────────────────────────────────────────────────────────
// NOT: Analiz ekranlarındaki detaylı grafiklerin verileri de API'den gelecek şekilde ayarlandı.
// Aşağıdaki sabit verileri zamanla tamamen API'ye bağlayabilirsiniz. Şu an test için API'den de çekebiliyoruz.

export async function radarVerisiniCek() {
  const res = await fetch(`${API_URL}/analitik/radar`);
  return await res.json();
}

export async function isiHaritasiniCek() {
  const res = await fetch(`${API_URL}/analitik/isi-haritasi`);
  return await res.json();
}

export async function performansTablosunuCek() {
  const res = await fetch(`${API_URL}/analitik/performans-tablosu`);
  return await res.json();
}

export interface AylikUretim { ay: string; uretim: number; iyi: number }

// Ay bazında (tüm makineler birleşik) toplam üretim — merkezin ham okuma
// geçmişinden türetilir. Sistem yeni kurulduysa/az veri varsa boş veya kısa
// bir dizi döner, bu normaldir — zamanla gerçek geçmişle dolar.
export async function aylikUretimVerisiniCek(): Promise<AylikUretim[]> {
  try {
    const res = await fetch(`${API_URL}/analitik/aylik-uretim`);
    if (!res.ok) throw new Error("Aylık üretim verisi çekilemedi");
    return await res.json();
  } catch (error) {
    console.error("Aylık üretim verisi çekilemedi:", error);
    return [];
  }
}

export interface MakineUretimi { id: string; isim: string; toplamUretim: number }

export async function makineUretimVerisiniCek(): Promise<MakineUretimi[]> {
  try {
    const res = await fetch(`${API_URL}/analitik/makine-uretimi`);
    if (!res.ok) throw new Error("Makine üretim verisi çekilemedi");
    return await res.json();
  } catch (error) {
    console.error("Makine üretim verisi çekilemedi:", error);
    return [];
  }
}

export interface MakineHataSayisi { bantId: string; isim: string; adet: number }

export async function hataMakineSayilariniCek(): Promise<MakineHataSayisi[]> {
  try {
    const res = await fetch(`${API_URL}/hata-bildirimleri/rapor/makine-sayilari`);
    if (!res.ok) throw new Error("Makine hata sayıları çekilemedi");
    return await res.json();
  } catch (error) {
    console.error("Makine hata sayıları çekilemedi:", error);
    return [];
  }
}

// ── Tarihe göre günlük rapor (AnalizEkrani.tsx'teki takvim seçici için) ──
export interface TarihRaporu {
  tarih: string;
  toplamUretim: number;
  toplamIyi: number;
  sertifikaOrani: number;
  makineler: { id: string; isim: string; toplamUretim: number; iyiUretim: number }[];
  hatalar: { id: string; isim: string; adet: number }[];
  hataDetaylari: { id: number; bantId: string; isim: string; hataZamani: string; aciklama: string | null; durum: string }[];
}

export async function tarihRaporuCek(tarih: string): Promise<TarihRaporu> {
  const res = await fetch(`${API_URL}/analitik/tarih-raporu?tarih=${tarih}`);
  if (!res.ok) throw new Error("Tarihe göre rapor verisi alınamadı");
  return await res.json();
}

// Şimdilik statik kalan analiz verileri (zamanla API'ye eklenebilir):
export const hizProfili = [
  { t: "0:00", hiz: 0, miktar: 0 }, { t: "0:30", hiz: 18, miktar: 1500 },
  { t: "1:00", hiz: 188, miktar: 18200 }, { t: "1:30", hiz: 192, miktar: 18800 },
  { t: "2:00", hiz: 196, miktar: 19300 }, { t: "2:30", hiz: 190, miktar: 18500 },
  { t: "3:00", hiz: 12, miktar: 900 }, { t: "3:30", hiz: 6, miktar: 400 },
  { t: "4:00", hiz: 148, miktar: 14300 }, { t: "4:30", hiz: 162, miktar: 15700 },
  { t: "5:00", hiz: 152, miktar: 14800 },
];

export const aylikUretim = [
  { ay: "Oca", cikti: 251000, iyi: 248500 }, { ay: "Şub", cikti: 188000, iyi: 185200 },
  { ay: "Mar", cikti: 220000, iyi: 216800 }, { ay: "Nis", cikti: 198000, iyi: 194100 },
  { ay: "May", cikti: 242000, iyi: 238900 }, { ay: "Haz", cikti: 268000, iyi: 263500 },
  { ay: "Tem", cikti: 284000, iyi: 279400 }, { ay: "Ağu", cikti: 310000, iyi: 305800 },
];

export const partiBuyume = [
  { b: "P1", r: 62 }, { b: "P2", r: 74 }, { b: "P3", r: 68 },
  { b: "P4", r: 82 }, { b: "P5", r: 88 }, { b: "P6", r: 94 },
  { b: "P7", r: 92 }, { b: "P8", r: 98 },
];

export const programVerisi = [
  { parti: "Sabah", hat: "H1", tip: "Tip-M", saat: "09:00" },
  { parti: "Sabah", hat: "H2", tip: "Tip-M", saat: "09:00" },
  { parti: "Sabah", hat: "H3", tip: "Tip-A", saat: "09:30" },
  { parti: "Öğlen", hat: "H1", tip: "Tip-M", saat: "14:00" },
  { parti: "Öğlen", hat: "H4", tip: "Tip-B", saat: "14:30" },
];
