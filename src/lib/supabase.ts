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
import { AppState } from 'react-native';

import { secureStorage } from '@/lib/secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
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
