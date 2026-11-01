import { create } from 'zustand';

import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { addBrandColor, EMPTY_BRAND, removeBrandColor, type BrandStyle } from '@/lib/imageBrand';
import { logCaught } from '@/lib/logCaught';

interface BrandStyleState extends BrandStyle {
  hydrate: () => Promise<void>;
  addColor: (color: string) => Promise<void>;
  removeColor: (color: string) => Promise<void>;
  setFont: (fontFamily: string | undefined) => Promise<void>;
}

/** 🎨 A saját márka app-szintű, projekteken átívelő; a mentés előtt mindig betölt, hogy ne írja felül a tárolt márkát. */
export const useBrandStyle = create<BrandStyleState>((set, get) => {
  let loading: Promise<void> | null = null;
  const hydrate = () => {
    loading ??= loadBrandStyle().then((style) => set(style));
    return loading;
  };
  const change = async (next: (style: BrandStyle) => BrandStyle) => {
    await hydrate();
    const { colors, fontFamily } = get();
    const style = next({ colors, fontFamily });
    set({ colors: style.colors, fontFamily: style.fontFamily });
    await saveBrandStyle(style).catch((caught) => {
      logCaught('store/brandStyleStore.ts:save', caught);
    });
  };
  return {
    ...EMPTY_BRAND,
    fontFamily: undefined,
    hydrate,
    addColor: (color) => change((s) => addBrandColor(s, color)),
    removeColor: (color) => change((s) => removeBrandColor(s, color)),
    setFont: (fontFamily) => change((s) => ({ ...s, fontFamily })),
  };
});
