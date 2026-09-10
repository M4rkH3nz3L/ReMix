import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BrandKit } from '@/lib/brandKit';

/** 🎨 Brand Kit tárolás — app-szintű, projekteken átívelő (AsyncStorage). */

const KEY = 'vided.brandkit.v1';

export async function loadBrandKit(): Promise<BrandKit | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BrandKit) : null;
  } catch {
    return null;
  }
}

export async function saveBrandKit(kit: BrandKit): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(kit));
}
