import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BrandKit } from '@/lib/brandKit';
import { EMPTY_BRAND, type BrandStyle } from '@/lib/imageBrand';
import { logCaught } from '@/lib/logCaught';

/** 🎨 Brand Kit tárolás — app-szintű, projekteken átívelő (AsyncStorage). */

const KEY = 'vided.brandkit.v1';
/** külön kulcs: a Brand Kit újralevezetése nem írhatja felül a kézzel választott márkát */
const STYLE_KEY = 'remix.brandstyle.v1';

export async function loadBrandKit(): Promise<BrandKit | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BrandKit) : null;
  } catch (caught) {
    logCaught('lib/brandStore.ts:loadBrandKit', caught);
    return null;
  }
}

export async function saveBrandKit(kit: BrandKit): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(kit));
}

export async function loadBrandStyle(): Promise<BrandStyle> {
  try {
    const raw = await AsyncStorage.getItem(STYLE_KEY);
    return raw ? { ...EMPTY_BRAND, ...(JSON.parse(raw) as BrandStyle) } : EMPTY_BRAND;
  } catch (caught) {
    logCaught('lib/brandStore.ts:loadBrandStyle', caught);
    return EMPTY_BRAND;
  }
}

export async function saveBrandStyle(style: BrandStyle): Promise<void> {
  await AsyncStorage.setItem(STYLE_KEY, JSON.stringify(style));
}
