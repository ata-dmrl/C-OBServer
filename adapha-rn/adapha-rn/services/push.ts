import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { API_URL } from "./api";

// Uygulama arka plandayken/kapalıyken de bildirim gösterilsin.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Android + Expo Go kombinasyonunda uzak push bildirimi SDK 53'ten beri
// desteklenmiyor — denemek her seferinde ekranın üstüne kırmızı bir hata
// kutusu düşürüyordu. Expo Go içinde çalıştığımızı tespit edip Android'de
// baştan vazgeçiyoruz; development build'de (executionEnvironment "standalone"
// veya "bare" olur) bu kısıtlama yok, normal akışa devam eder.
const expoGoIcinde = Constants.executionEnvironment === "storeClient";

// Expo push token'ını alıp backend'e kaydeder. EAS projesi bağlı değilse
// (app.json/eas.json'da projectId yoksa) token alınamaz — bu durumda
// sessizce vazgeçiyoruz, uygulamanın geri kalanı çalışmaya devam eder.
export async function pushBildirimlerineKaydol() {
  if (Platform.OS === "android" && expoGoIcinde) {
    console.log("📵 Expo Go + Android: push bildirimi desteklenmiyor, atlanıyor (development build gerekir).");
    return;
  }
  try {
    const { status: mevcut } = await Notifications.getPermissionsAsync();
    let izin = mevcut;
    if (izin !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      izin = status;
    }
    if (izin !== "granted") {
      console.log("📵 Push bildirim izni verilmedi.");
      return;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await fetch(`${API_URL}/push/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    console.log("✅ Push token kaydedildi.");
  } catch (e) {
    console.log("⚠️ Push token alınamadı (EAS projesi bağlı değil olabilir):", e);
  }
}
