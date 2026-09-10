import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PaywallSheet } from '@/components/PaywallSheet';
import { ProgressOverlay } from '@/components/ProgressOverlay';
import { palette } from '@/constants/editor';
// 🌍 i18n init (side-effect: az első useTranslation() előtt kell lefutnia)
import { hydrateLanguage } from '@/i18n';
import { useEntitlement } from '@/store/entitlementStore';

export default function RootLayout() {
  // 💳 Free/Pro szint betöltése a tárolóból (a felhő-funkciók kapuja)
  const hydrateEntitlement = useEntitlement((s) => s.hydrate);
  useEffect(() => {
    void hydrateEntitlement();
    // 🌍 mentett nyelvválasztás betöltése (a felismert eszköz-nyelv fölé)
    void hydrateLanguage();
  }, [hydrateEntitlement]);

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
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.bg },
          }}
        />
        <PaywallSheet />
        {/* futó hosszú műveletek: mit csinál · hol tart · mennyi van hátra */}
        <ProgressOverlay />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
