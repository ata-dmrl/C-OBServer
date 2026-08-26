import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator, DeviceEventEmitter, Alert
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { Download, ChevronRight, Zap, Award, Calendar, CheckCircle } from "lucide-react-native";
import { C } from "../constants/colors";
import { Card, SH } from "../components/Card";
import ModalBottomSheet from "../components/ModalBottomSheet";
import {
  radarVerisiniCek, performansTablosunuCek, isiHaritasiniCek, bantVerisiniCek, socket, Bant, getPiSamples,
  aylikUretimVerisiniCek, makineUretimVerisiniCek, hataMakineSayilariniCek, AylikUretim, MakineUretimi, MakineHataSayisi,
} from "../services/api";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useNavigation } from "@react-navigation/native";

const W = Dimensions.get("window").width;

// Basit SVG Radar – react-native-svg
import Svg, { Polygon, Line, Text as SvgText, Circle } from "react-native-svg";
function RadarGraf({ data }: { data: any[] }) {
  const cx = 110, cy = 100, r = 70;
  if (!data || data.length === 0) return null;
  const n = data.length;
  const toXY = (i: number, val: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const dist = (val / 100) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };
  const labelXY = (i: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + (r + 18) * Math.cos(angle), y: cy + (r + 18) * Math.sin(angle) };
  };
  const gridLevels = [25, 50, 75, 100];
  const points = data.map((d, i) => toXY(i, d.value));
  const pointStr = points.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <Svg width={W - 80} height={200} viewBox="0 0 220 200">
      {/* Izgara */}
      {gridLevels.map(lv => {
        const gPts = data.map((_, i) => toXY(i, lv));
        const gStr = gPts.map(p => `${p.x},${p.y}`).join(" ");
        return <Polygon key={lv} points={gStr} fill="none" stroke={C.border} strokeWidth="1" />;
      })}
      {/* Eksenler */}
      {data.map((_, i) => {
        const ep = toXY(i, 100);
        return <Line key={i} x1={cx} y1={cy} x2={ep.x} y2={ep.y} stroke={C.border} strokeWidth="1" />;
      })}
      {/* Veri */}
      <Polygon points={pointStr} fill={`${C.peach}30`} stroke={C.peach} strokeWidth="2" />
      {/* Etiketler */}
      {data.map((d, i) => {
        const lp = labelXY(i);
        return <SvgText key={i} x={lp.x} y={lp.y} textAnchor="middle" alignmentBaseline="middle" fontSize="9" fill={C.muted}>{d.label}</SvgText>;
      })}
    </Svg>
  );
}

// Halka (donut) grafik — kalite dağılımı gibi oranları göstermek için.
// Standart SVG tekniği: her dilim için strokeDasharray/strokeDashoffset,
// -90° döndürerek saat 12 yönünden başlatılıyor.
function DonutGraf({ segments, merkezEtiket, merkezDeger }: { segments: { pct: number; color: string }[]; merkezEtiket: string; merkezDeger: string }) {
  const size = 132, strokeWidth = 20;
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const cevre = 2 * Math.PI * r;
  let birikimPct = 0;
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={c} cy={c} r={r} stroke={C.border} strokeWidth={strokeWidth} fill="none" />
        {segments.filter(s => s.pct > 0.01).map((s, i) => {
          const dilimUzunlugu = (s.pct / 100) * cevre;
          const offset = -((birikimPct / 100) * cevre);
          birikimPct += s.pct;
          return (
            <Circle
              key={i}
              cx={c} cy={c} r={r}
              stroke={s.color}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${dilimUzunlugu} ${cevre - dilimUzunlugu}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${c} ${c})`}
            />
          );
        })}
      </Svg>
      <View style={{ position: "absolute", alignItems: "center" }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: C.text }}>{merkezDeger}</Text>
        <Text style={{ fontSize: 8.5, color: C.muted, marginTop: 1 }}>{merkezEtiket}</Text>
      </View>
    </View>
  );
}

// Sıralı yatay bar listesi — "hangi makine daha fazla" tarzı karşılaştırmalar için.
function SiraliBarListesi({ data, renk, birim, madalyaGoster = true }: { data: { label: string; deger: number }[]; renk: string; birim?: string; madalyaGoster?: boolean }) {
  if (!data || data.length === 0) {
    return <Text style={{ fontSize: 11, color: C.muted, paddingVertical: 16, textAlign: "center" }}>Henüz veri yok.</Text>;
  }
  const max = Math.max(1, ...data.map(d => d.deger));
  const madalya = (i: number) => !madalyaGoster ? "" : i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "";
  return (
    <View style={{ gap: 12 }}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
            <Text style={{ fontSize: 10.5, fontWeight: "600", color: C.text }}>{madalya(i)}{d.label}</Text>
            <Text style={{ fontSize: 10.5, fontWeight: "700", color: renk }}>{d.deger.toLocaleString("tr-TR")}{birim || ""}</Text>
          </View>
          <View style={{ height: 8, borderRadius: 99, backgroundColor: "#D8E6F0", overflow: "hidden" }}>
            <View style={{ height: "100%", width: `${Math.max(2, (d.deger / max) * 100)}%`, backgroundColor: renk, borderRadius: 99 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const AY_KISALTMA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
function ayEtiketi(ay: string): string {
  const [yil, ayNo] = ay.split("-");
  return `${AY_KISALTMA[Number(ayNo) - 1] || ayNo} '${yil.slice(2)}`;
}

// Isı haritası rengi
function isiRengi(v: number): string {
  const ops = ["1A", "30", "50", "80", "B0", "E0"];
  const i = v >= 90 ? 5 : v >= 80 ? 4 : v >= 70 ? 3 : v >= 60 ? 2 : v >= 50 ? 1 : 0;
  return `${C.peach}${ops[i]}`;
}

export default function AnalizEkrani() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [radarData, setRadarData] = useState<any[]>([]);
  const [performansData, setPerformansData] = useState<any[]>([]);
  const [isiData, setIsiData] = useState<{ hatlar: string[], sutunlar: string[], degerler: number[][] }>({ hatlar: [], sutunlar: [], degerler: [] });
  const [raporYukleniyor, setRaporYukleniyor] = useState(false);
  const [raporBasarili, setRaporBasarili] = useState(false);
  const [detayModal, setDetayModal] = useState(false);
  const [canliBantlar, setCanliBantlar] = useState<Bant[]>([]);
  const [piTrendler, setPiTrendler] = useState<any[]>([]);
  const [aylikUretim, setAylikUretim] = useState<AylikUretim[]>([]);
  const [makineUretimi, setMakineUretimi] = useState<MakineUretimi[]>([]);
  const [hataSayilari, setHataSayilari] = useState<MakineHataSayisi[]>([]);

  // Ortalama OEE artık canlı gelen bant verisinden türetiliyor (bant_guncellendi
  // ile zaten anlık güncelleniyor) — ayrı, tek seferlik bir REST isteğine
  // (piOee state'i) bağlı değil, bu yüzden ekranı yenilemeden de akıyor.
  const piOee = canliBantlar.length > 0
    ? canliBantlar.reduce((sum, b) => sum + (b.oee || 0), 0) / canliBantlar.length
    : 0;

  useEffect(() => {
    const veriCek = async (bantIdIcinTrend?: string) => {
      try {
        const [rData, pData, iData, bVeri, ayData, makineData, hataData] = await Promise.all([
          radarVerisiniCek(),
          performansTablosunuCek(),
          isiHaritasiniCek(),
          bantVerisiniCek(),
          aylikUretimVerisiniCek(),
          makineUretimVerisiniCek(),
          hataMakineSayilariniCek(),
        ]);
        setRadarData(rData || []);
        setPerformansData(pData || []);
        setIsiData(iData || { hatlar: [], sutunlar: [], degerler: [] });
        setAylikUretim(ayData || []);
        setMakineUretimi(makineData || []);
        setHataSayilari(hataData || []);

        // "acik" (o an üretiyor) değil, "bağlı" (sisteme veri gönderiyor) olan
        // bantları alıyoruz — kısa süreli duruşta bant burada kaybolmasın.
        const bagliBantlar = bVeri.filter(b => b.baglantiDurumu === "ONLINE");
        setCanliBantlar(bagliBantlar);

        const trendBantId = bantIdIcinTrend || bagliBantlar[0]?.id;
        if (trendBantId) {
          const samples = await getPiSamples(trendBantId);
          setPiTrendler(samples);
        }
      } catch (err) {
        console.error("Analiz verileri alınamadı:", err);
      } finally {
        setLoading(false);
      }
    };
    veriCek();
    const refreshListener = DeviceEventEmitter.addListener("onGlobalRefresh", () => {
      if (navigation.isFocused()) {
        setLoading(true);
        veriCek();
      }
    });

    socket.on("bant_guncellendi", (guncelBant: Bant) => {
      setCanliBantlar(prev => {
        const kopya = [...prev];
        const idx = kopya.findIndex(b => b.id === guncelBant.id);
        if (idx !== -1) {
          kopya[idx] = { ...kopya[idx], ...guncelBant };
        } else if (guncelBant.baglantiDurumu === "ONLINE") {
          kopya.push(guncelBant);
        }
        return kopya;
      });
    });

    // "Üretim Büyümesi" grafiği geçmiş trend kayıtlarından besleniyor, bu
    // canlı soket ile gelmiyor (merkez sadece anlık durumu yayınlıyor) —
    // ekranı yenilemeden de ilerlemesi için periyodik olarak tazeliyoruz.
    const trendInterval = setInterval(() => {
      setCanliBantlar(guncel => {
        if (guncel.length > 0) getPiSamples(guncel[0].id).then(setPiTrendler);
        return guncel;
      });
    }, 30000);

    return () => {
      socket.off("bant_guncellendi");
      refreshListener.remove();
      clearInterval(trendInterval);
    };
  }, []);

  const raporIndir = async () => {
    setRaporYukleniyor(true);
    setRaporBasarili(false);
    try {
      const gecti = gectiPct.toFixed(2);
      const uyariAdet = Math.floor(aktifToplamUretim * (uyariPct / 100));

      const calismaSn = canliBantlar.reduce((sum, b) => sum + ((b.calismaSuresi || 0) * 3600), 0);
      const durusSn = canliBantlar.reduce((sum, b) => sum + (b.duruşSuresiSn || 0), 0);

      const formatTime = (secs: number) => {
        if (!secs) return "0dk";
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return h > 0 ? `${h}s ${m}dk` : `${m}dk`;
      };

      const totalOee = canliBantlar.reduce((sum, b) => sum + (b.oee || 0), 0);
      const totalAvail = canliBantlar.reduce((sum, b) => sum + (b.availability || 0), 0);
      const totalQual = canliBantlar.reduce((sum, b) => sum + (b.qualityOrani || 0), 0);

      const avgOee = canliBantlar.length > 0 ? (totalOee / canliBantlar.length).toFixed(1) : "0.0";
      const avgAvail = canliBantlar.length > 0 ? (totalAvail / canliBantlar.length).toFixed(1) : "0.0";
      const avgQual = canliBantlar.length > 0 ? (totalQual / canliBantlar.length).toFixed(1) : "0.0";
      const avgPerf = (Number(avgAvail) > 0 && Number(avgQual) > 0) ? (Number(avgOee) / ((Number(avgAvail) / 100) * (Number(avgQual) / 100))).toFixed(1) : "0.0";

      const bantRows = canliBantlar.length > 0 ? canliBantlar.map(b => {
        const fire = b.toplamUretim && b.toplamUretim > 0 ? (((b.toplamUretim - (b.iyiUretim || 0)) / b.toplamUretim) * 100).toFixed(1) : "0";
        return `
          <tr>
            <td>${b.isim}</td>
            <td style="color: ${b.durum === 'acik' ? '#2F9C95' : '#E76F51'}">${b.durum === 'acik' ? 'Çalışıyor' : 'Durdu'}</td>
            <td>${(b.toplamUretim || 0).toLocaleString("tr-TR")}</td>
            <td>%${fire}</td>
            <td>${b.anlikHiz || 0} br/dk</td>
          </tr>
        `;
      }).join('') : `<tr><td colspan="5" style="text-align:center;">Aktif hat bulunamadı.</td></tr>`;

      const dateStr = new Date().toLocaleString("tr-TR");
      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; padding: 40px; color: #24292e; line-height: 1.5; font-size: 14px; }
              h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; margin-bottom: 16px; margin-top: 0; }
              h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; margin-top: 24px; margin-bottom: 16px; }
              hr { height: 0.25em; padding: 0; margin: 24px 0; background-color: #e1e4e8; border: 0; }
              p { margin-top: 0; margin-bottom: 16px; }
              table { border-collapse: collapse; width: 100%; margin-top: 0; margin-bottom: 16px; }
              table th, table td { padding: 6px 13px; border: 1px solid #dfe2e5; }
              table th { font-weight: 600; text-align: left; }
              table tr { background-color: #fff; border-top: 1px solid #c6cbd1; }
              table tr:nth-child(2n) { background-color: #f6f8fa; }
            </style>
          </head>
          <body>
            <h1>Üretim Performans Raporu</h1>

            <p><strong>Oluşturulma:</strong> ${dateStr}</p>

            <hr />

            <h2>Vardiya / Zaman Bilgisi</h2>

            <table>
              <thead>
                <tr><th>Vardiya</th><th>Kapsanan Aralık</th><th>Toplam Çalışma Süresi</th><th>Toplam Duruş Süresi</th></tr>
              </thead>
              <tbody>
                <tr><td>Vardiya 2 (08:00–16:00)</td><td>${dateStr.split(' ')[0]} 08:00 – ${dateStr.split(' ')[1]}</td><td>${formatTime(calismaSn)}</td><td>${formatTime(durusSn)}</td></tr>
              </tbody>
            </table>

            <hr />

            <h2>Genel Özet</h2>

            <table>
              <thead>
                <tr><th>Metrik</th><th>Değer</th><th>Detay</th></tr>
              </thead>
              <tbody>
                <tr><td>Toplam Üretim</td><td>${aktifToplamUretim.toLocaleString("tr-TR")} adet</td><td>Aktif Parti Sayısı: ${canliBantlar.length}</td></tr>
                <tr><td>Sertifikalı Ürün</td><td>%${gecti} (${aktifIyiUretim.toLocaleString("tr-TR")} adet)</td><td>Geçen ürün sayısı</td></tr>
                <tr><td>Uyarı Seviyesi</td><td>%${uyariPct.toFixed(2)} (${uyariAdet.toLocaleString("tr-TR")} adet)</td><td>Uyarı sınırındaki ürün sayısı</td></tr>
                <tr><td>Hatalı / Fire</td><td>%${redPct.toFixed(2)} (${aktifHatali.toLocaleString("tr-TR")} adet)</td><td>Reddedilen ürün sayısı</td></tr>
              </tbody>
            </table>

            <hr />

            <h2>OEE Performans Kırılımı</h2>

            <p><strong>Genel OEE: %${avgOee}</strong></p>

            <table>
              <thead>
                <tr><th>Bileşen</th><th>Oran</th></tr>
              </thead>
              <tbody>
                <tr><td>Kullanılabilirlik (Availability)</td><td>%${avgAvail}</td></tr>
                <tr><td>Performans (Performance)</td><td>%${Math.min(100, Number(avgPerf)).toFixed(1)}</td></tr>
                <tr><td>Kalite (Quality)</td><td>%${avgQual}</td></tr>
              </tbody>
            </table>

            <hr />

            <h2>Hat Bazlı Detaylar</h2>

            <table>
              <thead>
                <tr><th>Hat</th><th>Durum</th><th>Üretim (adet)</th><th>Fire Oranı</th><th>Anlık Hız</th></tr>
              </thead>
              <tbody>
                ${bantRows}
              </tbody>
            </table>

            <hr />

            <h2>Onay</h2>

            <table>
              <thead>
                <tr><th>İşletme Sorumlusu</th><th>Vardiya Amiri</th><th>Kalite Kontrol</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ad Soyad / İmza / Tarih<br><br><br><br></td>
                  <td>Ad Soyad / İmza / Tarih<br><br><br><br></td>
                  <td>Ad Soyad / İmza / Tarih<br><br><br><br></td>
                </tr>
              </tbody>
            </table>

          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Analitik Raporunu İndir' });
      setRaporBasarili(true);
      setTimeout(() => setRaporBasarili(false), 3000);
    } catch (error: any) {
      console.error("PDF Hatası:", error);
      Alert.alert("Rapor oluşturulamadı", error?.message || "Bilinmeyen bir hata oluştu.");
    } finally {
      setRaporYukleniyor(false);
    }
  };


  // Veritabanına kaydedilmiş gerçek Trend kayıtları dışında bir şey göstermiyoruz.
  const gercekTrendVar = !!(piTrendler && piTrendler.length > 0);
  const buyumeData = gercekTrendVar
    ? piTrendler.map(t => ({ value: t.kaliteOrani ?? t.oee ?? 0 }))
    : [];
  const buyumeEtiketleri = gercekTrendVar
    ? piTrendler.map(t => new Date(t.timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }))
    : [];
  const buyumeYuzde = (buyumeData.length >= 2 && buyumeData[0].value > 0)
    ? ((buyumeData[buyumeData.length - 1].value - buyumeData[0].value) / buyumeData[0].value) * 100
    : null;

  // CANLI VERİLERDEN HESAPLAMALAR
  const aktifToplamUretim = (canliBantlar || []).reduce((sum, b) => sum + (b.toplamUretim || 0), 0);
  const aktifIyiUretim = (canliBantlar || []).reduce((sum, b) => sum + (b.iyiUretim || 0), 0);
  const aktifHatali = Math.max(0, aktifToplamUretim > 0 ? (aktifToplamUretim - aktifIyiUretim) : 0);

  // "Sertifikalı" Pi'nin doğrudan bildirdiği katı sertifika oranı olmalı
  // (OEE değil — OEE, kullanılabilirlik x performans x kalite karışımı,
  // duruş arttıkça sertifika oranı değişmese bile düşer, yanıltıcı olur).
  const ortalamaSertifikaOrani = canliBantlar.length > 0
    ? canliBantlar.reduce((sum, b) => sum + (b.sertifikaOrani || 0), 0) / canliBantlar.length
    : 0;
  // "Kabul Edilebilir" ise sayaçların ham iyi/toplam oranı — sertifikadan
  // daha gevşek bir eşik, sertifikalı olanı da kapsar (üst küme).
  const ortalamaKabulOrani = aktifToplamUretim > 0
    ? (aktifIyiUretim / aktifToplamUretim) * 100
    : ortalamaSertifikaOrani;

  const gectiPct = Math.min(100, Math.max(0, ortalamaSertifikaOrani));
  const kabulPct = Math.min(100, Math.max(gectiPct, ortalamaKabulOrani));
  const uyariPct = Math.max(0, kabulPct - gectiPct); // kabul edilebilir ama sertifikalı olmayan dilim
  const redPct = Math.max(0, 100 - kabulPct);

  const kaliteSeviyeler = [
    { label: "Sertifikalı", pct: gectiPct, color: C.mint, text: `%${gectiPct.toFixed(2)}` },
    { label: "Kabul Edilebilir", pct: Math.max(0, uyariPct), color: C.blue, text: `%${Math.max(0, uyariPct).toFixed(2)}` },
    { label: "Hatalı", pct: redPct, color: C.peach, text: `%${redPct.toFixed(2)}` },
  ];

  if (loading) {
    return <View style={[s.scroll, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={C.peach} /></View>;
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

      {/* Başlık */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View>
          <Text style={s.dateText}>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          <Text style={s.pageTitle}>Sonuçlar &</Text>
          <Text style={s.pageTitle}>Analitikler</Text>
        </View>
        <TouchableOpacity
          style={[s.exportBtn, { backgroundColor: raporYukleniyor ? C.blueLt : C.blue, borderColor: C.blue }]}
          onPress={raporIndir}
          disabled={raporYukleniyor}
        >
          {raporYukleniyor
            ? <ActivityIndicator size="small" color="white" />
            : <Download size={12} color="white" />
          }
          <Text style={[s.exportBtnText, { color: "white" }]}>
            {raporYukleniyor ? "Hazırlanıyor..." : "Rapor İndir"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Rapor Başarı Toast */}
      {raporBasarili && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.mintLt, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.mint }}>
          <CheckCircle size={14} color={C.mint} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: C.mint }}>Rapor başarıyla indirildi!</Text>
        </View>
      )}

      {/* Stat kutucukları */}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={[s.stat, { backgroundColor: C.peachLt }]}>
          <Text style={s.statLabel}>Sertifika Oranı</Text>
          <Text style={[s.statNum, { color: C.text }]}>%{gectiPct.toFixed(2)}</Text>
          <Text style={[s.statSub, { color: C.mint }]}>+%0,3 ↑</Text>
        </View>
        <View style={[s.stat, { backgroundColor: C.mintLt }]}>
          <Text style={s.statLabel}>İyi Ürünler</Text>
          <Text style={[s.statNum, { color: C.text }]}>{aktifIyiUretim.toLocaleString("tr-TR")}</Text>
          <Text style={[s.statSub, { color: C.mint }]}>+%1,0 ↑</Text>
        </View>
      </View>

      {/* Kalite Seviye Analizi */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={s.cardTitle}>Kalite Seviye Analizi</Text>
          <ChevronRight size={14} color={C.muted} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 16 }}>
          {kaliteSeviyeler.map(q => (
            <View key={q.label} style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: q.color }}>{q.text}</Text>
              <Text style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{q.label}</Text>
            </View>
          ))}
        </View>
        {kaliteSeviyeler.map(q => (
          <View key={q.label} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Text style={{ fontSize: 9, width: 80, color: C.muted }}>{q.label}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 99, backgroundColor: "#D8E6F0", overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${q.pct}%`, backgroundColor: q.color, borderRadius: 99 }} />
            </View>
            <Text style={{ fontSize: 9, width: 28, textAlign: "right", color: C.muted }}>{q.text}</Text>
          </View>
        ))}
        <View style={[s.grid3, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, marginTop: 4 }]}>
          {[
            { label: "Sertifikalı", sub: `${aktifIyiUretim.toLocaleString("tr-TR")} birim`, color: C.mint },
            { label: "İncelendi", sub: `${Math.floor(aktifIyiUretim * 0.15).toLocaleString("tr-TR")} birim doğru`, color: C.blue },
            { label: "Aksiyon", sub: "Bu hafta 2 denetim ekle", color: C.peach },
          ].map(r => (
            <View key={r.label} style={[s.miniCard, { backgroundColor: `${r.color}18` }]}>
              <Text style={{ fontSize: 9, fontWeight: "700", color: r.color, marginBottom: 2 }}>{r.label}</Text>
              <Text style={{ fontSize: 8, color: C.muted, lineHeight: 12 }}>{r.sub}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Ürün Kalite Dağılımı (Grafik) */}
      <Card>
        <SH title="Ürün Kalite Dağılımı" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <DonutGraf
            segments={[
              { pct: gectiPct, color: C.mint },
              { pct: uyariPct, color: C.blue },
              { pct: redPct, color: C.peach },
            ]}
            merkezEtiket="Sertifikalı"
            merkezDeger={`%${gectiPct.toFixed(0)}`}
          />
          <View style={{ flex: 1, gap: 10 }}>
            {kaliteSeviyeler.map(q => (
              <View key={q.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: q.color }} />
                <Text style={{ fontSize: 10.5, color: C.muted, flex: 1 }}>{q.label}</Text>
                <Text style={{ fontSize: 10.5, fontWeight: "700", color: C.text }}>{q.text}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 9, color: C.muted, marginTop: 4, lineHeight: 13 }}>
              Toplam üretimden sertifikasız (Kabul Edilebilir + Hatalı) oran: %{(uyariPct + redPct).toFixed(2)}
            </Text>
          </View>
        </View>
      </Card>

      {/* Üretim Özet Bakış */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={s.cardTitle}>Üretim Özet Bakış</Text>
          <Text style={{ fontSize: 10, fontWeight: "700", color: C.mint }}>+%8,7 ↑</Text>
        </View>
        <Text style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
          Toplam Çalışma: <Text style={{ fontWeight: "700", color: C.text }}>{aktifToplamUretim.toLocaleString("tr-TR")}</Text>
        </Text>
        <View style={{ height: 8, borderRadius: 99, backgroundColor: "#D8E6F0", overflow: "hidden", marginBottom: 12 }}>
          <View style={{ height: "100%", width: `${gectiPct}%`, backgroundColor: C.peach, borderRadius: 99 }} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {[
            { dot: C.mint, label: "İyi Çıktı", val: `${aktifIyiUretim.toLocaleString("tr-TR")}` },
            { dot: C.lav, label: "Hatalı", val: `${aktifHatali.toLocaleString("tr-TR")}` },
          ].map(r => (
            <View key={r.label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.dot }} />
              <Text style={{ fontSize: 10, color: C.muted }}>{r.label}</Text>
              <Text style={{ fontSize: 10, fontWeight: "700", color: C.text }}>{r.val}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Makinelere Göre Üretim — hangi makine daha fazla çalıştı (toplam üretim verisine göre) */}
      <Card>
        <SH title="Makinelere Göre Üretim" />
        <Text style={{ fontSize: 10, color: C.muted, marginTop: -6, marginBottom: 12 }}>
          Toplam üretim adedine göre sıralandı — en çok üreten makine en üstte.
        </Text>
        <SiraliBarListesi
          data={makineUretimi.map(m => ({ label: m.isim, deger: m.toplamUretim }))}
          renk={C.blue}
        />
      </Card>

      {/* Öneriler */}
      <Card>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
          <View style={[s.iconBox, { backgroundColor: C.blueLt }]}>
            <Zap size={14} color={C.blue} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.cardTitle, { marginBottom: 8 }]}>Tip-M İçin Öneriler</Text>
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View style={[s.pill, { backgroundColor: C.peachLt }]}>
                  <Text style={{ fontSize: 9, fontWeight: "600", color: C.peach }}>Kritik</Text>
                </View>
                <Text style={{ fontSize: 10, color: C.muted, flex: 1 }}>Ort. Puan %58  ·  Birimlerin %40'ı &lt;90%</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <View style={[s.pill, { backgroundColor: C.mintLt }]}>
                  <Text style={{ fontSize: 9, fontWeight: "600", color: C.mint }}>Aksiyon</Text>
                </View>
                <Text style={{ fontSize: 10, color: C.muted, flex: 1 }}>Bu hafta 2 hat denetimi + 1 atölye ekle</Text>
              </View>
            </View>
          </View>
        </View>
      </Card>

      {/* Radar Grafiği */}
      <Card>
        <SH title="Kategoriye Göre Makine Performansı" action="Detaylar" onAction={() => setDetayModal(true)} />
        <View style={{ alignItems: "center" }}>
          <RadarGraf data={radarData} />
        </View>
      </Card>

      {/* Isı Haritası */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={s.cardTitle}>Üretim Hattına Göre Performans</Text>
          <Calendar size={13} color={C.muted} />
        </View>
        {/* Başlık satırı */}
        <View style={{ flexDirection: "row", marginBottom: 6 }}>
          <View style={{ width: 48 }} />
          {isiData.sutunlar?.map((c: string) => (
            <View key={c} style={{ flex: 1, alignItems: "center" }}>
              <Text style={{ fontSize: 7.5, fontWeight: "600", color: C.muted }}>{c}</Text>
            </View>
          ))}
        </View>
        {isiData.hatlar?.map((hat: string, ri: number) => (
          <View key={hat} style={{ flexDirection: "row", marginBottom: 4 }}>
            <View style={{ width: 48, justifyContent: "center" }}>
              <Text style={{ fontSize: 8, color: C.muted }}>{hat}</Text>
            </View>
            {isiData.degerler[ri]?.map((val: number, ci: number) => (
              <View key={ci} style={{ flex: 1, height: 16, marginHorizontal: 1, borderRadius: 3, backgroundColor: isiRengi(val) }} />
            ))}
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border }}>
          <Text style={{ fontSize: 7.5, color: C.muted }}>0–40</Text>
          {["1A", "30", "50", "80", "B0", "E0"].map(op => (
            <View key={op} style={{ width: 16, height: 10, borderRadius: 2, backgroundColor: `${C.peach}${op}` }} />
          ))}
          <Text style={{ fontSize: 7.5, color: C.muted }}>80+</Text>
        </View>
      </Card>

      {/* Büyüme Grafiği */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <Text style={s.cardTitle}>Üretim Büyümesi</Text>
          {buyumeYuzde !== null && (
            <Text style={{ fontSize: 11, fontWeight: "700", color: buyumeYuzde >= 0 ? C.mint : C.peach }}>
              {buyumeYuzde >= 0 ? "+" : ""}%{buyumeYuzde.toFixed(1)} {buyumeYuzde >= 0 ? "↑" : "↓"}
            </Text>
          )}
        </View>
        <Text style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>Kaydedilmiş trend verisi üzerinden</Text>
        {gercekTrendVar ? (
          <LineChart
            data={buyumeData}
            width={W - 80}
            height={90}
            color={C.mint}
            thickness={2}
            dataPointsColor={C.mint}
            dataPointsRadius={3}
            areaChart
            startFillColor={C.mint}
            startOpacity={0.28}
            endOpacity={0}
            rulesColor="transparent"
            xAxisColor="transparent"
            yAxisColor="transparent"
            xAxisLabelTexts={buyumeEtiketleri}
            xAxisLabelTextStyle={{ color: C.muted, fontSize: 8 }}
            yAxisTextStyle={{ color: C.muted, fontSize: 8 }}
            noOfSections={2}
            spacing={35}
            initialSpacing={15}
            endSpacing={15}
          />
        ) : (
          <Text style={{ fontSize: 11, color: C.muted, paddingVertical: 20, textAlign: "center" }}>
            Henüz kaydedilmiş trend verisi yok.
          </Text>
        )}
      </Card>

      {/* Ay Bazında Üretim (nokta grafiği) */}
      <Card>
        <SH title="Ay Bazında Üretim" />
        <Text style={{ fontSize: 10, color: C.muted, marginTop: -6, marginBottom: 12 }}>
          Tüm makinelerin birleşik toplam üretimi, aylara göre.
        </Text>
        {aylikUretim.length > 0 ? (
          <LineChart
            data={aylikUretim.map(a => ({ value: a.uretim }))}
            width={W - 80}
            height={110}
            color={C.blue}
            thickness={2}
            dataPointsColor={C.blue}
            dataPointsRadius={4}
            curved
            rulesColor={C.border}
            xAxisColor="transparent"
            yAxisColor="transparent"
            xAxisLabelTexts={aylikUretim.map(a => ayEtiketi(a.ay))}
            xAxisLabelTextStyle={{ color: C.muted, fontSize: 8 }}
            yAxisTextStyle={{ color: C.muted, fontSize: 8 }}
            noOfSections={3}
            spacing={Math.max(35, (W - 120) / Math.max(1, aylikUretim.length))}
            initialSpacing={15}
            endSpacing={15}
          />
        ) : (
          <Text style={{ fontSize: 11, color: C.muted, paddingVertical: 20, textAlign: "center" }}>
            Henüz aylık üretim verisi birikmedi — sistem üretim yaptıkça burada dolacak.
          </Text>
        )}
      </Card>

      {/* Makinelere Göre Hata Sayısı */}
      <Card>
        <SH title="Makinelere Göre Hata Sayısı" action="Hata Girişi" onAction={() => navigation.navigate("HataGirisi")} />
        <Text style={{ fontSize: 10, color: C.muted, marginTop: -6, marginBottom: 12 }}>
          Açıklanmış hata bildirimi sayısı, makineye göre.
        </Text>
        <SiraliBarListesi
          data={hataSayilari.map(h => ({ label: h.isim, deger: h.adet }))}
          renk={C.peach}
          birim=" hata"
          madalyaGoster={false}
        />
      </Card>

      {/* Hızlı Performans Tablosu */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text style={s.cardTitle}>Hızlı Performans Hızlanması</Text>
          <Text style={{ fontSize: 9, color: C.muted }}>Bu hafta</Text>
        </View>
        <View style={[s.tableHeader, { borderBottomColor: C.border }]}>
          {["Öncelik", "Hat", "Durum", "Aksiyon"].map(h => (
            <Text key={h} style={s.tableHeaderText}>{h}</Text>
          ))}
        </View>
        {(performansData || []).map((row: any, i: number) => {
          const tagStyle =
            row.oncelik === "Acil" ? { bg: C.peachLt, color: C.peach } :
              row.oncelik === "Yüksek" ? { bg: "#EBF0FA", color: "#2E5DA8" } :
                row.oncelik === "Orta" ? { bg: C.mintLt, color: C.mint } :
                  { bg: C.blueLt, color: C.blue };
          return (
            <View key={i} style={[s.tableRow, { borderBottomWidth: i < performansData.length - 1 ? 1 : 0, borderBottomColor: C.border }]}>
              <View style={[s.priorityTag, { backgroundColor: tagStyle.bg }]}>
                <Text style={[s.priorityText, { color: tagStyle.color }]}>{row.oncelik}</Text>
              </View>
              <Text style={[s.tableCell, { color: C.text }]}>{row.hat}</Text>
              <Text style={[s.tableCell, { color: C.muted, fontSize: 8.5 }]}>{row.durum}</Text>
              <Text style={[s.tableCell, { color: C.peach, fontWeight: "700" }]}>{row.aksiyon}</Text>
            </View>
          );
        })}
      </Card>

      {/* Detaylar Bilgi Modalı */}
      <ModalBottomSheet
        visible={detayModal}
        onClose={() => setDetayModal(false)}
        title="Radar Grafiği Hakkında"
      >
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <View style={{ backgroundColor: C.blueLt, borderRadius: 12, padding: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: C.text, marginBottom: 6 }}>Bu grafik ne gösteriyor?</Text>
            <Text style={{ fontSize: 12, color: C.muted, lineHeight: 20 }}>
              Radar grafiği, makinelerinizin 6 farklı performans kategorisindeki genel durumunu karşılaştırmalı olarak gösterir.
            </Text>
          </View>
          {[
            { label: "Hız", desc: "Makinenin anlık bant hızı (b/dak)" },
            { label: "Kalite", desc: "İyi ürün oranı (%)" },
            { label: "Verimlilik", desc: "Planlanan üretim hedefine ulaşma oranı" },
            { label: "Çalışma", desc: "Toplam açık kalma süresi oranı" },
            { label: "Hassasiyet", desc: "Hata payı düşük olan üretim adedi" },
            { label: "Güvenilirlik", desc: "Arıza olmadan çalışma sürekliliği" },
          ].map(item => (
            <View key={item.label} style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.peach, marginTop: 5 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: C.text }}>{item.label}</Text>
                <Text style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      </ModalBottomSheet>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  dateText: { fontSize: 11, color: C.muted },
  pageTitle: { fontSize: 21, fontWeight: "800", color: C.text, lineHeight: 26 },
  exportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  exportBtnText: { fontSize: 11, fontWeight: "700" },
  stat: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  statLabel: { fontSize: 10, color: C.muted, marginBottom: 6 },
  statNum: { fontSize: 21, fontWeight: "800", marginBottom: 4 },
  statSub: { fontSize: 10, fontWeight: "500" },
  cardTitle: { fontSize: 13, fontWeight: "600", color: C.text },
  grid3: { flexDirection: "row", gap: 8 },
  miniCard: { flex: 1, borderRadius: 12, padding: 10 },
  iconBox: { width: 36, height: 36, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, alignSelf: "flex-start" },

  tableHeader: { flexDirection: "row", paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1 },
  tableHeaderText: { flex: 1, fontSize: 8, fontWeight: "700", textTransform: "uppercase", color: C.muted },
  tableRow: { flexDirection: "row", paddingVertical: 8, alignItems: "center" },
  tableCell: { flex: 1, fontSize: 9 },
  priorityTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, marginRight: 4 },
  priorityText: { fontSize: 8.5, fontWeight: "700" },
});
