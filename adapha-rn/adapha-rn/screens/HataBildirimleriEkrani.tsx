import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
  TextInput, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { ChevronLeft, AlertTriangle, CheckSquare, Square, FileText, Send, ShieldCheck } from "lucide-react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "../constants/colors";
import {
  formatTarih, bekleyenHataBildirimleriniCek, topluHataAciklamasiGonder,
  socket, HataBildirimi,
} from "../services/api";

// Hattın anlık hızı 0'a düştüğü an (bkz. adapha-api piSync.ts) burada
// "açıklama bekliyor" olarak listelenir. Bir karta basılı tutmak çoklu seçim
// moduna geçer — aynı hataya sahip makineler tek seferde açıklanabilir; her
// biri yine de sunucuda AYRI bir kayıt olarak işlenir (bkz. services/api.ts
// topluHataAciklamasiGonder).
export default function HataBildirimleriEkrani() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [kayitlar, setKayitlar] = useState<HataBildirimi[]>([]);
  const [loading, setLoading] = useState(true);
  const [secimModu, setSecimModu] = useState(false);
  const [secilenIdler, setSecilenIdler] = useState<number[]>([]);
  const [aciklamaMetni, setAciklamaMetni] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const veriCek = useCallback(() => {
    setLoading(true);
    bekleyenHataBildirimleriniCek().then((data) => {
      setKayitlar(data);
      setLoading(false);
    });
  }, []);

  useFocusEffect(useCallback(() => { veriCek(); }, [veriCek]));

  useEffect(() => {
    const yeniKayitGeldi = (kayit: HataBildirimi) => {
      setKayitlar((prev) => (prev.some((k) => k.id === kayit.id) ? prev : [kayit, ...prev]));
    };
    const aciklandi = (kayit: HataBildirimi) => {
      setKayitlar((prev) => prev.filter((k) => k.id !== kayit.id));
      setSecilenIdler((prev) => prev.filter((id) => id !== kayit.id));
    };
    socket.on("hata_bildirimi_olustu", yeniKayitGeldi);
    socket.on("hata_bildirimi_aciklandi", aciklandi);
    return () => {
      socket.off("hata_bildirimi_olustu", yeniKayitGeldi);
      socket.off("hata_bildirimi_aciklandi", aciklandi);
    };
  }, []);

  const secimiTemizle = () => {
    setSecimModu(false);
    setSecilenIdler([]);
    setAciklamaMetni("");
  };

  const toggleSecim = (id: number) => {
    setSecilenIdler((prev) => {
      const yeni = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (yeni.length === 0) setSecimModu(false);
      return yeni;
    });
  };

  const satiraBasildi = (kayit: HataBildirimi) => {
    if (secimModu) toggleSecim(kayit.id);
    else navigation.navigate("HataBildirimDetay", { id: kayit.id });
  };

  const satirUzunBasildi = (kayit: HataBildirimi) => {
    setSecimModu(true);
    setSecilenIdler((prev) => (prev.includes(kayit.id) ? prev : [...prev, kayit.id]));
  };

  // "metin" parametresi, Enter tuşuyla tetiklenen gönderimde henüz state'e
  // işlenmemiş güncel değeri elden aktarabilmek için - setAciklamaMetni asenkron
  // olduğundan, hemen ardından state okusaydık bir eski (stale) değer alırdık.
  const topluGonder = async (metin?: string) => {
    const gonderilecek = (metin ?? aciklamaMetni).trim();
    if (!gonderilecek) {
      Alert.alert("Açıklama gerekli", "Lütfen hatanın nedenini yazın.");
      return;
    }
    setGonderiliyor(true);
    try {
      await topluHataAciklamasiGonder(secilenIdler, gonderilecek);
      setKayitlar((prev) => prev.filter((k) => !secilenIdler.includes(k.id)));
      secimiTemizle();
    } catch (e) {
      Alert.alert("Hata", "Açıklamalar gönderilemedi. Bağlantıyı kontrol edin.");
    } finally {
      setGonderiliyor(false);
    }
  };

  // Metin kutusunda Enter'a basınca (multiline TextInput'ta bu bir "\n"
  // karakteri olarak onChangeText'e düşer) satır eklemek yerine direkt
  // gönder - kullanıcı ayrıca "Gönder" butonuna basmak zorunda kalmasın.
  const aciklamaDegisti = (text: string) => {
    if (text.endsWith("\n")) {
      const temiz = text.slice(0, -1);
      setAciklamaMetni(temiz);
      if (temiz.trim()) topluGonder(temiz);
      return;
    }
    setAciklamaMetni(text);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.container}>
        <View style={[s.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
          <TouchableOpacity onPress={secimModu ? secimiTemizle : () => navigation.goBack()} style={{ padding: 4 }}>
            <ChevronLeft size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>
            {secimModu ? `${secilenIdler.length} Makine Seçildi` : "Hata Bildirimleri"}
          </Text>
          {secimModu ? (
            <TouchableOpacity onPress={secimiTemizle} style={{ padding: 4 }}>
              <Text style={s.cancelText}>İptal</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate("HataRaporu")} style={{ padding: 4 }}>
              <FileText size={20} color={C.peach} />
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator color={C.peach} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
            {!secimModu && kayitlar.length > 0 && (
              <Text style={s.hintText}>
                Aynı hataya sahip makineleri tek seferde açıklamak için bir karta basılı tutun.
              </Text>
            )}

            {kayitlar.length === 0 ? (
              <View style={s.emptyBox}>
                <ShieldCheck size={28} color={C.mint} />
                <Text style={s.emptyText}>Açıklama bekleyen hata bildirimi yok.</Text>
              </View>
            ) : (
              kayitlar.map((kayit) => {
                const secili = secilenIdler.includes(kayit.id);
                return (
                  <TouchableOpacity
                    key={kayit.id}
                    style={[s.card, secili && s.cardSecili]}
                    onPress={() => satiraBasildi(kayit)}
                    onLongPress={() => satirUzunBasildi(kayit)}
                    delayLongPress={280}
                    activeOpacity={0.8}
                  >
                    {secimModu && (
                      <View style={{ marginRight: 10 }}>
                        {secili ? <CheckSquare size={20} color={C.peach} /> : <Square size={20} color={C.muted} />}
                      </View>
                    )}
                    <View style={[s.iconBox, { backgroundColor: C.redLt }]}>
                      <AlertTriangle size={16} color={C.red} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.machineName}>{kayit.bant?.isim || kayit.bantId}</Text>
                      <Text style={s.machineId}>{kayit.bantId}</Text>
                      <Text style={s.time}>Hata anı: {formatTarih(kayit.hataZamani)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}

        {secimModu && secilenIdler.length > 0 && (
          <View style={[s.bottomSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={s.bottomLabel}>Seçilen {secilenIdler.length} makine için ortak hata açıklaması</Text>
            <TextInput
              style={s.textArea}
              placeholder="Örn: Bant üzerinde malzeme sıkışması nedeniyle hatalı ürün..."
              placeholderTextColor={C.muted}
              multiline
              value={aciklamaMetni}
              onChangeText={aciklamaDegisti}
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => { if (aciklamaMetni.trim()) topluGonder(); }}
            />
            <TouchableOpacity style={s.sendBtn} onPress={() => topluGonder()} disabled={gonderiliyor}>
              {gonderiliyor ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <Send size={14} color="white" />
                  <Text style={s.sendBtnText}>Gönder</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
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
  cancelText: { fontSize: 13, fontWeight: "600", color: C.red },
  content: { padding: 16, gap: 10, paddingBottom: 140 },
  hintText: { fontSize: 11, color: C.muted, marginBottom: 4, lineHeight: 16 },

  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 12, color: C.muted },

  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: "white",
    borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, gap: 12,
  },
  cardSecili: { borderColor: C.peach, backgroundColor: C.peachLt },
  iconBox: { width: 36, height: 36, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  machineName: { fontSize: 13, fontWeight: "700", color: C.text },
  machineId: { fontSize: 10.5, color: C.muted, marginTop: 1 },
  time: { fontSize: 10.5, color: C.red, marginTop: 4, fontWeight: "600" },

  bottomSheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "white",
    borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16,
    borderTopWidth: 1, borderTopColor: C.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 20,
  },
  bottomLabel: { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 10 },
  textArea: {
    backgroundColor: C.bg, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    padding: 12, fontSize: 13, color: C.text, minHeight: 80, textAlignVertical: "top", marginBottom: 12,
  },
  sendBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.peach, paddingVertical: 13, borderRadius: 14,
  },
  sendBtnText: { color: "white", fontSize: 13, fontWeight: "700" },
});
