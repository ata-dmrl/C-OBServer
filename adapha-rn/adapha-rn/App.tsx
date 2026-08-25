import React, { useEffect, useState } from "react";
import { View, Text, StatusBar, StyleSheet, Platform, TouchableOpacity, DeviceEventEmitter } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Home, Package, BarChart2, Bell, RefreshCw, AlignLeft, AlertTriangle } from "lucide-react-native";
import { C } from "./constants/colors";
import HomeScreen from "./screens/HomeScreen";
import UretimEkrani from "./screens/UretimEkrani";
import AnalizEkrani from "./screens/AnalizEkrani";
import AdminEkrani from "./screens/AdminEkrani";
import BildirimlerEkrani from "./screens/BildirimlerEkrani";
import HataBildirimleriEkrani from "./screens/HataBildirimleriEkrani";
import HataBildirimDetayEkrani from "./screens/HataBildirimDetayEkrani";
import HataRaporuEkrani from "./screens/HataRaporuEkrani";
import { GlobalNotification } from "./components/GlobalNotification";
import { socket, bekleyenHataBildirimleriniCek } from "./services/api";
import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";

const Tab = createBottomTabNavigator();

function AppHeader() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [okunmamisVar, setOkunmamisVar] = React.useState(false);

  React.useEffect(() => {
    const dinle = () => setOkunmamisVar(true);
    socket.on("sistem_bildirimi", dinle);
    return () => { socket.off("sistem_bildirimi", dinle); };
  }, []);

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
      <View style={styles.headerLeft}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate("Admin")}>
          <AlignLeft size={16} color={C.peach} />
        </TouchableOpacity>
        <View>
          <Text style={styles.platformTag}>C-OBServer</Text>
          <Text style={styles.companyName}>Kardağ Ltd. Şti.</Text>
        </View>
      </View>
      <View style={styles.headerRight}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => { setOkunmamisVar(false); navigation.navigate("Bildirimler"); }}
        >
          <Bell size={14} color={C.peach} />
          {okunmamisVar && <View style={styles.bildirimNoktasi} />}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconBtn, { backgroundColor: C.blueLt }]} onPress={() => DeviceEventEmitter.emit("onGlobalRefresh")}>
          <RefreshCw size={13} color={C.blue} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function App() {
  // Açıklama bekleyen hata bildirimi var mı? (hat hızı 0'a düştüğünde
  // sunucu otomatik bir kayıt açar — bkz. adapha-api piSync.ts). Uygulama
  // açılışında mevcut bekleyenleri kontrol eder, sonrasında canlı soket
  // olayıyla güncellenir; "Hata Girişi" sekmesine gidince temizlenir.
  const [bekleyenHataVar, setBekleyenHataVar] = useState(false);

  useEffect(() => {
    bekleyenHataBildirimleriniCek().then((liste) => {
      if (liste.length > 0) setBekleyenHataVar(true);
    });
    const yeniHataGeldi = () => setBekleyenHataVar(true);
    socket.on("hata_bildirimi_olustu", yeniHataGeldi);
    return () => { socket.off("hata_bildirimi_olustu", yeniHataGeldi); };
  }, []);

  useEffect(() => {
    // "expo-notifications" import edildiği anda (fonksiyon hiç çağrılmasa
    // bile) kendi otomatik token-kayıt özelliğini tetikliyor ve Android +
    // Expo Go'da ekrana kırmızı bir hata kutusu düşürüyor. push.ts'in
    // içindeki çalışma-zamanı kontrolü bunu önleyemiyordu çünkü paket zaten
    // import satırında yükleniyordu. Bu yüzden modülü Android + Expo Go'da
    // hiç import etmiyoruz — dinamik import ile sadece gerektiğinde yükleniyor.
    const expoGoIcinde = Constants.executionEnvironment === "storeClient";
    if (Platform.OS === "android" && expoGoIcinde) return;

    import("./services/push").then(({ pushBildirimlerineKaydol }) => {
      pushBildirimlerineKaydol();
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <GlobalNotification />
      <NavigationContainer>
        <View style={styles.container}>
          <AppHeader />
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarStyle: styles.tabBar,
              tabBarActiveTintColor: C.peach,
              tabBarInactiveTintColor: C.muted,
              tabBarLabelStyle: styles.tabLabel,
              tabBarIcon: ({ color, size }) => {
                if (route.name === "AnaSayfa") return <Home size={size} color={color} />;
                if (route.name === "Üretim") return <Package size={size} color={color} />;
                if (route.name === "Analitikler") return <BarChart2 size={size} color={color} />;
                if (route.name === "HataGirisi") return (
                  <View>
                    <AlertTriangle size={size} color={color} />
                    {bekleyenHataVar && <View style={styles.tabBadgeDot} />}
                  </View>
                );
              },
              tabBarItemStyle: styles.tabItem,
            })}
          >
            <Tab.Screen name="AnaSayfa" component={HomeScreen} options={{ title: "Ana Sayfa" }} />
            <Tab.Screen name="Üretim" component={UretimEkrani} options={{ title: "Üretim" }} />
            <Tab.Screen name="Analitikler" component={AnalizEkrani} options={{ title: "Analitikler" }} />
            <Tab.Screen
              name="HataGirisi"
              component={HataBildirimleriEkrani}
              options={{ title: "Hata Girişi" }}
              listeners={{ tabPress: () => setBekleyenHataVar(false) }}
            />
            <Tab.Screen name="Admin" component={AdminEkrani} options={{ tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
            <Tab.Screen name="Bildirimler" component={BildirimlerEkrani} options={{ tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
            <Tab.Screen name="HataBildirimDetay" component={HataBildirimDetayEkrani} options={{ tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
            <Tab.Screen name="HataRaporu" component={HataRaporuEkrani} options={{ tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
          </Tab.Navigator>
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerRight: { flexDirection: "row", gap: 8 },
  menuBtn: { width: 32, height: 32, borderRadius: 12, backgroundColor: C.peachLt, justifyContent: "center", alignItems: "center" },
  iconBtn: { width: 32, height: 32, borderRadius: 12, backgroundColor: C.peachLt, justifyContent: "center", alignItems: "center" },
  bildirimNoktasi: { position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, borderWidth: 1.5, borderColor: "white" },
  tabBadgeDot: { position: "absolute", top: -3, right: -6, width: 8, height: 8, borderRadius: 4, backgroundColor: C.red, borderWidth: 1.5, borderColor: "white" },
  platformTag: { fontSize: 8.5, letterSpacing: 2, textTransform: "uppercase", fontWeight: "500", color: C.muted },
  companyName: { fontSize: 12.5, fontWeight: "800", color: C.text },
  tabBar: {
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
    height: 70,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabItem: {
    borderRadius: 16,
    marginHorizontal: 4,
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
});
