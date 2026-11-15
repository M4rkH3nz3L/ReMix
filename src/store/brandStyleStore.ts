import { Directory, File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { makeId } from '@/lib/id';
import { addBrandColor, addBrandLogo, EMPTY_BRAND, removeBrandColor, removeBrandLogo, type BrandStyle } from '@/lib/imageBrand';
import { logCaught } from '@/lib/logCaught';

interface BrandStyleState extends BrandStyle {
  hydrate: () => Promise<void>;
  addColor: (color: string) => Promise<void>;
  removeColor: (color: string) => Promise<void>;
  setFont: (fontFamily: string | undefined) => Promise<void>;
  /** 🏷️ S11: logó a márkába (a fájl a márka-mappába másolva); a márka-beli uri-t adja */
  addLogo: (sourceUri: string) => Promise<string | null>;
  removeLogo: (uri: string) => Promise<void>;
}

/** a márka-logók helye: a telefonon, projekteken kívül (egy projekt törlése nem viheti el) */
export function brandDir(): Directory {
  const dir = new Directory(Paths.document, 'brand');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
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
    const { colors, fontFamily, logos } = get();
    const style = next({ colors, fontFamily, logos });
    set({ colors: style.colors, fontFamily: style.fontFamily, logos: style.logos });
    await saveBrandStyle(style).catch((caught) => {
      logCaught('store/brandStyleStore.ts:save', caught);
    });
  };
  return {
    ...EMPTY_BRAND,
    fontFamily: undefined,
    logos: [],
    hydrate,
    addColor: (color) => change((s) => addBrandColor(s, color)),
    removeColor: (color) => change((s) => removeBrandColor(s, color)),
    setFont: (fontFamily) => change((s) => ({ ...s, fontFamily })),
    addLogo: async (sourceUri) => {
      try {
        const src = new File(sourceUri);
        const ext = (sourceUri.split('?')[0].split('.').pop() ?? 'png').toLowerCase().slice(0, 4) || 'png';
        const target = new File(brandDir(), `logo_${makeId('lg')}.${ext}`);
        src.copy(target);
        await change((s) => addBrandLogo(s, target.uri));
        return target.uri;
      } catch (caught) {
        logCaught('store/brandStyleStore.ts:addLogo', caught);
        return null;
      }
    },
    removeLogo: async (uri) => {
      await change((s) => removeBrandLogo(s, uri));
      try {
        const f = new File(uri);
        if (f.exists && f.uri.includes('/brand/')) f.delete();
      } catch (caught) {
        logCaught('store/brandStyleStore.ts:removeLogo', caught);
      }
    },
  };
});

/**
 * a márka-logó MÁSOLATA a projekt média-mappájába — ezt kapja a réteg / a klip (a projekt mentése a
 * projekten kívüli fájlt a projekt mappájába költöztetné, és a márkából eltűnne)
 */
export function copyBrandLogoInto(dir: Directory, uri: string): string | null {
  try {
    const src = new File(uri);
    if (!src.exists) return null;
    const ext = uri.split('.').pop() ?? 'png';
    const target = new File(dir, `brandlogo_${makeId('lg')}.${ext}`);
    src.copy(target);
    return target.uri;
  } catch (caught) {
    logCaught('store/brandStyleStore.ts:copyBrandLogoInto', caught);
    return null;
  }
}
