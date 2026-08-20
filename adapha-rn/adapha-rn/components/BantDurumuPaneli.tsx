import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Animated, Easing,
} from "react-native";
import { Activity } from "lucide-react-native";
import { C } from "../constants/colors";
import { bantVerisiniCek, socket, Bant, normalizeDurum } from "../services/api";
import { Card } from "./Card";
import { KameraModal } from "./KameraModal";

const YENILEME_SURESI = 10_000;

export function BantDurumuPaneli() {
  const [bantlar, setBantlar]        = useState<Bant[]>([]);
  const [yukleniyor, setYukleniyor]  = useState(true);
  const [hata, setHata]              = useState<string | null>(null);
  const [sonYenileme, setSonYenileme]= useState("");
  const [sayac, setSayac]            = useState(YENILEME_SURESI / 1000);
  const [secilenBant, setSecilenBant]= useState<Bant | null>(null);

  // Spinner animasyonu
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (yukleniyor) {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true })
      ).start();
    } else {
      spinAnim.stopAnimation();
    }
  }, [yukleniyor]);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  const veriyiCek = useCallback(async () => {
    try {
      setHata(null);
      const veri = await bantVerisiniCek();
      setBantlar(veri);
      setSonYenileme(new Date().toLocaleTimeString("tr-TR"));
      setSayac(YENILEME_SURESI / 1000);
    } catch {
      setHata("Veriye ulaşılamadı. Yeniden deneniyor...");
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => { veriyiCek(); }, [veriyiCek]);

  useEffect(() => {
    const interval = setInterval(veriyiCek, YENILEME_SURESI);
    return () => clearInterval(interval);
  }, [veriyiCek]);

  useEffect(() => {
    const tick = setInterval(() =>
      setSayac(s => s > 0 ? s - 1 : YENILEME_SURESI / 1000), 1000);
    return () => clearInterval(tick);
  }, []);

  const acikSayisi   = bantlar.filter(b => normalizeDurum(b.durum) === "acik").length;
  const kapaliSayisi = bantlar.length - acikSayisi;
  const pct          = bantlar.length ? (acikSayisi / bantlar.length) * 100 : 0;

  return (
    <Card>
      {/* Başlık */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconBox}>
            <Activity size={13} color={C.blue} />
          </View>
          <Text style={styles.title}>Bant Durumu</Text>
        </View>
        {!yukleniyor && (
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: C.greenLt }]}>
              <Text style={[styles.badgeText, { color: C.green }]}>● {acikSayisi} Açık</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: C.redLt }]}>
              <Text style={[styles.badgeText, { color: C.red }]}>● {kapaliSayisi} Kapalı</Text>
            </View>
          </View>
        )}
      </View>

      {/* Yükleniyor */}
      {yukleniyor && (
        <View style={styles.loadingBox}>
          <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]} />
          <Text style={styles.loadingText}>Sistem verisi alınıyor...</Text>
        </View>
      )}

      {/* Hata */}
      {!yukleniyor && hata && (
        <View style={styles.errorBox}>
          <View style={styles.errorDot} />
          <Text style={styles.errorText}>{hata}</Text>
        </View>
      )}

      {/* İçerik */}
      {!yukleniyor && bantlar.length > 0 && (
        <>
          {/* Özet bar */}
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{acikSayisi} / {bantlar.length} bant aktif</Text>
            <Text style={styles.progressText}>{Math.round(pct)}%</Text>
          </View>

          {/* Bant listesi */}
          <View style={styles.list}>
            {bantlar.map(bant => (
              <BantSatiri key={bant.id} bant={bant} onPress={() => setSecilenBant(bant)} />
            ))}
          </View>

          {/* Alt: son güncelleme + sayaç */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Son güncelleme: <Text style={styles.footerBold}>{sonYenileme}</Text>
            </Text>
            <View style={styles.countdownRow}>
              <View style={[styles.pulseDot, { backgroundColor: C.mint }]} />
              <Text style={styles.footerText}>{sayac}s içinde yenileniyor</Text>
            </View>
          </View>
        </>
      )}

      {/* Modal */}
      {secilenBant && (
        <KameraModal bant={secilenBant} onKapat={() => setSecilenBant(null)} />
      )}
    </Card>
  );
}

// ── Tek bant satırı ──────────────────────────────────────────────────────────
function BantSatiri({ bant, onPress }: { bant: Bant; onPress: () => void }) {
  const isStale = bant.sonGuncelleme ? (new Date().getTime() - new Date(bant.sonGuncelleme).getTime()) > 60000 : false;
  const baglantiYok = bant.baglantiDurumu && bant.baglantiDurumu !== "ONLINE";
  
  const gercekDurum = isStale ? "SINYAL_YOK" : normalizeDurum(bant.durum);
  const acik = gercekDurum === "acik";
  const durdu = gercekDurum === "kapali";
  
  const pingAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (acik && !baglantiYok) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pingAnim, { toValue: 2, duration: 1000, useNativeDriver: true }),
          Animated.timing(pingAnim, { toValue: 1, duration: 0,    useNativeDriver: true }),
        ])
      ).start();
    }
  }, [acik, baglantiYok, pingAnim]);

  const pingOpacity = pingAnim.interpolate({ inputRange: [1, 1.5, 2], outputRange: [0.25, 0.1, 0] });

  let bgColor = C.bg;
  let borderColor = C.border;
  let dotColor = C.muted;
  let textColor = C.muted;
  let statusLabel = "Sinyal Yok";

  if (baglantiYok || isStale) {
    bgColor = "#F3F4F6"; borderColor = "#D1D5DB"; dotColor = "#9CA3AF"; textColor = "#9CA3AF"; statusLabel = bant.baglantiDurumu === "SINYAL_YOK" ? "SİNYAL YOK" : "BAĞLANTI YOK";
  } else if (acik) {
    bgColor = C.greenLt; borderColor = "#BBF7D0"; dotColor = C.green; textColor = C.green; statusLabel = "ÇALIŞIYOR";
  } else if (durdu) {
    bgColor = C.redMd; borderColor = C.redBrd; dotColor = C.red; textColor = C.red; statusLabel = "DURDU";
  }

  return (
    <TouchableOpacity
      style={[styles.bantRow, {
        backgroundColor: bgColor,
        borderColor: borderColor,
      }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      {/* Nabız + isim */}
      <View style={styles.bantLeft}>
        <View style={styles.dotBox}>
          {acik && (
            <Animated.View style={[styles.pingRing, { borderColor: dotColor, transform: [{ scale: pingAnim }], opacity: pingOpacity }]} />
          )}
          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
        </View>
        <View>
          <Text style={styles.bantIsmi}>{bant.isim}</Text>
          <Text style={[styles.bantHiz, { color: textColor }]}>
            {baglantiYok ? "Sinyal Bekleniyor" : (acik ? `${bant.anlikHiz || 0} birim/dak` : "Durduruldu")}
          </Text>
        </View>
      </View>

      {/* Durum + ok */}
      <View style={styles.bantRight}>
        <View style={[styles.statusBadge, { backgroundColor: dotColor }]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <Text style={styles.arrow}>▶</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconBox: { width: 28, height: 28, borderRadius: 12, backgroundColor: C.blueLt, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 13, fontWeight: "600", color: C.text },
  badges: { flexDirection: "row", gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 9, fontWeight: "700" },

  loadingBox: { alignItems: "center", justifyContent: "center", paddingVertical: 32, gap: 12 },
  spinner: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: C.blue, borderTopColor: "transparent" },
  loadingText: { fontSize: 10, color: C.muted },

  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.redLt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: "#FECACA" },
  errorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.red },
  errorText: { fontSize: 10, color: C.red },

  progressBg: { height: 8, borderRadius: 99, backgroundColor: C.redLt, marginBottom: 4, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: C.green, borderRadius: 99 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  progressText: { fontSize: 8.5, color: C.muted },

  list: { gap: 8 },

  bantRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  bantLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotBox: { width: 20, height: 20, justifyContent: "center", alignItems: "center" },
  pingRing: { position: "absolute", width: 20, height: 20, borderRadius: 10, borderWidth: 2 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  bantIsmi: { fontSize: 10.5, fontWeight: "600", color: C.text },
  bantHiz: { fontSize: 9 },
  bantRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  statusText: { fontSize: 9, fontWeight: "700", color: "white" },
  arrow: { fontSize: 8, color: C.text, opacity: 0.4 },

  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  footerText: { fontSize: 9, color: C.muted },
  footerBold: { fontWeight: "700", color: C.text },
  countdownRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  pulseDot: { width: 6, height: 6, borderRadius: 3 },
});
