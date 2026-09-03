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
// kutusu düşürüyordu. Expo Go içinde çalıştığımızı tespit edip baştan
// vazgeçiyoruz - artık PLATFORM FARKI GÖZETMİYORUZ: iOS'ta Expo Go teknik
// olarak push alabiliyor olsa da, gerçek cihazdaki (standalone) uygulama
// ile aynı anda test edilince aynı bildirim iki kez (biri "Expo Go", biri
// "C-OBServer" altında) düşüyordu. Expo Go artık sadece geliştirme/önizleme
// aracı, gerçek bildirim kaydı sadece standalone build'de (development
// build'de executionEnvironment "standalone"/"bare" olur) yapılsın.
const expoGoIcinde = Constants.executionEnvironment === "storeClient";

// Expo push token'ını alıp backend'e kaydeder. EAS projesi bağlı değilse
// (app.json/eas.json'da projectId yoksa) token alınamaz — bu durumda
// sessizce vazgeçiyoruz, uygulamanın geri kalanı çalışmaya devam eder.
export async function pushBildirimlerineKaydol() {
  if (expoGoIcinde) {
    console.log(`📵 Expo Go (${Platform.OS}): push bildirimi kasıtlı olarak kaydedilmiyor, gerçek cihaz build'i kullan.`);
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
