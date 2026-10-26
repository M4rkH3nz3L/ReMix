import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Alert, LogBox, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  installGlobalBugHandlers,
  setBugEditorContextProvider,
  setBugRoute,
  setBugSignedIn,
} from '@/lib/bugReporter';
import { useEditorStore } from '@/store/editorStore';
import { t as tr } from 'i18next';
import { ensureLocalAiReady } from '@/lib/localAiBootstrap';

// 🔇 Ismert, DEV-only benign warning elnémítása. A session async hidratálása
// (authStore `onAuthStateChange` → entitlement/roles store-set, `loginNeedsMfa().then(set)`)
// a fogyasztó-komponensek mountja ELŐTT futhat le indításkor → React:
// „Can't perform a React state update on a component that hasn't mounted yet".
// A frissítés HELYES (async auth-callback a normál minta); a warning viszont
// minden induláskor FELNYITJA a teljes LogBox-ot és blokkolja a navigációt. A
// LogBox amúgy is csak dev-ben él, de a __DEV__-guard explicit. Prod-ot nem érint.
if (__DEV__) {
  LogBox.ignoreLogs([
    "Can't perform a React state update on a component that hasn't mounted yet",
  ]);
}

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
  // 🐞 globális hibagyűjtés (JS-hiba, kezeletlen promise) → server/bugs/ — a
  // legelső effekt, hogy az indulás közbeni hibák is jelentődjenek
  useEffect(() => {
    installGlobalBugHandlers();
    // a jelentésekhez: a nyitott projekt + az utolsó parancs-TÍPUSOK (tartalom nélkül)
    setBugEditorContextProvider(() => {
      const st = useEditorStore.getState();
      return {
        projectId: st.project?.id ?? '',
        recent: (st.events ?? []).slice(-8).map((e) => `${e.actor}:${e.command.type}`),
      };
    });
  }, []);
  // 🧩 helyi AI alapból a telefonon: indulás után EGYSZER felajánlja a Whisper
  // (felirat/átirat) letöltését — utána minden helyi AI-funkció offline megy
  useEffect(() => {
    const timer = setTimeout(() => {
      void ensureLocalAiReady(
        (mb) =>
          new Promise<boolean>((resolve) => {
            Alert.alert(
              tr('localAi.bootstrapTitle'),
              tr('localAi.bootstrapBody', { mb }),
              [
                { text: tr('localAi.later'), style: 'cancel', onPress: () => resolve(false) },
                { text: tr('localAi.download', { mb }), onPress: () => resolve(true) },
              ],
              { cancelable: false }
            );
          })
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, []);
  // 🐞 a jelentésekhez: melyik képernyőn történt (+ navigációs breadcrumb)
  const pathname = usePathname();
  useEffect(() => {
    setBugRoute(pathname);
  }, [pathname]);
  // 💳 Free/Pro szint betöltése a tárolóból (a felhő-funkciók kapuja)
  const hydrateEntitlement = useEntitlement((s) => s.hydrate);
  // 🔐 session betöltése — amíg nem kész, nem tudjuk, be van-e jelentkezve a user
  const hydrateAuth = useAuth((s) => s.hydrate);
  const authHydrated = useAuth((s) => s.hydrated);
  // 🔐 belépett = van session ÉS nincs függő MFA (mfaPending). A mfaPending nélkül a
  // guard egy verifikált-TOTP usert már AAL1-en beengedne → MFA-bypass. (Faktor nélküli
  // usernél mfaPending mindig false → a viselkedés változatlan.)
  const authed = useAuth((s) => s.session != null && !s.mfaPending);
  // 🐞 a hibajelentésekhez: bejelentkezett-e (a user-id-t a szerver a tokenből veszi)
  useEffect(() => {
    setBugSignedIn(authed);
  }, [authed]);
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

  // 📱 eszközön-render füstteszt (CSAK dev + env-kapcsoló): az eredmény a
  // Metro-konzolra megy `[RENDER-SMOKE]` prefixszel. A dinamikus import miatt
  // a smoke-kód + a minta-videó a release bundle-ből kimarad.
  useEffect(() => {
    if (__DEV__ && process.env.EXPO_PUBLIC_RENDER_SMOKE === '1') {
      void import('@/lib/renderSmoke').then((m) => m.runRenderSmoke());
    }
  }, []);

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
              {/* 🏠 a gyökér (`/`) a FEED (home); a projektek listája a `/studio` */}
              <Stack.Screen name="index" />
              <Stack.Screen name="studio/index" />
              <Stack.Screen name="profile" />
              <Stack.Screen name="mfa" />
              <Stack.Screen name="devices" />
              <Stack.Screen name="admin" />
              {/* ✏️ Szerkesztő-képernyők: az iOS balról-jobbra swipe-back KI (gestureEnabled:false)
                  — szerkesztés közben a felület FIX, nem csúszik/megy vissza a húzással; vissza
                  CSAK a vissza-gombbal (a gesztusokat a vászon/idővonal használja). */}
              <Stack.Screen name="editor/[id]" options={{ gestureEnabled: false }} />
              <Stack.Screen name="studio/image/[id]" options={{ gestureEnabled: false }} />
              <Stack.Screen name="studio/audio/[id]" options={{ gestureEnabled: false }} />
              <Stack.Screen name="player/[id]" />
              <Stack.Screen name="collab/[id]" options={{ gestureEnabled: false }} />
              <Stack.Screen name="shop" />
              <Stack.Screen name="search" />
              <Stack.Screen name="command" />
              <Stack.Screen name="live" />
              <Stack.Screen name="live/[id]" />
              <Stack.Screen name="live/studio/[id]" options={{ gestureEnabled: false }} />
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
