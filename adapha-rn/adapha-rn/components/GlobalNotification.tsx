import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, Dimensions } from "react-native";
import { socket } from "../services/api";
import { WifiOff, CheckCircle2, AlertCircle } from "lucide-react-native";
import { C } from "../constants/colors";

const { width } = Dimensions.get("window");

export function GlobalNotification() {
  const [bildirimler, setBildirimler] = useState<any[]>([]);

  useEffect(() => {
    socket.on("sistem_bildirimi", (data: any) => {
      // data: { id, bantId, tip: 'baglandi'|'koptu', mesaj, tarih }
      setBildirimler(prev => [...prev, data]);
    });

    return () => {
      socket.off("sistem_bildirimi");
    };
  }, []);

  if (bildirimler.length === 0) return null;

  const b = bildirimler[0]; // Show the oldest one first
  // "koptu"/"pasif" kırmızı-kötü; "baglandi"/"aktif" yeşil-iyi. Eskiden
  // sadece "koptu" kontrol ediliyordu, bu yüzden "pasif" bildirimi de
  // (tanınmadığı için) hep yeşil/"Bağlantı Kuruldu" olarak görünüyordu.
  const isError = b.tip === "koptu" || b.tip === "pasif";

  const close = () => {
    setBildirimler(prev => prev.slice(1));
  };

  const baslik = b.tip === "koptu" ? "Bağlantı Koptu!"
    : b.tip === "baglandi" ? "Bağlantı Kuruldu"
    : b.tip === "pasif" ? "Makine Pasif"
    : "Makine Çalışıyor";

  return (
    <Modal transparent animationType="fade" visible={true}>
      <View style={s.overlay}>
        <View style={s.modal}>
          <View style={s.iconWrapper}>
            {isError ? <WifiOff size={32} color={C.red} /> : <CheckCircle2 size={32} color={C.green} />}
          </View>
          <Text style={s.title}>{baslik}</Text>
          <Text style={s.msg}>{b.mesaj}</Text>
          
          <View style={s.timeRow}>
            <Text style={s.timeText}>
              {new Date(b.tarih).toLocaleDateString("tr-TR")} {new Date(b.tarih).toLocaleTimeString("tr-TR")}
            </Text>
          </View>

          <TouchableOpacity style={[s.btn, { backgroundColor: isError ? C.red : C.green }]} onPress={close}>
            <Text style={s.btnText}>Okudum</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  modal: { backgroundColor: "white", width: width - 48, borderRadius: 24, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  iconWrapper: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.bg, justifyContent: "center", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 18, fontWeight: "800", color: C.text, marginBottom: 8 },
  msg: { fontSize: 13, color: C.muted, textAlign: "center", marginBottom: 16 },
  timeRow: { backgroundColor: C.bg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 20 },
  timeText: { fontSize: 11, fontWeight: "600", color: C.text },
  btn: { width: "100%", paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  btnText: { color: "white", fontSize: 14, fontWeight: "700" }
});
