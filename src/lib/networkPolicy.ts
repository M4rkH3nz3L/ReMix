import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { type ConnectionKind, type SyncPrefs, DEFAULT_SYNC_PREFS, parseSyncPrefs } from '@/lib/syncPolicy';

/**
 * 📶 Hálózat-típus + a szinkron-beállítás tárolása. Az `expo-network` natív modult
 * LUSTÁN, hibatűrően töltjük: a régi app-build (amiben még nincs benne) „unknown”-t
 * ad, és a szinkron ilyenkor fut (a döntés a pure `syncPolicy`-ben).
 */

const PREFS_KEY = 'remix.syncPrefs.v1';
let prefsCache: SyncPrefs | null = null;

type NetworkModule = typeof import('expo-network');
let netModule: NetworkModule | null | undefined;

async function network(): Promise<NetworkModule | null> {
  if (netModule !== undefined) {
    return netModule;
  }
  try {
    netModule = Platform.OS === 'web' ? null : await import('expo-network');
  } catch {
    netModule = null; // a natív modul még nincs a buildben
  }
  return netModule;
}

export async function connectionKind(): Promise<ConnectionKind> {
  const net = await network();
  if (!net) {
    return 'unknown';
  }
  try {
    const st = await net.getNetworkStateAsync();
    if (st.isConnected === false) {
      return 'none';
    }
    if (st.type === net.NetworkStateType.WIFI || st.type === net.NetworkStateType.ETHERNET) {
      return 'wifi';
    }
    if (st.type === net.NetworkStateType.CELLULAR) {
      return 'cellular';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Wi-Fi (vagy vezetékes) kapcsolat megjelenésekor hív — a „Wi-Fi-re vár” szinkronok indításához. */
export async function onWifiAvailable(cb: () => void): Promise<() => void> {
  const net = await network();
  if (!net) {
    return () => {};
  }
  try {
    const sub = net.addNetworkStateListener((st) => {
      if (st.isConnected && (st.type === net.NetworkStateType.WIFI || st.type === net.NetworkStateType.ETHERNET)) {
        cb();
      }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

export async function loadSyncPrefs(): Promise<SyncPrefs> {
  if (prefsCache) {
    return prefsCache;
  }
  prefsCache = parseSyncPrefs(await AsyncStorage.getItem(PREFS_KEY).catch(() => null));
  return prefsCache;
}

export async function saveSyncPrefs(prefs: SyncPrefs): Promise<void> {
  prefsCache = { ...DEFAULT_SYNC_PREFS, ...prefs };
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache)).catch(() => {});
}
