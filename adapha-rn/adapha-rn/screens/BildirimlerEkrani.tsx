import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { ChevronLeft, Bell, WifiOff, CheckCircle2, Info } from "lucide-react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "../constants/colors";
import { formatTarih, API_URL } from "../services/api";

export default function BildirimlerEkrani() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [bildirimler, setBildirimler] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Bu ekran gizli bir tab (Tab.Navigator içinde) olduğu için ilk ziyaretten
  // sonra unmount olmuyor — sadece mount'ta çalışan bir useEffect, zil
  // ikonuna her basıldığında yeniden veri çekmiyordu; kırmızı nokta (App.tsx,
  // canlı soket dinliyor) her seferinde doğru yanıyor ama liste ilk açılıştaki
  // haliyle donuk kalıyordu. useFocusEffect ile her odaklanmada tazeleniyor.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetch(`${API_URL}/admin/bildirimler`)
        .then(res => res.json())
        .then(data => {
          setBildirimler(Array.isArray(data) ? data : []);
          setLoading(false);
        })
        .catch(e => {
          console.error(e);
          setBildirimler([]);
          setLoading(false);
        });
    }, [])
  );

  const getIcon = (tip: string) => {
    if (tip === "hata") return <WifiOff size={16} color={C.red} />;
    if (tip === "baglandi") return <CheckCircle2 size={16} color={C.green} />;
    return <Info size={16} color={C.blue} />;
  };

  const getColor = (tip: string) => {
    if (tip === "hata") return C.redLt;
    if (tip === "baglandi") return C.greenLt;
    return C.blueLt;
  };

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Bildirim Geçmişi</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color={C.peach} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {!bildirimler || bildirimler.length === 0 ? (
            <Text style={{ textAlign: "center", color: C.muted, marginTop: 40 }}>Henüz bildirim yok.</Text>
          ) : (
            bildirimler.map((b) => (
              <View key={b.id} style={s.card}>
                <View style={[s.iconBox, { backgroundColor: getColor(b.tip) }]}>
                  {getIcon(b.tip)}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.msg}>{b.mesaj}</Text>
                  <Text style={s.time}>
                    {formatTarih(b.createdAt || b.tarih)}
                  </Text>
                </View>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 16, backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  msg: { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 4 },
  time: { fontSize: 11, color: C.muted }
});
