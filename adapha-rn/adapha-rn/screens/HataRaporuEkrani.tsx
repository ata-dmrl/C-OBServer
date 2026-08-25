import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { ChevronLeft, FileDown, ClipboardList, CheckCircle } from "lucide-react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { C } from "../constants/colors";
import { formatTarih, hataRaporunuCek, HataBildirimi } from "../services/api";

// Kaçınılan XSS/biçim bozulması: kullanıcının serbest metin girdiği açıklama
// alanı doğrudan HTML'e gömülüyor (PDF üretimi için), bu yüzden temel HTML
// karakterleri kaçırılıyor.
function kacir(metin?: string | null): string {
  if (!metin) return "";
  return metin.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Açıklanmış (durum: aciklandi) hata bildirimlerinden — tarih/saat damgalı,
// sade ve kurumsal görünümlü — bir PDF rapor üretir (aynı expo-print +
// expo-sharing deseni UretimEkrani'ndaki üretim raporunda da kullanılıyor).
export default function HataRaporuEkrani() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [kayitlar, setKayitlar] = useState<HataBildirimi[]>([]);
  const [loading, setLoading] = useState(true);
  const [indiriliyor, setIndiriliyor] = useState(false);
  const [basarili, setBasarili] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      hataRaporunuCek().then((data) => {
        setKayitlar(data);
        setLoading(false);
      });
    }, [])
  );

  const makineSayisi = new Set(kayitlar.map((k) => k.bantId)).size;

  const pdfIndir = async () => {
    setIndiriliyor(true);
    setBasarili(false);
    try {
      const olusturmaZamani = new Date().toLocaleString("tr-TR");

      const satirlar = kayitlar.length > 0
        ? kayitlar.map((k) => `
          <tr>
            <td>${formatTarih(k.hataZamani)}</td>
            <td>${kacir(k.bantId)}${k.bant?.isim ? ` · ${kacir(k.bant.isim)}` : ""}</td>
            <td>${kacir(k.aciklama)}</td>
            <td>${k.aciklamaZamani ? formatTarih(k.aciklamaZamani) : "-"}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="4" style="text-align:center;">Açıklanmış hata kaydı bulunamadı.</td></tr>`;

      const htmlContent = `
        <html>
          <head>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; padding: 40px; color: #0C1E33; line-height: 1.5; font-size: 13px; }
              .baslikBar { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #1A3A5C; padding-bottom: 14px; margin-bottom: 22px; }
              .firma { font-size: 11px; color: #5E7389; letter-spacing: 1.5px; text-transform: uppercase; }
              h1 { font-size: 1.7em; margin: 4px 0 0 0; color: #1A3A5C; }
              .meta { text-align:right; font-size: 11px; color: #5E7389; }
              .metaVal { color:#1A3A5C; font-size: 13px; font-weight: 700; }
              .ozet { display:flex; gap: 14px; margin-bottom: 26px; }
              .ozetKutu { flex:1; border: 1px solid rgba(26,58,92,0.14); border-radius: 10px; padding: 12px 14px; background: #F3F6FA; }
              .ozetLabel { font-size: 9.5px; color: #5E7389; text-transform:uppercase; letter-spacing: 0.5px; margin-bottom:4px; }
              .ozetVal { font-size: 20px; font-weight: 800; color: #1A3A5C; }
              h2 { font-size: 1.05em; color: #1A3A5C; margin: 0 0 10px 0; border-bottom: 1px solid #E1E7EF; padding-bottom: 8px; }
              table { border-collapse: collapse; width: 100%; margin-bottom: 26px; }
              th, td { padding: 8px 12px; border: 1px solid #E1E7EF; text-align: left; vertical-align: top; }
              th { background-color: #1A3A5C; color: white; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; }
              tr:nth-child(2n) td { background-color: #F6F8FA; }
              .onayTablo th { background: #EBF2FA; color:#1A3A5C; }
              .imzaSatiri td { height: 42px; }
              .altbilgi { margin-top: 8px; padding-top: 12px; border-top: 1px solid #E1E7EF; font-size: 9.5px; color: #9CA9B8; display:flex; justify-content:space-between; gap: 20px; }
            </style>
          </head>
          <body>
            <div class="baslikBar">
              <div>
                <div class="firma">Kardağ Ltd. Şti. · C-OBServer</div>
                <h1>Üretim Hata Raporu</h1>
              </div>
              <div class="meta">
                Oluşturulma Tarihi ve Saati<br/>
                <span class="metaVal">${olusturmaZamani}</span>
              </div>
            </div>

            <div class="ozet">
              <div class="ozetKutu">
                <div class="ozetLabel">Toplam Açıklanmış Hata</div>
                <div class="ozetVal">${kayitlar.length}</div>
              </div>
              <div class="ozetKutu">
                <div class="ozetLabel">Etkilenen Makine Sayısı</div>
                <div class="ozetVal">${makineSayisi}</div>
              </div>
            </div>

            <h2>Hata Kayıtları</h2>
            <table>
              <thead>
                <tr><th>Hata Anı (Tarih / Saat)</th><th>Makine</th><th>Açıklama</th><th>Girildiği Zaman</th></tr>
              </thead>
              <tbody>
                ${satirlar}
              </tbody>
            </table>

            <h2>Onay</h2>
            <table class="onayTablo">
              <thead>
                <tr><th>Kalite Kontrol</th><th>Vardiya Amiri</th><th>İşletme Sorumlusu</th></tr>
              </thead>
              <tbody>
                <tr class="imzaSatiri"><td></td><td></td><td></td></tr>
                <tr><td>Ad Soyad / İmza / Tarih</td><td>Ad Soyad / İmza / Tarih</td><td>Ad Soyad / İmza / Tarih</td></tr>
              </tbody>
            </table>

            <div class="altbilgi">
              <span>C-OBServer — Otomatik üretim hattı izleme sistemi</span>
              <span>Kayıt kaynağı: hat hızının 0'a düştüğü an sistem tarafından otomatik tespit edilir, neden bilgisi kullanıcı tarafından girilir.</span>
            </div>
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Hata Raporunu İndir" });
      setBasarili(true);
      setTimeout(() => setBasarili(false), 3000);
    } catch (error: any) {
      console.error("PDF Hatası:", error);
      Alert.alert("Rapor oluşturulamadı", error?.message || "Bilinmeyen bir hata oluştu.");
    } finally {
      setIndiriliyor(false);
    }
  };

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Hata Raporu</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={C.peach} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.statRow}>
            <View style={[s.stat, { backgroundColor: C.blueLt }]}>
              <Text style={s.statLabel}>Toplam Kayıt</Text>
              <Text style={s.statNum}>{kayitlar.length}</Text>
            </View>
            <View style={[s.stat, { backgroundColor: C.peachLt }]}>
              <Text style={s.statLabel}>Etkilenen Makine</Text>
              <Text style={s.statNum}>{makineSayisi}</Text>
            </View>
          </View>

          {/* PDF indirme alanı */}
          <View style={s.pdfCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <View style={[s.iconBox, { backgroundColor: C.peachLt }]}>
                <ClipboardList size={16} color={C.peach} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.pdfTitle}>Rapor Çıktısı</Text>
                <Text style={s.pdfSub}>Tarih/saat damgalı, kurumsal PDF olarak indirilebilir.</Text>
              </View>
            </View>
            {basarili && (
              <View style={s.toast}>
                <CheckCircle size={14} color={C.mint} />
                <Text style={s.toastText}>Rapor başarıyla indirildi!</Text>
              </View>
            )}
            <TouchableOpacity style={s.pdfBtn} onPress={pdfIndir} disabled={indiriliyor}>
              {indiriliyor ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <FileDown size={16} color="white" />
                  <Text style={s.pdfBtnText}>PDF Olarak İndir</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={s.listTitle}>Kayıtlar</Text>
          {kayitlar.length === 0 ? (
            <Text style={{ textAlign: "center", color: C.muted, marginTop: 24 }}>Henüz açıklanmış hata kaydı yok.</Text>
          ) : (
            kayitlar.map((k) => (
              <View key={k.id} style={s.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={s.machineName}>{k.bantId}{k.bant?.isim ? ` · ${k.bant.isim}` : ""}</Text>
                  <Text style={s.time}>{formatTarih(k.hataZamani)}</Text>
                </View>
                <Text style={s.desc}>{k.aciklama}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 16, backgroundColor: "white",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  content: { padding: 16, gap: 12, paddingBottom: 32 },

  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  statLabel: { fontSize: 10, color: C.muted, marginBottom: 6 },
  statNum: { fontSize: 24, fontWeight: "800", color: C.text },

  pdfCard: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  iconBox: { width: 32, height: 32, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  pdfTitle: { fontSize: 13, fontWeight: "700", color: C.text },
  pdfSub: { fontSize: 10.5, color: C.muted, marginTop: 2 },
  pdfBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.peach, paddingVertical: 13, borderRadius: 14,
  },
  pdfBtnText: { color: "white", fontSize: 13, fontWeight: "700" },
  toast: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.mintLt,
    borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.mint, marginBottom: 12,
  },
  toastText: { fontSize: 11.5, fontWeight: "600", color: C.mint },

  listTitle: { fontSize: 13, fontWeight: "700", color: C.text, marginTop: 4, paddingHorizontal: 2 },
  card: { backgroundColor: "white", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  machineName: { fontSize: 12.5, fontWeight: "700", color: C.text },
  time: { fontSize: 10.5, color: C.muted },
  desc: { fontSize: 12, color: C.text, lineHeight: 17 },
});
