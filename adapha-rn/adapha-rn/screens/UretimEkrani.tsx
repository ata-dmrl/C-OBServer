import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator, DeviceEventEmitter, Alert
} from "react-native";
import { CheckCircle } from "lucide-react-native";
import { C } from "../constants/colors";
import { Card, SH } from "../components/Card";
import { bantVerisiniCek, socket, Bant } from "../services/api";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useNavigation } from "@react-navigation/native";

const W = Dimensions.get("window").width;

// Pi'den gelecek verilerle doldurulacak, artık sahte liste yok.

export default function UretimEkrani() {
  const navigation = useNavigation<any>();
  const [raporYukleniyor, setRaporYukleniyor] = useState(false);
  const [raporBasarili, setRaporBasarili] = useState(false);

  // Canlı veriler
  const [canliBantlar, setCanliBantlar] = useState<Bant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const veriCek = async () => {
      const bVeri = await bantVerisiniCek();
      // "acik" (o an üretiyor) değil, "bağlı" (sisteme veri gönderiyor) olan
      // bantları alıyoruz — kısa süreli duruşta bant burada kaybolmasın.
      const bagliBantlar = bVeri.filter(b => b.baglantiDurumu === "ONLINE");
      setCanliBantlar(bagliBantlar);
      setLoading(false);
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

    return () => {
      socket.off("bant_guncellendi");
      refreshListener.remove();
    };
  }, []);

  const aktifToplamUretim = (canliBantlar || []).reduce((sum, b) => sum + (b.toplamUretim || 0), 0);
  const aktifIyiUretim = (canliBantlar || []).reduce((sum, b) => sum + (b.iyiUretim || 0), 0);
  const aktifHatali = aktifToplamUretim - aktifIyiUretim;

  const rawGectiPct = aktifToplamUretim > 0 ? (aktifIyiUretim / aktifToplamUretim) * 100 : 0;
  const rawRedPct = aktifToplamUretim > 0 ? (aktifHatali / aktifToplamUretim) * 100 : 0;

  const gectiPct = Math.min(100, Math.max(0, rawGectiPct));
  const redPct = Math.min(100 - gectiPct, Math.max(0, rawRedPct));
  const uyariPct = Math.max(0, 100 - gectiPct - redPct);

  const aktifPartiSayisi = canliBantlar.length;

  const aktifModeller = Array.from(new Set(canliBantlar.map(b => b.mevcutModel).filter(Boolean)));

  const kaliteDagilim = [
    { label: "Geçti", val: `%${gectiPct.toFixed(2)}`, pct: gectiPct, color: C.mint },
    { label: "Uyarı", val: `%${Math.max(0, uyariPct).toFixed(2)}`, pct: Math.max(0, uyariPct), color: C.sand },
    { label: "Reddedildi", val: `%${redPct.toFixed(2)}`, pct: redPct, color: C.peach },
  ];

  const raporIndir = async () => {
    setRaporYukleniyor(true);
    setRaporBasarili(false);
    try {
      const gecti = gectiPct.toFixed(2);

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

      const uyariAdet = Math.floor(aktifToplamUretim * (uyariPct / 100));

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
                <tr><td>Toplam Üretim</td><td>${aktifToplamUretim.toLocaleString("tr-TR")} adet</td><td>Aktif Parti Sayısı: ${aktifPartiSayisi}</td></tr>
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
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Üretim Raporunu İndir' });
      setRaporBasarili(true);
      setTimeout(() => setRaporBasarili(false), 3000);
    } catch (error: any) {
      console.error("PDF Hatası:", error);
      Alert.alert("Rapor oluşturulamadı", error?.message || "Bilinmeyen bir hata oluştu.");
    } finally {
      setRaporYukleniyor(false);
    }
  };

  if (loading) {
    return <View style={[s.scroll, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={C.peach} /></View>;
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

      {/* Başlık */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View>
          <Text style={s.dateText}>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          <Text style={s.pageTitle}>Üretim</Text>
          <Text style={s.pageSub}>Yönetimi</Text>
        </View>
      </View>

      {/* Başarı / Bildirim Toastları */}
      {raporBasarili && (
        <View style={s.toast}>
          <CheckCircle size={14} color={C.mint} />
          <Text style={s.toastText}>Rapor başarıyla indirildi!</Text>
        </View>
      )}

      {/* İstatistikler */}
      <View style={s.statRow}>
        <View style={[s.stat, { backgroundColor: C.blueLt }]}>
          <View style={s.statTopRow}>
            <Text style={s.statLabel}>Toplam Parti</Text>
            <View style={[s.miniTag, { backgroundColor: C.blue }]}>
              <Text style={s.miniTagText}>+%3,2</Text>
            </View>
          </View>
          <Text style={s.statNum}>{aktifPartiSayisi}</Text>
        </View>
        <View style={[s.stat, { backgroundColor: C.mintLt }]}>
          <View style={s.statTopRow}>
            <Text style={s.statLabel}>Toplam Birim</Text>
            <View style={[s.miniTag, { backgroundColor: C.mint }]}>
              <Text style={s.miniTagText}>+%1,2</Text>
            </View>
          </View>
          <Text style={s.statNum}>{aktifToplamUretim.toLocaleString("tr-TR")}</Text>
        </View>
      </View>

      {/* Aktif Modeller */}
      <Card>
        <SH title="Aktif Modeller" action="Rapor İndir" onAction={raporIndir} />
        {raporYukleniyor && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, backgroundColor: C.blueLt, padding: 10, borderRadius: 12 }}>
            <ActivityIndicator size="small" color={C.blue} />
            <Text style={{ fontSize: 11, color: C.blue }}>Rapor hazırlanıyor...</Text>
          </View>
        )}

        {aktifModeller.length > 0 ? (
          <View style={[s.typeGrid, { marginTop: 4 }]}>
            {aktifModeller.map((mod, index) => (
              <View key={String(mod)} style={{ flexDirection: "row", alignItems: "center", gap: 6, width: "48%", marginBottom: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: [C.peach, C.blue, C.mint, C.lav][index % 4] }} />
                <Text style={{ fontSize: 10, color: C.muted }}>Model: {mod}</Text>
                <Text style={{ fontSize: 10, fontWeight: "700", color: C.text, marginLeft: "auto" }}>Aktif</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontSize: 11, color: C.muted, paddingVertical: 12, textAlign: "center" }}>Şu an aktif bir üretim modeli bulunmuyor.</Text>
        )}
      </Card>

      {/* Kalite Dağılımı */}
      <Card>
        <SH title="Kalite Dağılımı" />
        <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 16 }}>
          {kaliteDagilim.map(q => (
            <View key={q.label} style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: q.color }}>{q.val}</Text>
              <Text style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{q.label}</Text>
            </View>
          ))}
        </View>
        {kaliteDagilim.map(q => (
          <View key={q.label} style={{ marginBottom: 12 }}>
            <Text style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{q.label}</Text>
            <View style={{ height: 8, borderRadius: 99, backgroundColor: "#D8E6F0", overflow: "hidden" }}>
              <View style={{ height: "100%", width: `${Math.max(q.pct, 0.4)}%`, backgroundColor: q.color, borderRadius: 99 }} />
            </View>
          </View>
        ))}
      </Card>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  dateText: { fontSize: 11, color: C.muted },
  pageTitle: { fontSize: 21, fontWeight: "800", color: C.text, lineHeight: 26 },
  pageSub: { fontSize: 13, color: C.muted },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.peach, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 },
  addBtnText: { color: "white", fontSize: 11, fontWeight: "700" },
  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  statTopRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  statLabel: { fontSize: 10, color: C.muted },
  statNum: { fontSize: 26, fontWeight: "800", color: C.text },
  miniTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99 },
  miniTagText: { fontSize: 8, fontWeight: "700", color: "white" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  manageTile: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  manageIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.peach, paddingVertical: 12, borderRadius: 16 },
  primaryBtnText: { color: "white", fontSize: 13, fontWeight: "700" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, marginRight: 8 },
  chipText: { fontSize: 10, fontWeight: "600" },
  partiCard: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  partiTop: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 },
  partiMeta: { fontSize: 9.5, color: C.muted },
  partiBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "white" },
  partiTitle: { fontSize: 12.5, fontWeight: "600", color: C.text },
  partiTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  partiTagText: { fontSize: 9, fontWeight: "600" },
  detayBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  detayBtnText: { color: "white", fontSize: 11, fontWeight: "700" },
  toast: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.mintLt, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.mint },
  toastText: { fontSize: 12, fontWeight: "600", color: C.mint },
  formLabel: { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 10 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: "white" },
  optionChipText: { fontSize: 12, fontWeight: "600", color: C.muted },
  infoBox: { borderRadius: 12, padding: 14 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  detailLabel: { fontSize: 12, color: C.muted },
  detailVal: { fontSize: 12, fontWeight: "700", color: C.text },
});

