import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * 🔒 Titkosított kulcs-érték tár a BIZALMAS adatoknak (Supabase session/refresh
 * token, BYOK AI-kulcs). Az AsyncStorage sima fájlban tárol: rootolt/jailbreakelt
 * eszközön vagy iTunes/adb backupból kiolvasható. A SecureStore a Keychain
 * (iOS) / Keystore (Android) mögé teszi.
 *
 * Három dolgot old meg, amit a nyers SecureStore nem:
 *
 * 1. **Méretkorlát.** A dokumentáció szerint „egyes iOS-kiadások ~2048 bájt
 *    fölött elutasították az értéket", a Supabase-session (JWT + refresh token +
 *    user-objektum) viszont rendszeresen NAGYOBB. Ezért az értéket darabokra
 *    bontjuk (`<kulcs>.0`, `.1`, …), és a darabszámot egy fej-kulcsban tartjuk.
 * 2. **Nincs web-támogatás.** Weben az `expo-secure-store` nem elérhető → ott
 *    átlátszóan AsyncStorage-ra esünk vissza (a böngészőben úgysincs Keychain).
 * 3. **Migráció.** Ha a kulcs még a RÉGI, AsyncStorage-beli helyén van, az első
 *    olvasáskor átköltöztetjük és törlünk — így a már bejelentkezett
 *    felhasználók NEM jelentkeznek ki a frissítéskor.
 */

/** biztonsági ráhagyással a dokumentált ~2048 bájtos iOS-korlát alatt */
const CHUNK = 1800;
/** weben nincs Keychain/Keystore — ott AsyncStorage a tár. Lusta hívás (nem React hook!), hogy tesztelhető maradjon. */
const hasKeychain = () => Platform.OS !== 'web';

/**
 * 🖥️ Szerveroldali (SSR) futás: `web.output: "static"` mellett az expo-router
 * NODE-ban rendereli le a fát, ahol nincs `window`. Az AsyncStorage web-
 * implementációja viszont `window.localStorage`-ra épül → `ReferenceError:
 * window is not defined`, és a statikus export elhasal, mielőtt bármit
 * kirajzolna.
 *
 * Node-ban NINCS értelmes perzisztencia (nincs böngésző-session), ezért ott a
 * tár csendben no-op: az olvasás `null`, az írás elnyelődik. A kliens-oldali
 * hidratáláskor a valódi adapter veszi át, tehát a felhasználó semmit nem veszít.
 */
const isServer = () => typeof window === 'undefined';

const countKey = (key: string) => `${key}.n`;
const partKey = (key: string, i: number) => `${key}.${i}`;

/** a SecureStore csak [A-Za-z0-9._-] kulcsokat enged — a Supabase kulcsai tartalmazhatnak mást */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function secureGet(key: string): Promise<string | null> {
  const k = safeKey(key);
  const n = await SecureStore.getItemAsync(countKey(k));
  if (n === null) {
    // egyetlen darabként is tárolhattuk (rövid érték)
    return SecureStore.getItemAsync(k);
  }
  const parts: string[] = [];
  for (let i = 0; i < Number(n); i++) {
    const part = await SecureStore.getItemAsync(partKey(k, i));
    if (part === null) {
      return null; // hiányos lánc → érvénytelen
    }
    parts.push(part);
  }
  return parts.join('');
}

async function secureSet(key: string, value: string): Promise<void> {
  const k = safeKey(key);
  await secureDelete(key);
  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(k, value);
    return;
  }
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK) {
    chunks.push(value.slice(i, i + CHUNK));
  }
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(partKey(k, i), chunks[i]);
  }
  // a darabszám UTOLJÁRA — így egy megszakadt írás nem hagy fél láncot „érvényesnek"
  await SecureStore.setItemAsync(countKey(k), String(chunks.length));
}

async function secureDelete(key: string): Promise<void> {
  const k = safeKey(key);
  const n = await SecureStore.getItemAsync(countKey(k));
  if (n !== null) {
    for (let i = 0; i < Number(n); i++) {
      await SecureStore.deleteItemAsync(partKey(k, i));
    }
    await SecureStore.deleteItemAsync(countKey(k));
  }
  await SecureStore.deleteItemAsync(k);
}

/**
 * A Supabase `auth.storage` interfésze. Minden metódus best-effort: ha a
 * Keychain/Keystore elérhetetlen (pl. zárolt eszköz háttérben), inkább
 * bejelentkezetlen állapotot adunk, mint hogy elszálljon az app.
 */
export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (isServer()) {
      return null; // SSR: nincs böngésző-tár, és az AsyncStorage `window`-ra épül
    }
    if (!hasKeychain()) {
      return AsyncStorage.getItem(key);
    }
    try {
      const fromSecure = await secureGet(key);
      if (fromSecure !== null) {
        return fromSecure;
      }
      // 🔄 migráció: a régi, titkosítatlan helyről átköltöztetjük (egyszer)
      const legacy = await AsyncStorage.getItem(key);
      if (legacy !== null) {
        await secureSet(key, legacy);
        await AsyncStorage.removeItem(key);
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (isServer()) {
      return; // SSR: nincs hova írni — a kliens-oldali hidratálás majd elintézi
    }
    if (!hasKeychain()) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    try {
      await secureSet(key, value);
    } catch {
      // ha a titkosított tár nem elérhető, NE essünk vissza sima tárolásra:
      // a token inkább vesszen el (újra be kell lépni), mint hogy nyíltan álljon
    }
  },

  removeItem: async (key: string): Promise<void> => {
    if (isServer()) {
      return;
    }
    if (!hasKeychain()) {
      await AsyncStorage.removeItem(key);
      return;
    }
    try {
      await secureDelete(key);
    } catch {
      // best-effort
    }
    // a régi helyen maradt példányt is takarítjuk
    await AsyncStorage.removeItem(key).catch(() => {});
  },
};
