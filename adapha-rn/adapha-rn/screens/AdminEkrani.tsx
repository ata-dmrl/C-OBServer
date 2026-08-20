import React, { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, DeviceEventEmitter, ActivityIndicator } from "react-native";
import { Lock, Server, Save, ChevronLeft, Wifi, WifiOff } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "../constants/colors";
import { normalizeDurum, API_URL } from "../services/api";

export default function AdminEkrani() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [sifre, setSifre] = useState("");
  const [girisYapildi, setGirisYapildi] = useState(false);
  const [bantlar, setBantlar] = useState<any[]>([]);
  const [ipGirdileri, setIpGirdileri] = useState<{[key: string]: string}>({});
  const [portGirdileri, setPortGirdileri] = useState<{[key: string]: string}>({});
  const [loading, setLoading] = useState(false);

  const fetchBantlar = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/bantlar`);
      if (!res.ok) throw new Error("Bantlar çekilemedi.");
      const data = await res.json();

      if (!Array.isArray(data)) throw new Error("API'den geçersiz veri geldi.");

      setBantlar(data);

      const girdilerIp: {[key: string]: string} = {};
      const girdilerPort: {[key: string]: string} = {};
      data.forEach((b: any) => {
        girdilerIp[b.id] = b.piIp || "";
        girdilerPort[b.id] = b.piPort ? b.piPort.toString() : "8090";
      });
      setIpGirdileri(girdilerIp);
      setPortGirdileri(girdilerPort);
    } catch (e) {
      console.error(e);
      Alert.alert("Hata", "Makineler çekilemedi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (girisYapildi) {
      fetchBantlar();
    }
  }, [girisYapildi]);

  useEffect(() => {
    const refreshListener = DeviceEventEmitter.addListener("onGlobalRefresh", () => {
      if (navigation.isFocused() && girisYapildi) {
        fetchBantlar();
      }
    });
    return () => {
      refreshListener.remove();
    };
  }, [girisYapildi, navigation]);

  const kaydet = async (id: string) => {
    const yeniIp = ipGirdileri[id];
    const yeniPort = portGirdileri[id];
    const eskiBant = bantlar.find(b => b.id === id);

    // Var olan bir IP'yi boş bırakıp kaydedince sessizce siliniyordu —
    // bunu onaysız yapmayalım (kazara temizleme MAK-01'in IP'sini
    // silmişti daha önce).
    if (eskiBant?.piIp && (!yeniIp || yeniIp.trim() === "")) {
      Alert.alert(
        "IP'yi temizle?",
        `${id}'in mevcut IP'si "${eskiBant.piIp}" — bunu boşaltmak istediğine emin misin?`,
        [
          { text: "Vazgeç", style: "cancel" },
          { text: "Evet, temizle", style: "destructive", onPress: () => kaydetGercek(id) },
        ]
      );
      return;
    }
    await kaydetGercek(id);
  };

  const kaydetGercek = async (id: string) => {
    const yeniIp = ipGirdileri[id];
    const yeniPort = portGirdileri[id];
    try {
      const res = await fetch(`${API_URL}/admin/bant/${id}/ip`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piIp: yeniIp, piPort: yeniPort })
      });
      if (res.ok) {
        Alert.alert("Başarılı", `${id} için Pi IP adresi güncellendi.`);
        fetchBantlar();
      } else {
        Alert.alert("Hata", "Güncellenemedi.");
      }
    } catch (e) {
      Alert.alert("Hata", "Bağlantı sorunu.");
    }
  };

  if (!girisYapildi) {
    return (
      <View style={[s.loginContainer, { paddingTop: insets.top }]}>
        <TouchableOpacity style={[s.backBtn, { top: Math.max(insets.top, 20) + 10 }]} onPress={() => navigation.goBack()}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <View style={s.loginBox}>
          <View style={s.iconWrapper}>
            <Lock size={32} color={C.peach} />
          </View>
          <Text style={s.title}>Admin Girişi</Text>
          <Text style={s.sub}>Cihaz IP ayarları için yetkili şifresini girin.</Text>
          <TextInput
            style={s.input}
            placeholder="Şifre"
            secureTextEntry
            value={sifre}
            onChangeText={setSifre}
            placeholderTextColor={C.muted}
          />
          <TouchableOpacity 
            style={s.loginBtn}
            onPress={() => {
              if (sifre === "123456") setGirisYapildi(true);
              else Alert.alert("Hata", "Yanlış şifre!");
            }}
          >
            <Text style={s.loginBtnText}>Giriş Yap</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <ChevronLeft size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Makine IP Yönetimi</Text>
        <TouchableOpacity onPress={() => { setGirisYapildi(false); setSifre(""); }} style={{ padding: 4 }}>
          <Text style={{ color: C.red, fontWeight: "600", fontSize: 13 }}>Çıkış Yap</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView contentContainerStyle={s.content}>
        {loading ? (
          <ActivityIndicator size="large" color={C.peach} style={{ marginTop: 50 }} />
        ) : (
          bantlar.map(bant => {
            // Bağlantı durumu (cihaz sisteme veri gönderiyor mu) ile üretim
            // durumu (bant o an çalışıyor mu) farklı şeyler — biri sistem
            // bağlılığı, diğeri hattın anlık hareketi. İkisini karıştırmıyoruz.
            const baglanti = bant.baglantiDurumu === "ONLINE";
            const acik = normalizeDurum(bant.durum) === "acik";
          return (
            <View key={bant.id} style={s.card}>
              <View style={s.cardHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Server size={18} color={C.text} />
                  <View>
                    <Text style={s.cardTitle}>{bant.id}</Text>
                    <Text style={s.cardSubtitle}>{bant.isim}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: baglanti ? C.green : C.red }}>
                    {baglanti ? (acik ? "BAĞLI" : "BAĞLI · PASİF") : "KOPUK"}
                  </Text>
                  {baglanti ? <Wifi size={14} color={C.green} /> : <WifiOff size={14} color={C.red} />}
                </View>
              </View>
              <Text style={s.label}>Bu bandı izleyen Raspberry Pi'nin IP'si ve portu</Text>
              <View style={s.inputRow}>
                <TextInput
                  style={[s.ipInput, { flex: 2 }]}
                  value={ipGirdileri[bant.id]}
                  onChangeText={(val) => setIpGirdileri(prev => ({ ...prev, [bant.id]: val }))}
                  placeholder="192.168.1.X"
                  placeholderTextColor={C.muted}
                />
                <TextInput
                  style={[s.ipInput, { flex: 1 }]}
                  value={portGirdileri[bant.id]}
                  onChangeText={(val) => setPortGirdileri(prev => ({ ...prev, [bant.id]: val }))}
                  placeholder="8090"
                  placeholderTextColor={C.muted}
                  keyboardType="numeric"
                />
                <TouchableOpacity style={s.saveBtn} onPress={() => kaydet(bant.id)}>
                  <Save size={16} color="white" />
                  <Text style={s.saveBtnText}>Kaydet</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.infoText}>Bu IP/port sadece "Anlık Görüntü Al" için kullanılır. Bandın canlı üretim verisi ayrıca, merkez sunucu üzerinden otomatik akar.</Text>
            </View>
          );
        })
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  loginContainer: { flex: 1, backgroundColor: C.bg, justifyContent: "center", alignItems: "center", padding: 20 },
  backBtn: { position: "absolute", top: 60, left: 20, padding: 8 },
  loginBox: { backgroundColor: "white", padding: 24, borderRadius: 24, width: "100%", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  iconWrapper: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.peachLt, justifyContent: "center", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub: { fontSize: 13, color: C.muted, textAlign: "center", marginBottom: 24 },
  input: { backgroundColor: C.bg, width: "100%", borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  loginBtn: { backgroundColor: C.peach, width: "100%", borderRadius: 12, padding: 14, alignItems: "center" },
  loginBtnText: { color: "white", fontSize: 16, fontWeight: "700" },

  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "white", borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  content: { padding: 16, gap: 10 },
  card: { backgroundColor: "white", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.border },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottomWidth: 1, borderBottomColor: C.bg, paddingBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: C.text },
  cardSubtitle: { fontSize: 11, fontWeight: "500", color: C.muted },
  label: { fontSize: 12, fontWeight: "600", color: C.muted, marginBottom: 6 },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
  ipInput: { flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text },
  saveBtn: { backgroundColor: C.blue, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  saveBtnText: { color: "white", fontWeight: "600", fontSize: 13 },
  infoText: { fontSize: 10, color: C.muted }
});
