import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PaywallSheet } from '@/components/PaywallSheet';
import { ProgressOverlay } from '@/components/ProgressOverlay';
import { TutorialMenu } from '@/components/tutorial/TutorialMenu';
import { TutorialOverlay } from '@/components/tutorial/TutorialOverlay';
import { WebAlertHost } from '@/components/WebAlertHost';
import { palette } from '@/constants/editor';
// 🌍 i18n init (side-effect: az első useTranslation() előtt kell lefutnia)
import { hydrateLanguage } from '@/i18n';
import { configureBilling } from '@/lib/billing';
import {
  addNotificationResponseListener,
  getInitialNotificationRoute,
  registerForPush,
} from '@/lib/pushNotifications';
import { useAuth } from '@/store/authStore';
import { useChat } from '@/store/chatStore';
import { useEntitlement } from '@/store/entitlementStore';
import { useNotifications } from '@/store/notificationStore';
import { useTutorial } from '@/store/tutorialStore';

/** Deep-link cél megnyitása egy notification koppintásából (best-effort). */
function openNotificationRoute(route: string) {
  try {
    router.push(route as Parameters<typeof router.push>[0]);
  } catch {
    // ismeretlen/rossz útvonal → csendben elnyeljük
  }
}

export default function RootLayout() {
  // 💳 Free/Pro szint betöltése a tárolóból (a felhő-funkciók kapuja)
  const hydrateEntitlement = useEntitlement((s) => s.hydrate);
  // 🔐 session betöltése — amíg nem kész, nem tudjuk, be van-e jelentkezve a user
  const hydrateAuth = useAuth((s) => s.hydrate);
  const authHydrated = useAuth((s) => s.hydrated);
  const authed = useAuth((s) => s.session != null);
  const userId = useAuth((s) => s.user?.id ?? null);
  useEffect(() => {
    void hydrateAuth();
    void hydrateEntitlement();
    // 🎓 befejezett tutorial-leckék betöltése
    void useTutorial.getState().hydrate();
    // 🌍 mentett nyelvválasztás betöltése (a felismert eszköz-nyelv fölé)
    void hydrateLanguage();
  }, [hydrateAuth, hydrateEntitlement]);

  // 🔔 értesítések: login → betöltés + realtime feliratkozás; logout → ürítés
  useEffect(() => {
    void useNotifications.getState().syncForUser(userId);
  }, [userId]);

  // 💬 chat-inbox: bejelentkezve a badge-hez realtime figyeljük a beszélgetéseket
  useEffect(() => {
    if (!userId) {
      return;
    }
    const stop = useChat.getState().startInbox();
    return stop;
  }, [userId]);

  // 📲 push: bejelentkezve engedélyt kérünk + (ha lehet) push-tokent mentünk
  useEffect(() => {
    if (userId) {
      void registerForPush(userId);
    }
  }, [userId]);

  // 💳 billing (RevenueCat): a usert összekötjük az IAP-fiókkal (logIn), hogy a
  // webhook a mi user-id-nkra írja a Pro-t. No-op Expo Go-ban / kulcs nélkül.
  useEffect(() => {
    void configureBilling(userId);
  }, [userId]);

  // 📲 notification-koppintás → deep-link (előtér/háttér + hideg indítás)
  useEffect(() => {
    const unsub = addNotificationResponseListener(openNotificationRoute);
    void getInitialNotificationRoute().then((route) => {
      if (route) {
        openNotificationRoute(route);
      }
    });
    return unsub;
  }, []);

  // választható betűtípusok betöltése (a family-nevek egyeznek a renderrel)
  useFonts({
    Anton: require('../../assets/fonts/Anton-Regular.ttf'),
    BebasNeue: require('../../assets/fonts/BebasNeue-Regular.ttf'),
    Poppins: require('../../assets/fonts/Poppins-Bold.ttf'),
    Pacifico: require('../../assets/fonts/Pacifico-Regular.ttf'),
    Bungee: require('../../assets/fonts/Bungee-Regular.ttf'),
    Oswald: require('../../assets/fonts/Oswald-Regular.ttf'),
    ArchivoBlack: require('../../assets/fonts/ArchivoBlack-Regular.ttf'),
    Righteous: require('../../assets/fonts/Righteous-Regular.ttf'),
    Lobster: require('../../assets/fonts/Lobster-Regular.ttf'),
    PermanentMarker: require('../../assets/fonts/PermanentMarker-Regular.ttf'),
  });

  // weben a böngésző natív kép-drag-je elfogná a vászon pan-gesztusát
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    const style = document.createElement('style');
    style.textContent =
      'img { -webkit-user-drag: none; user-drag: none; user-select: none; }';
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style="light" />
      <ErrorBoundary>
        {authHydrated ? (
          // 🔐 útvonal-kapuzás: bejelentkezve a projektek/szerkesztő, egyébként
          // csak az auth-képernyő elérhető (Expo Router `Stack.Protected`)
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.bg },
            }}
          >
            <Stack.Protected guard={authed}>
              <Stack.Screen name="index" />
              <Stack.Screen name="profile" />
              <Stack.Screen name="admin" />
              <Stack.Screen name="editor/[id]" />
              <Stack.Screen name="player/[id]" />
              <Stack.Screen name="collab/[id]" />
              <Stack.Screen name="shop" />
              <Stack.Screen name="feed" />
              <Stack.Screen name="channel/[id]" />
              <Stack.Screen name="inbox" />
              <Stack.Screen name="chat/[id]" />
            </Stack.Protected>
            <Stack.Protected guard={!authed}>
              <Stack.Screen name="auth" />
            </Stack.Protected>
            {/* 📜 nyilvános (kijelentkezve is elérhető) — a regisztráció linkeli */}
            <Stack.Screen name="legal" />
          </Stack>
        ) : (
          // amíg a session töltődik: rövid loading, hogy ne villanjon fel az auth-képernyő
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={palette.accent} />
          </View>
        )}
        <PaywallSheet />
        {/* futó hosszú műveletek: mit csinál · hol tart · mennyi van hátra */}
        <ProgressOverlay />
        {/* 🎓 interaktív felület-vezető (spotlight + coach-kártya) + lecke-választó */}
        <TutorialOverlay />
        <TutorialMenu />
        {/* 🌐 web-Alert: a react-native-web Alert no-op → gombos modál, hogy a
            megerősítők/akció-lapok (pl. „megosztás a feedben") weben is működjenek */}
        <WebAlertHost />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
