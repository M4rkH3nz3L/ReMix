import { router } from 'expo-router';
import { t as tr } from 'i18next';
import { Alert, Platform } from 'react-native';

import { useAuth } from '@/store/authStore';

/**
 * 🌐 Böngészős nézegető-mód: weben a stúdiók nem érhetők el, kijelentkezve csak a
 * publikus tartalom nézhető (lásd `webSurface.ts`). A natív app viselkedése változatlan.
 */
export const IS_WEB_VIEWER = Platform.OS === 'web';

/** Bejelentkezett-e (session van ÉS nincs függő MFA — ugyanaz, mint a root guard). */
export function isSignedIn(): boolean {
  const s = useAuth.getState();
  return s.session != null && !s.mfaPending;
}

/**
 * 🔐 Írás-akció előtti kapu (lájk, komment, követés, vásárlás…): bejelentkezve
 * `true`; kijelentkezve az auth-képernyőre visz és `false`.
 */
export function requireSignIn(): boolean {
  if (isSignedIn()) {
    return true;
  }
  router.push('/auth');
  return false;
}

/**
 * 📱 Stúdió-akció előtti kapu (remix, sablon megnyitása, élő indítása…): natívon
 * `true`; weben „Szerkesztés az appban" üzenet és `false` — még a projekt-létrehozás
 * ELŐTT, hogy a web ne gyártson használhatatlan projektet.
 */
export function requireApp(): boolean {
  if (!IS_WEB_VIEWER) {
    return true;
  }
  Alert.alert(tr('web.appOnlyTitle'), tr('web.appOnlyBody'));
  return false;
}
