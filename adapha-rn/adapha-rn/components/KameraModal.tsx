import React, { useEffect, useRef } from "react";
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  Animated, Easing, Dimensions,
} from "react-native";
import { WebView } from "react-native-webview";
import { C } from "../constants/colors";
import { Bant } from "../services/api";

interface KameraModalProps {
  bant: Bant;
  onKapat: () => void;
}

export function KameraModal({ bant, onKapat }: KameraModalProps) {
  const acik = bant.durum === "acik"; // üretim hareketi için
  // Kamera CANLI/ÇEVRİMDIŞI rozeti üretim durumuna değil, Pi'nin merkeze
  // bağlılığına göre olmalı — bant pasif olsa bile Pi bağlıysa görüntü alınabilir.
  const piBagli = bant.baglantiDurumu === "ONLINE";

  // Nabız animasyonu
  const pingAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Bant kayma animasyonu (sadece açık bantlarda)
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (acik) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pingAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pingAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();

      Animated.loop(
        Animated.timing(slideAnim, {
          toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true,
        })
      ).start();
    }

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [acik]);

  const pingScale = pingAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });
  const pingOpacity = pingAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.3, 0.15, 0] });
  const slideX = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 220] });

  const borderColor = acik ? C.green : C.red;
  const headerBg   = acik ? "#052010" : "#200505";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onKapat}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onKapat}>
        <TouchableOpacity activeOpacity={1} onPress={e => e.stopPropagation()}>
          <View style={[styles.container, { borderColor }]}>

            {/* Başlık */}
            <View style={[styles.header, { backgroundColor: headerBg }]}>
              <View style={styles.headerLeft}>
                <View style={styles.dotWrapper}>
                  {acik && (
                    <Animated.View style={[
                      styles.ping,
                      { borderColor: C.green, transform: [{ scale: pingScale }], opacity: pingOpacity }
                    ]} />
                  )}
                  <View style={[styles.dot, { backgroundColor: acik ? C.green : C.red }]} />
                </View>
                <View>
                  <Text style={styles.bantIsmi}>{bant.isim}</Text>
                  <Text style={[styles.bantDurum, { color: acik ? C.green : C.red }]}>
                    {acik ? `Çalışıyor · ${bant.anlikHiz || 0} birim/dak` : "Durduruldu"}
                  </Text>
                </View>
              </View>
              <View style={styles.headerRight}>
                <View style={[styles.badge, { backgroundColor: acik ? C.green : C.red }]}>
                  <Text style={styles.badgeText}>{acik ? "AÇIK" : "KAPALI"}</Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={onKapat}>
                  <Text style={styles.closeText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Kamera Alanı */}
            <View style={styles.cameraArea}>
              {/* WebView ile gerçek Raspberry Pi stream */}
              {bant.kameraUrl ? (
                <WebView
                  source={{ uri: bant.kameraUrl }}
                  style={styles.webview}
                  renderError={() => <SimulasyonEkrani acik={acik} kameraUrl={bant.kameraUrl} slideX={slideX} />}
                  renderLoading={() => <SimulasyonEkrani acik={acik} kameraUrl={bant.kameraUrl} slideX={slideX} />}
                />
              ) : (
                <SimulasyonEkrani acik={acik} kameraUrl={bant.kameraUrl} slideX={slideX} />
              )}

              {/* CANLI rozeti */}
              <View style={styles.liveBadge}>
                <Animated.View style={[styles.liveDot, { backgroundColor: piBagli ? C.green : C.red, opacity: pulseAnim }]} />
                <Text style={styles.liveText}>{piBagli ? "CANLI" : "ÇEVRİMDIŞI"}</Text>
              </View>

              {/* Köşe scan çizgileri */}
              <View style={[styles.corner, styles.topLeft, { borderColor }]} />
              <View style={[styles.corner, styles.topRight, { borderColor }]} />
              <View style={[styles.corner, styles.bottomLeft, { borderColor }]} />
              <View style={[styles.corner, styles.bottomRight, { borderColor }]} />
            </View>

            {/* Alt bilgi */}
            <View style={styles.footer}>
              <View>
                <Text style={styles.footerLabel}>Son güncelleme</Text>
                <Text style={styles.footerValue}>{bant.sonGuncelleme ?? "—"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.footerLabel}>Kamera ID</Text>
                <Text style={[styles.footerValue, { fontFamily: "monospace" }]}>{bant.id}-CAM</Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// Simülasyon görüntüsü (Raspberry Pi bağlı değilken)
function SimulasyonEkrani({ acik, kameraUrl, slideX }: { acik: boolean; kameraUrl?: string; slideX: Animated.AnimatedInterpolation<number> }) {
  return (
    <View style={styles.simContainer}>
      {/* Grid arka plan */}
      <View style={StyleSheet.absoluteFill}>
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={`h${i}`} style={[styles.gridLine, { top: i * 20, width: "100%" }]} />
        ))}
        {Array.from({ length: 18 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLine, { left: i * 20, height: "100%", width: 1 }]} />
        ))}
      </View>

      {/* Bant */}
      <View style={styles.beltOuter}>
        <View style={[styles.belt, { backgroundColor: acik ? "#1A3A5C" : "#2A0A0A", borderColor: acik ? "transparent" : C.red }]}>
          {acik ? (
            <View style={StyleSheet.absoluteFill}>
              <Animated.View style={[styles.stripe, { transform: [{ translateX: slideX }] }]} />
            </View>
          ) : (
            <Text style={[styles.beltText, { color: C.red }]}>DURDU</Text>
          )}
        </View>
        <Text style={[styles.beltStatus, { color: acik ? C.green : C.red }]}>
          {acik ? "● BANT HAREKETLİ" : "● BANT DURDU"}
        </Text>
      </View>

      {/* Bağlantı uyarısı */}
      <View style={styles.connInfo}>
        <Text style={styles.connText}>Raspberry Pi bağlantısı bekleniyor</Text>
        <Text style={styles.connUrl}>{kameraUrl}</Text>
      </View>
    </View>
  );
}

const { width } = Dimensions.get("window");
const MODAL_W = Math.min(width - 40, 340);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(8,20,40,0.82)",
    justifyContent: "center", alignItems: "center",
  },
  container: {
    width: MODAL_W, borderRadius: 24, overflow: "hidden",
    backgroundColor: "#0C1E33", borderWidth: 2,
    shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 40, elevation: 20,
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dotWrapper: { width: 16, height: 16, justifyContent: "center", alignItems: "center" },
  ping: {
    position: "absolute", width: 16, height: 16,
    borderRadius: 8, borderWidth: 2,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bantIsmi: { fontSize: 12, fontWeight: "700", color: "white" },
  bantDurum: { fontSize: 9 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  badgeText: { fontSize: 9, fontWeight: "700", color: "white" },
  closeBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center", alignItems: "center",
  },
  closeText: { color: "white", fontSize: 12, opacity: 0.7 },

  cameraArea: { aspectRatio: 4/3, backgroundColor: "#050D18", position: "relative" },
  webview: { flex: 1 },

  liveBadge: {
    position: "absolute", top: 8, left: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 99,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 8, fontWeight: "700", color: "white" },

  corner: { position: "absolute", width: 16, height: 16, borderWidth: 2 },
  topLeft:     { top: 8,  left: 8,  borderRightWidth: 0, borderBottomWidth: 0 },
  topRight:    { top: 8,  right: 8, borderLeftWidth: 0,  borderBottomWidth: 0 },
  bottomLeft:  { bottom: 8, left: 8,  borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 8, right: 8, borderLeftWidth: 0,  borderTopWidth: 0 },

  footer: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)",
  },
  footerLabel: { fontSize: 8.5, color: "rgba(255,255,255,0.4)" },
  footerValue: { fontSize: 10, fontWeight: "600", color: "white" },

  // Simülasyon
  simContainer: {
    flex: 1, backgroundColor: "#070F1C",
    justifyContent: "center", alignItems: "center",
  },
  gridLine: { position: "absolute", backgroundColor: "rgba(255,255,255,0.03)" },
  beltOuter: { alignItems: "center" },
  belt: {
    width: "80%", height: 60, borderRadius: 4, overflow: "hidden",
    justifyContent: "center", alignItems: "center", borderWidth: 1,
    marginBottom: 8,
  },
  stripe: {
    position: "absolute", top: 0, bottom: 0, width: 6,
    backgroundColor: "rgba(255,255,255,0.3)",
    transform: [{ skewX: "-15deg" }],
  },
  beltText: { fontSize: 11, fontWeight: "700" },
  beltStatus: { fontSize: 9, fontWeight: "700" },
  connInfo: { position: "absolute", bottom: 12, left: 0, right: 0, alignItems: "center" },
  connText: { fontSize: 8, color: "rgba(255,255,255,0.5)" },
  connUrl: { fontSize: 7.5, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" },
});
