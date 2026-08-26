import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  TextInput, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { ChevronLeft, AlertTriangle, CheckCircle2, Send, Clock } from "lucide-react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "../constants/colors";
import { formatTarih, hataBildirimDetayiniCek, hataAciklamasiGonder, HataBildirimi } from "../services/api";

// Bir makinenin hata bildirimine tıklayınca açılan kendi sayfası. Üstte
// otomatik yakalanan bilgiler (makine, hatanın tarihi/saati — anlıkHiz'in
// 0 olduğu an), altta kullanıcının gireceği açıklama bölümü.
export default function HataBildirimDetayEkrani() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { id } = route.params || {};

  const [kayit, setKayit] = useState<HataBildirimi | null>(null);
  const [loading, setLoading] = useState(true);
  const [aciklama, setAciklama] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [basarili, setBasarili] = useState(false);

  useEffect(() => {
    // Bu ekran sekme yapısında TEK bir örnek olarak yaşıyor — farklı bir
    // makinenin bildirimine tıklanınca bileşen yeniden kurulmuyor, sadece
    // "id" parametresi değişiyor. Önceki makinenin "gönderildi"/"açıklama"
    // durumu sıfırlanmazsa, yeni (henüz açıklanmamış) makinede de yanlışlıkla
    // "zaten açıklandı" kutusu görünüyordu. Bu yüzden id her değiştiğinde
    // ekranı tamamen sıfırlayıp yeniden çekiyoruz.
    let mounted = true;
    setLoading(true);
    setKayit(null);
    setAciklama("");
    setBasarili(false);
    setGonderiliyor(false);
    hataBildirimDetayiniCek(id).then((data) => {
      if (!mounted) return;
      setKayit(data);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [id]);

  const gonder = async () => {
    if (!aciklama.trim()) {
      Alert.alert("Açıklama gerekli", "Lütfen hatanın nedenini yazın.");
      return;
    }
    setGonderiliyor(true);
    try {
      const guncel = await hataAciklamasiGonder(id, aciklama.trim());
      setKayit(guncel);
      setBasarili(true);
      setTimeout(() => navigation.goBack(), 1100);
    } catch (e) {
      Alert.alert("Hata", "Açıklama gönderilemedi. Bağlantıyı kontrol edin.");
    } finally {
      setGonderiliyor(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.peach} />
      </View>
    );
  }

  if (!kayit) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center", padding: 24 }]}>
        <Text style={{ color: C.muted }}>Kayıt bulunamadı.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}>
          <Text style={{ color: C.peach, fontWeight: "700" }}>Geri Dön</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const aciklandiMi = kayit.durum === "aciklandi";

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.container}>
        <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>{kayit.bant?.isim || kayit.bantId}</Text>
          <View style={{ width: 32 }} />
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.infoCard}>
            <View style={[s.iconBox, { backgroundColor: C.redLt }]}>
              <AlertTriangle size={22} color={C.red} />
            </View>
            <Text style={s.infoTitle}>Hata Bildirimi</Text>
            <Text style={s.infoSub}>Bu makineye özel hata giriş sayfası</Text>

            <View style={s.divider} />

            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Makine</Text>
              <Text style={s.infoVal}>{kayit.bantId}{kayit.bant?.isim ? ` · ${kayit.bant.isim}` : ""}</Text>
            </View>
            <View style={s.infoRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Clock size={11} color={C.muted} />
                <Text style={s.infoLabel}>Hata Anı</Text>
              </View>
              <Text style={s.infoVal}>{formatTarih(kayit.hataZamani)}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Durum</Text>
              <Text style={[s.infoVal, { color: aciklandiMi ? C.mint : C.peach, fontWeight: "800" }]}>
                {aciklandiMi ? "Açıklandı" : "Açıklama Bekliyor"}
              </Text>
            </View>
          </View>

          {aciklandiMi ? (
            <View style={s.doneCard}>
              <CheckCircle2 size={18} color={C.mint} />
              <View style={{ flex: 1 }}>
                <Text style={s.doneTitle}>Bu hata daha önce açıklandı</Text>
                <Text style={s.doneDesc}>{kayit.aciklama}</Text>
                {!!kayit.aciklamaZamani && (
                  <Text style={s.doneTime}>Girildi: {formatTarih(kayit.aciklamaZamani)}</Text>
                )}
              </View>
            </View>
          ) : basarili ? (
            <View style={s.doneCard}>
              <CheckCircle2 size={18} color={C.mint} />
              <Text style={s.doneTitle}>Açıklama kaydedildi.</Text>
            </View>
          ) : (
            <View style={s.formCard}>
              <Text style={s.formLabel}>Hata neden oluştu?</Text>
              <TextInput
                style={s.textArea}
                placeholder="Örn: Malzeme sıkışması, sensör hatası, kalıp değişimi..."
                placeholderTextColor={C.muted}
                multiline
                value={aciklama}
                onChangeText={setAciklama}
                autoFocus
              />
              <TouchableOpacity style={s.sendBtn} onPress={gonder} disabled={gonderiliyor}>
                {gonderiliyor ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Send size={14} color="white" />
                    <Text style={s.sendBtnText}>Sisteme Gönder</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 16, backgroundColor: "white",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: C.text, flex: 1, textAlign: "center", marginHorizontal: 8 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },

  infoCard: { backgroundColor: "white", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.border, alignItems: "center" },
  iconBox: { width: 52, height: 52, borderRadius: 26, justifyContent: "center", alignItems: "center", marginBottom: 10 },
  infoTitle: { fontSize: 16, fontWeight: "800", color: C.text },
  infoSub: { fontSize: 11, color: C.muted, marginTop: 2, marginBottom: 4 },
  divider: { height: 1, backgroundColor: C.border, alignSelf: "stretch", marginVertical: 14 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", alignSelf: "stretch", paddingVertical: 8 },
  infoLabel: { fontSize: 11.5, color: C.muted },
  infoVal: { fontSize: 12.5, fontWeight: "700", color: C.text },

  doneCard: {
    flexDirection: "row", gap: 10, backgroundColor: C.mintLt, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: "#BEE8DE", alignItems: "flex-start",
  },
  doneTitle: { fontSize: 12.5, fontWeight: "700", color: C.text },
  doneDesc: { fontSize: 12, color: C.text, marginTop: 6, lineHeight: 17 },
  doneTime: { fontSize: 10.5, color: C.muted, marginTop: 8 },

  formCard: { backgroundColor: "white", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  formLabel: { fontSize: 12.5, fontWeight: "700", color: C.text, marginBottom: 10 },
  textArea: {
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, fontSize: 13, color: C.text, minHeight: 110, textAlignVertical: "top", marginBottom: 14,
  },
  sendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.peach, paddingVertical: 13, borderRadius: 14,
  },
  sendBtnText: { color: "white", fontSize: 13, fontWeight: "700" },
});
