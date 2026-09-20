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

import { secureStorage } from '@/lib/secureStorage';

/**
 * A LOKÁLIS Supabase címét fizikai eszközön a Metró gépére (LAN-IP) írjuk át:
 * a `127.0.0.1`/`localhost` a TELEFONT jelentené, nem a dev-gépet — így „telón
 * nem jó" a bejelentkezés. A Metró (`hostUri`) ugyanazon a gépen fut, mint a
 * lokális Supabase, tehát a hoszt-neve a helyes cím. Szimulátoron/emun a
 * loopback változatlanul jó, hosztolt (nem-loopback) URL-t pedig sosem bántunk.
 * Ugyanaz a minta, mint a worker-címnél (lásd `@/lib/backend` renderServerUrl).
 */
/** Loopback (a saját készülék) hoszt? — 127.0.0.1 / localhost / 0.0.0.0. */
function isLoopbackHost(u: string | undefined): boolean {
  if (!u) {
    return false;
  }
  try {
    const h = new URL(u).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0';
  } catch {
    return false;
  }
}

function resolveSupabaseUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
    // csak akkor írjuk át, ha loopback CÍM van beállítva, de a Metró egy valódi
    // (nem loopback) hoszton fut → fizikai eszköz LAN-on
    if (
      isLoopbackHost(trimmed) &&
      metroHost &&
      metroHost !== '127.0.0.1' &&
      metroHost !== 'localhost'
    ) {
      u.hostname = metroHost;
      return u.toString().replace(/\/$/, '');
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// 🚫 DEV/PROD keveredés-védelem: éles (nem __DEV__) buildben a LOKÁLIS (loopback)
// cím hibás konfiguráció — a telepített appban a saját készüléket jelentené, nem a
// szervert. Ilyenkor a klienst „nincs konfigurálva" állapotban hagyjuk (beszédes
// login-hiba), nem néma összeomlás. Dev-ben a resolveSupabaseUrl a Metró LAN-IP-
// jére írja át, tehát fizikai eszközön is jó.
if (!__DEV__ && isLoopbackHost(rawUrl)) {
  console.error(
    `[supabase] Éles buildhez LOKÁLIS cím van beállítva (${rawUrl?.trim()}). ` +
      'Állíts be hosztolt EXPO_PUBLIC_SUPABASE_URL-t (.env.production / EAS env).'
  );
}
const url = !__DEV__ && isLoopbackHost(rawUrl) ? undefined : resolveSupabaseUrl(rawUrl);
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
