/**
 * 🔐 Supabase-kliens — az auth EGYETLEN forrása a kliensen.
 *
 * A React Native-hez a hivatalos minta kell (Expo v57 + Supabase JS v2):
 *   - `react-native-url-polyfill/auto`  — a supabase-js URL()-t használ,
 *   - session-tárolás TITKOSÍTVA (Keychain/Keystore) a `secureStorage`-on át,
 *   - `autoRefreshToken` + AppState-figyelő: előtérben frissül a token,
 *     háttérben leáll (különben feleslegesen járna).
 *
 * A cím/kulcs env-ből jön (`EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY`, lásd
 * `.env.example`). Ezek a bundle-be égnek → módosítás után Metro-újraindítás.
 * Ha nincs beállítva (nincs `.env`), a kliens `null`, és az auth-képernyő
 * konfig-hiányt jelez összeomlás helyett — `hasSupabaseConfig()`.
 */
import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

import { isLoopbackHost, resolvePublicUrl } from '@/lib/envConfig';
import { secureStorage } from '@/lib/secureStorage';

/**
 * A cím-feloldás dev↔prod szabályát a `@/lib/envConfig` tiszta függvényei adják
 * (unit-tesztelt): PROD + loopback → nincs config; DEV + loopback + valódi metró-
 * hoszt → LAN-IP-re átírva (fizikai eszköz); egyébként a nyers URL. Így „telón is
 * jó" a dev, és az éles build sosem fut lokális címmel. Ugyanez a worker-címnél
 * (lásd `@/lib/backend`).
 */
const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
// 🚫 DEV/PROD keveredés-védelem: éles buildben a loopback cím hibás konfig →
// „nincs konfigurálva" (beszédes login-hiba), nem néma összeomlás.
if (!__DEV__ && isLoopbackHost(rawUrl)) {
  console.error(
    `[supabase] Éles buildhez LOKÁLIS cím van beállítva (${rawUrl?.trim()}). ` +
      'Állíts be hosztolt EXPO_PUBLIC_SUPABASE_URL-t (.env.production / EAS env).'
  );
}
const url = resolvePublicUrl({ raw: rawUrl, isDev: __DEV__, metroHost });
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/** Be van-e állítva a Supabase cím + anon-kulcs (van-e működő backend). */
export function hasSupabaseConfig(): boolean {
  return !!url && !!anonKey;
}

/**
 * A kliens, vagy `null`, ha az env hiányzik. A hívók előbb
 * `hasSupabaseConfig()`-et néznek, vagy a `requireSupabase()`-t használják.
 */
export const supabase: SupabaseClient | null = hasSupabaseConfig()
  ? createClient(url!, anonKey!, {
      auth: {
        // 🔒 a session (access + REFRESH token) a Keychain/Keystore mögé megy,
        // nem sima AsyncStorage-fájlba (az rootolt eszközön / backupból
        // kiolvasható). A `secureStorage` darabol a ~2 KB-os iOS-korlát miatt,
        // és az első olvasáskor MIGRÁLJA a régi helyről — a már bejelentkezett
        // felhasználók nem esnek ki a frissítéskor.
        storage: secureStorage,
        autoRefreshToken: true,
        persistSession: true,
        // mobilon nincs URL-alapú OAuth-callback (a deep link külön kezelendő)
        detectSessionInUrl: false,
      },
    })
  : null;

/** A kliens, vagy dobás — ott, ahol a hívás előtt már ellenőriztük a configot. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase nincs konfigurálva (EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY).');
  }
  return supabase;
}

// Token auto-frissítés csak előtérben: aktív app → indít, háttér → leállít.
// (A Supabase RN-útmutató szerint; enélkül a háttérben is időzítene.)
if (supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
