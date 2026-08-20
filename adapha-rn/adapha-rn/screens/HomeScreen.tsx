import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Dimensions, ActivityIndicator, Animated, Image, DeviceEventEmitter
} from "react-native";
import { WebView } from "react-native-webview";
import { LineChart } from "react-native-gifted-charts";
import {
  Zap, Package, Clock, ChevronRight, Shield, Search, Plus,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { C } from "../constants/colors";
import { Card, SH } from "../components/Card";
import { BantDurumuPaneli } from "../components/BantDurumuPaneli";
import ModalBottomSheet from "../components/ModalBottomSheet";
import { hizProfili, aylikUretim, programVerisi, dashboardOzetiniCek, bantVerisiniCek, socket, Bant } from "../services/api";
import { ChevronLeft } from "lucide-react-native";

const W = Dimensions.get("window").width;

// 1 saniyeden kısa duruşlar toFixed(0) ile "0 sn" olup kayboluyordu —
// kısa duruşları da görünür kılmak için 1sn altında ms'ye düşüyoruz.
function formatDurusSuresi(sn?: number): { value: string; unit: string } {
  if (!sn || sn <= 0) return { value: "0", unit: "sn" };
  if (sn < 1) return { value: Math.round(sn * 1000).toString(), unit: "ms" };
  return { value: sn.toFixed(0), unit: "sn" };
}

// SVG Gösterge – react-native-svg ile
import Svg, { Path, Line, Text as SvgText, Polygon, Circle } from "react-native-svg";
function SvgGauge({ value = 0 }: { value?: number }) {
  const max = 300, cx = 120, cy = 118, r = 92;
  const ang = (v: number) => Math.PI * (1 - Math.min(v, max) / max);
  const pt = (a: number, rad: number) => ({
    x: cx + rad * Math.cos(a),
    y: cy - rad * Math.sin(a),
  });
  const arcL = pt(Math.PI, r), arcR = pt(0, r);
  const arcPath = `M ${arcL.x.toFixed(1)} ${arcL.y.toFixed(1)} A ${r} ${r} 0 0 1 ${arcR.x.toFixed(1)} ${arcR.y.toFixed(1)}`;
  const na = ang(value), tip = pt(na, r - 12), b1 = pt(na + Math.PI / 2, 5), b2 = pt(na - Math.PI / 2, 5);
  const ticks = [0, 50, 100, 150, 200, 250, 300];
  return (
    <Svg viewBox="0 0 240 132" width="100%" height={132}>
      <Path d={arcPath} fill="none" stroke="#C8D8E8" strokeWidth="14" strokeLinecap="round" />
      {ticks.map(t => {
        const a = ang(t), o = pt(a, r + 4), ii = pt(a, r - 16), lp = pt(a, r - 30);
        return (
          <React.Fragment key={t}>
            <Line x1={ii.x} y1={ii.y} x2={o.x} y2={o.y} stroke="#8AAAC8" strokeWidth="1.5" />
            <SvgText x={lp.x} y={lp.y} textAnchor="middle" alignmentBaseline="middle" fontSize="8" fill="#5E7389">{t}</SvgText>
          </React.Fragment>
        );
      })}
      <Polygon points={`${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${b1.x.toFixed(1)},${b1.y.toFixed(1)} ${b2.x.toFixed(1)},${b2.y.toFixed(1)}`} fill={C.peach} />
      <Circle cx={cx} cy={cy} r="9" fill={C.peach} />
      <Circle cx={cx} cy={cy} r="4" fill={C.bg} />
      <SvgText x={cx} y={cy - 30} textAnchor="middle" fontSize="38" fontWeight="800" fill={C.peach}>{value.toFixed(1)}</SvgText>
      <SvgText x={cx} y={cy - 11} textAnchor="middle" fontSize="9.5" fill={C.muted}>birim / dak</SvgText>
    </Svg>
  );
}

// Bu bant için henüz bir Pi IP'si tanımlanmadıysa gösterilir — eskiden
// burada sahte bir "bant hareket ediyor" animasyonu ve makine durumu
// yazan bir simülasyon ekranı vardı, kafa karıştırıyordu ("kamera kaydı
// bekleniyor" gibi). Artık sadece durumu olduğu gibi söylüyor.
function PiTanimsizEkrani() {
  return (
    <View style={s.simContainer}>
      <Text style={s.noPiText}>Bu banda henüz bir makine kimliği atanmadı.</Text>
      <Text style={s.noPiSubText}>Admin panelinden ekleyebilirsiniz.</Text>
    </View>
  );
}

function KameraKarti({ bant }: { bant: Bant }) {
  // Kamera/"Anlık Kontrol" kartı üretim durumuna değil, Pi'nin merkeze
  // bağlılığına göre CANLI/ÇEVRİMDIŞI göstermeli — bant üretim yapmasa
  // (pasif) bile Pi bağlıysa fotoğraf çekilebilir, bu yüzden ayrı tutuyoruz.
  const piBagli = bant.baglantiDurumu === "ONLINE";
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // Sadece istendiğinde fotoğrafı tutacak state
  const [aktifFoto, setAktifFoto] = React.useState<string | null>(null);
  const sonIstekTs = React.useRef(0);

  // Yenile'ye art arda basmak Pi'de her seferinde yeni bir JPEG kodlama
  // tetikliyordu (kimlik doğrulama/hız sınırlaması olmayan bir uç) — 3
  // saniyelik bir bekleme ile bunu sınırlıyoruz.
  const BEKLEME_SN = 3;
  const [geriSayim, setGeriSayim] = React.useState(0);
  const geriSayimRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => {
      if (geriSayimRef.current) clearInterval(geriSayimRef.current);
    };
  }, []);

  // Butona her basışta tek kare çeker. Yeni kareyi ekrana koymadan önce arka
  // planda indirir — böylece eski kare yenisi hazır olana kadar ekranda kalır,
  // aradaki boşluk/titreme olmaz.
  const fotografIste = React.useCallback(() => {
    if (!bant.kameraUrl || geriSayim > 0) return;
    const ts = Date.now();
    sonIstekTs.current = ts;
    const url = `${bant.kameraUrl}?t=${ts}`;
    Image.prefetch(url)
      .then(() => {
        if (sonIstekTs.current === ts) setAktifFoto(url);
      })
      .catch(() => {}); // ağ hatasında mevcut kareyi ekranda tut

    setGeriSayim(BEKLEME_SN);
    geriSayimRef.current = setInterval(() => {
      setGeriSayim(onceki => {
        if (onceki <= 1) {
          if (geriSayimRef.current) clearInterval(geriSayimRef.current);
          return 0;
        }
        return onceki - 1;
      });
    }, 1000);
  }, [bant.kameraUrl, geriSayim]);

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={s.cardTitle}>Anlık Kontrol</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {aktifFoto && (
            <TouchableOpacity
              onPress={fotografIste}
              disabled={geriSayim > 0}
              style={{ backgroundColor: geriSayim > 0 ? C.muted : C.peach, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}
            >
              <Text style={{ fontSize: 10, fontWeight: "700", color: "white" }}>
                {geriSayim > 0 ? `${geriSayim}sn` : "Yenile"}
              </Text>
            </TouchableOpacity>
          )}
          <View style={{ backgroundColor: piBagli ? "rgba(76, 217, 100, 0.1)" : "rgba(255, 59, 48, 0.1)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 }}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: piBagli ? C.green : C.red }}>{bant.id}-CAM</Text>
          </View>
        </View>
      </View>
      
      <View style={s.cameraArea}>
        {aktifFoto ? (
          <Image
            source={{ uri: aktifFoto }}
            style={s.webview}
            resizeMode="cover"
            fadeDuration={0}
          />
        ) : (
          <View style={[s.simContainer, { paddingHorizontal: 24 }]}>
            {bant.kameraUrl ? (
              <>
                <TouchableOpacity
                  onPress={fotografIste}
                  disabled={geriSayim > 0}
                  style={{ backgroundColor: geriSayim > 0 ? C.muted : C.peach, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16 }}
                >
                  <Text style={{ color: "white", fontSize: 13, fontWeight: "700" }}>
                    {geriSayim > 0 ? `${geriSayim} sn sonra tekrar dene` : "Anlık Görüntü Al"}
                  </Text>
                </TouchableOpacity>
                <Text style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, textAlign: "center", marginTop: 12 }}>
                  Sürekli akış yerine, sadece ihtiyaç duyduğunuzda kameradan o anki taze fotoğrafı çekebilirsiniz.
                </Text>
              </>
            ) : (
              <PiTanimsizEkrani />
            )}
          </View>
        )}

        <View style={s.liveBadge}>
          <Animated.View style={[s.liveDot, { backgroundColor: piBagli ? C.green : C.red, opacity: pulseAnim }]} />
          <Text style={s.liveText}>{piBagli ? "CANLI" : "ÇEVRİMDIŞI"}</Text>
        </View>
      </View>
    </Card>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const [ozet, setOzet] = useState({ aktifHatSayisi: 0, toplamCikti: 0, anlikHizOrta: 0 });
  const [bantlar, setBantlar] = useState<Bant[]>([]);
  const [loading, setLoading] = useState(true);
  const [aktifProgramFiltre, setAktifProgramFiltre] = useState("Tümü");
  const [seciliBant, setSeciliBant] = useState<Bant | null>(null);

  useEffect(() => {
    // 1. İlk yüklemede API'den gerçek veriyi çek
    const verileriCek = async () => {
      setLoading(true);
      const [ozetVeri, bantVeri] = await Promise.all([
        dashboardOzetiniCek(),
        bantVerisiniCek()
      ]);
      setOzet(ozetVeri);
      setBantlar(bantVeri);
      setLoading(false);
    };

    verileriCek();
    const refreshListener = DeviceEventEmitter.addListener("onGlobalRefresh", () => {
      if (navigation.isFocused()) {
        verileriCek();
      }
    });

    // 2. WebSocket üzerinden anlık hız güncellemelerini (Simülatör) dinle
    socket.on("bant_hiz_guncelleme", (guncellemeler: { id: string, anlikHiz: number }[]) => {
      setBantlar(prev => {
        let hizToplami = 0;
        let acikSayisi = 0;
        const yeniBantlar = prev.map(bant => {
          const guncel = guncellemeler.find(g => g.id === bant.id);
          const yeniHiz = guncel ? guncel.anlikHiz : bant.anlikHiz;
          if (bant.durum === "acik") {
            hizToplami += (yeniHiz || 0);
            acikSayisi++;
          }
          return { ...bant, anlikHiz: yeniHiz };
        });

        // Ortalama hızı da canlı güncelle
        if (acikSayisi > 0) {
          setOzet(eski => ({ ...eski, anlikHizOrta: hizToplami / acikSayisi }));
        }

        return yeniBantlar;
      });
    });

    // 3. Gerçek Raspberry Pi'den gelen full güncellemeleri dinle
    socket.on("bant_guncellendi", (guncelBant: Bant) => {
      setBantlar(prev => {
        const kopya = [...prev];
        const idx = kopya.findIndex(b => b.id === guncelBant.id);
        if (idx !== -1) {
          kopya[idx] = { ...kopya[idx], ...guncelBant };
        } else {
          kopya.push(guncelBant);
        }
        return kopya;
      });
    });

    return () => {
      socket.off("bant_hiz_guncelleme");
      socket.off("bant_guncellendi");
      refreshListener.remove();
    };
  }, []);

  if (loading) {
    return <View style={[s.scroll, { justifyContent: "center", alignItems: "center" }]}><ActivityIndicator color={C.peach} /></View>;
  }

  const guncelSeciliBant = seciliBant ? bantlar.find(b => b.id === seciliBant.id) || seciliBant : null;

  // EĞER BİR BANT SEÇİLİ DEĞİLSE SADECE LİSTEYİ GÖSTER
  if (!guncelSeciliBant) {
    return (
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={{ zIndex: 1 }}>
            <Text style={s.heroDate}>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            <Text style={s.heroTitle}>Tesis Genel Bakış</Text>
            <Text style={s.heroSub}>Kardağ Ltd. Şti.</Text>
          </View>
          <View style={s.heroBubble1} />
          <View style={s.heroBubble2} />
        </View>

        <Text style={[s.cardTitle, { marginTop: 8, marginBottom: 4, paddingHorizontal: 4 }]}>Üretim Bantları</Text>
        
        <View style={{ gap: 12 }}>
          {bantlar.map(m => (
            <TouchableOpacity key={m.id} style={s.machineCardWide} onPress={() => setSeciliBant(m)}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={s.machineTitleWide}>{m.isim}</Text>
                <ChevronRight size={18} color={C.peach} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <View style={[s.dot, { backgroundColor: m.durum === "acik" ? C.mint : C.muted }]} />
                <Text style={[s.machineLive, { color: m.durum === "acik" ? C.mint : C.muted }]}>
                  {m.durum === "acik" ? "Çalışıyor" : "Pasif"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 4, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border }}>
                <View>
                  <Text style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Anlık Hız</Text>
                  <Text style={s.machineRateWide}>{m.anlikHiz?.toFixed(1) || 0} b/s</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Üretim</Text>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }}>{(m.toplamUretim || 0).toLocaleString("tr-TR")}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  }

  // BİR BANT SEÇİLİ İSE SADECE ONUN DETAYLARINI GÖSTER
  // Grafik verisi (Zamanla API'ye bağlanacak)
  const lineData2 = (aylikUretim || []).map(d => ({ value: d.cikti }));
  const lineData3 = (aylikUretim || []).map(d => ({ value: d.iyi }));

  // CANLI VERİLERDEN HESAPLANAN ÖZETLER
  const aktifToplamUretim = guncelSeciliBant.toplamUretim || 0;
  const aktifIyiUretim = guncelSeciliBant.iyiUretim || 0;
  const ortalamaSertifika = guncelSeciliBant.sertifikaOrani || 0;

  // "Hatalı birim" için ÖNCE oturuma özel sayıları (oeeUretim/oeeUretimIyi)
  // kullanıyoruz — bunlar merkez'in bu izleme oturumunda ürettiği gerçek
  // sayı, video döngüsünün devasa "ömür boyu" ham sayacı (toplamUretim)
  // değil. O ham sayaçla oran çarpınca (örn. %4 x 44.000) gerçekte
  // olmayan büyüklükte "1828 birim hatalı" gibi sayılar çıkıyordu.
  // Oturum verisi henüz yoksa (yeni açılış) sertifika oranından türetilmiş
  // tahmine düşüyoruz.
  const oturumUretim = guncelSeciliBant.oeeUretim ?? 0;
  const oturumIyi = guncelSeciliBant.oeeUretimIyi ?? 0;
  let hataliUretim: number;
  let hataOrani: number;
  if (oturumUretim > 0) {
    hataliUretim = Math.max(0, oturumUretim - oturumIyi);
    hataOrani = Math.min(100, Math.max(0, (hataliUretim / oturumUretim) * 100));
  } else {
    hataOrani = Math.min(100, Math.max(0, 100 - ortalamaSertifika));
    hataliUretim = Math.round(aktifToplamUretim * (hataOrani / 100));
  }

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

      <TouchableOpacity style={s.backBtn} onPress={() => setSeciliBant(null)}>
        <ChevronLeft size={20} color={C.peach} />
        <Text style={s.backBtnText}>Tüm Bantlara Dön</Text>
      </TouchableOpacity>

      {/* Hero */}
      <View style={s.hero}>
        <View style={{ zIndex: 1 }}>
          <Text style={s.heroDate}>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          <Text style={s.heroTitle}>{guncelSeciliBant.isim} Detayları</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Text style={[s.heroSub, { marginTop: 0 }]}>Anlık İzleme Paneli</Text>
            {guncelSeciliBant.mevcutModel ? (
              <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, color: "white", fontWeight: "800" }}>Model: {guncelSeciliBant.mevcutModel}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: "600" }}>Model: Bekleniyor...</Text>
              </View>
            )}
          </View>
        </View>
        <View style={s.heroBubble1} />
        <View style={s.heroBubble2} />
      </View>

      {/* Stat kutucukları */}
      <View style={s.statRow}>
        <View style={[s.stat, { backgroundColor: guncelSeciliBant.durum === "acik" ? C.mintLt : C.peachLt }]}>
          <View style={s.statDotRow}>
            <View style={[s.dot, { backgroundColor: guncelSeciliBant.durum === "acik" ? C.mint : C.peach }]} />
            <Text style={s.statLabel}>Durum</Text>
          </View>
          <Text style={[s.statNum, { color: C.text, fontSize: 18, marginTop: 4 }]}>{guncelSeciliBant.durum === "acik" ? "Çalışıyor" : "Pasif"}</Text>
        </View>
        <View style={[s.stat, { backgroundColor: C.blueLt }]}>
          <View style={s.statDotRow}>
            <Package size={11} color={C.blue} />
            <Text style={s.statLabel}>Toplam Çıktı</Text>
          </View>
          <Text style={[s.statNum, { color: C.text, fontSize: 18, marginTop: 4 }]}>{aktifToplamUretim.toLocaleString("tr-TR")}</Text>
        </View>
      </View>

      {/* Canlı Kamera Akışı */}
      <KameraKarti bant={guncelSeciliBant} />

      <Card>
        <View style={s.gaugeBox}>
          <Text style={s.gaugeLabel}>Anlık Hız</Text>
          <SvgGauge value={guncelSeciliBant.anlikHiz || 0} />
        </View>
      </Card>

      {/* Makine Performansı (Sayısal Görünüm) */}
      <Card>
        <SH title="Makine Performansı" />
        
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
          <View style={{ width: "47%", backgroundColor: C.mintLt, padding: 12, borderRadius: 12 }}>
            <Text style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>OEE Puanı</Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.mint }}>{guncelSeciliBant.oee ? guncelSeciliBant.oee.toFixed(1) : "0"}</Text>
          </View>
          
          <View style={{ width: "47%", backgroundColor: C.blueLt, padding: 12, borderRadius: 12 }}>
            <Text style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Kullanılabilirlik</Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.blue }}>{guncelSeciliBant.availability ? guncelSeciliBant.availability.toFixed(1) : "0"}</Text>
          </View>

          <View style={{ width: "47%", backgroundColor: C.peachLt, padding: 12, borderRadius: 12 }}>
            <Text style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Duruş Süresi</Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.peach }}>{formatDurusSuresi(guncelSeciliBant.duruşSuresiSn).value} <Text style={{ fontSize: 12, fontWeight: "600" }}>{formatDurusSuresi(guncelSeciliBant.duruşSuresiSn).unit}</Text></Text>
          </View>
          
          <View style={{ width: "47%", backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 12 }}>
            <Text style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Çalışma Süresi</Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: C.text }}>{guncelSeciliBant.calismaSuresi ? guncelSeciliBant.calismaSuresi.toFixed(1) : "0"} <Text style={{ fontSize: 12, fontWeight: "600" }}>sa</Text></Text>
          </View>
        </View>
      </Card>

      {/* Kalite Kontrol */}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <View style={[s.iconBox, { backgroundColor: C.mintLt }]}>
                <Shield size={13} color={C.mint} />
              </View>
              <Text style={[s.perfVal, { color: C.text }]}>Kalite Kontrol Aktif</Text>
            </View>
            <Text style={s.perfLabel}>İnceleme Bekleyen (Hatalı) Birimler</Text>
            <Text style={[s.statNum, { color: C.peach, marginTop: 4 }]}>{hataliUretim} birim</Text>
          </View>
          <View style={[s.badge, { backgroundColor: C.peachLt }]}>
            <Text style={[s.badgeText, { color: C.peach }]}>%{hataOrani.toFixed(2)}</Text>
          </View>
        </View>
      </Card>

      {/* Üretim Özeti */}
      <Card>
        <SH title="Üretim Özeti" action="Detaylar" />
        {[
          { dot: C.mint, label: "İyi Ürünler", val: `%${ortalamaSertifika.toFixed(2)}  ·  ${aktifIyiUretim.toLocaleString("tr-TR")}` },
          { dot: C.peachMd, label: "Hatalı / Fire", val: `%${hataOrani.toFixed(2)}   ·  ${hataliUretim.toLocaleString("tr-TR")}` },
        ].map(r => (
          <View key={r.label} style={s.summaryRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[s.dot, { backgroundColor: r.dot }]} />
              <Text style={s.perfLabel}>{r.label}</Text>
            </View>
            <Text style={s.perfVal}>{r.val}</Text>
          </View>
        ))}
        <View style={s.divider} />
        {[
          { label: "Sertifikalı Üretim", pct: `%${ortalamaSertifika.toFixed(2)}`, adet: `${aktifIyiUretim.toLocaleString("tr-TR")} birim`, color: C.mint },
          { label: "Standart Altı", pct: `%${hataOrani.toFixed(2)}`, adet: `${hataliUretim.toLocaleString("tr-TR")} birim`, color: C.peach },
        ].map(row => (
          <View key={row.label} style={s.summaryRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[s.smallDot, { backgroundColor: row.color }]} />
              <Text style={s.perfLabel}>{row.label}</Text>
            </View>
            <View style={{ flexDirection: "row" }}>
              <Text style={s.perfVal}>{row.pct}</Text>
              <Text style={[s.perfLabel, { marginLeft: 8 }]}>{row.adet}</Text>
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

  hero: {
    backgroundColor: C.peach, borderRadius: 24, padding: 20, overflow: "hidden", gap: 0,
    shadowColor: C.peach, shadowOpacity: 0.4, shadowRadius: 16, elevation: 6
  },
  heroBubble1: { position: "absolute", right: -32, top: -32, width: 112, height: 112, borderRadius: 56, backgroundColor: "rgba(255,255,255,0.13)" },
  heroBubble2: { position: "absolute", right: 20, bottom: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.09)" },
  heroDate: { color: "rgba(255,255,255,0.7)", fontSize: 10, marginBottom: 2 },
  heroTitle: { color: "white", fontSize: 21, fontWeight: "800", lineHeight: 26 },
  heroSub: { color: "rgba(255,255,255,0.65)", fontSize: 10, marginBottom: 12 },
  heroBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.20)", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, alignSelf: "flex-start" },
  heroBtnText: { color: "white", fontSize: 11, fontWeight: "600" },

  statRow: { flexDirection: "row", gap: 12 },
  stat: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  statDotRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  statLabel: { fontSize: 10, color: C.muted },
  statNum: { fontSize: 26, fontWeight: "800", marginBottom: 4 },
  statSub: { fontSize: 10, fontWeight: "500" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  smallDot: { width: 6, height: 6, borderRadius: 3 },

  machineCard: { width: 156, borderRadius: 16, padding: 12, backgroundColor: C.peachLt, borderWidth: 1, borderColor: C.peachMd, marginHorizontal: 4 },
  machineTitle: { fontSize: 10, fontWeight: "600", color: C.text, flex: 1 },
  machineLive: { fontSize: 9, fontWeight: "600" },
  machineTime: { fontSize: 9, color: C.muted },
  machineRate: { fontSize: 12, fontWeight: "700", color: C.peach },

  gaugeBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  gaugeLabel: { fontSize: 10, fontWeight: "600", color: C.muted, textAlign: "center", marginBottom: 4 },

  perfRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  perfLabel: { fontSize: 11, color: C.muted },
  perfVal: { fontSize: 11, fontWeight: "600", color: C.text },

  iconBox: { width: 28, height: 28, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 10, fontWeight: "600" },

  cardTitle: { fontSize: 13, fontWeight: "600", color: C.text },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 12 },

  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  searchText: { fontSize: 11, color: C.muted },
  chip: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, marginRight: 8 },
  chipText: { fontSize: 10, fontWeight: "600" },
  tableHeader: { flexDirection: "row", paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1 },
  tableHeaderText: { flex: 1, fontSize: 8.5, fontWeight: "700", textTransform: "uppercase", color: C.muted },
  tableRow: { flexDirection: "row", paddingVertical: 8, alignItems: "center" },
  tableCell: { flex: 1, fontSize: 10, color: C.text },
  machineCardWide: { borderRadius: 16, padding: 16, backgroundColor: "white", borderWidth: 1, borderColor: C.border, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 8, elevation: 2 },
  machineTitleWide: { fontSize: 14, fontWeight: "700", color: C.text },
  machineTimeWide: { fontSize: 11, color: C.muted },
  machineRateWide: { fontSize: 18, fontWeight: "800", color: C.peach },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 14, fontWeight: "600", color: C.peach },

  // Kamera Stilleri
  cameraArea: { aspectRatio: 16/9, backgroundColor: "#050D18", borderRadius: 12, overflow: "hidden", position: "relative" },
  webview: { flex: 1 },
  liveBadge: { position: "absolute", top: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 99 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 9, fontWeight: "700", color: "white" },
  simContainer: { flex: 1, backgroundColor: "#070F1C", justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  noPiText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600", textAlign: "center" },
  noPiSubText: { color: "rgba(255,255,255,0.4)", fontSize: 11, textAlign: "center", marginTop: 6 },
});
