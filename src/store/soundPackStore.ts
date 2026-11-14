import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { logCaught } from '@/lib/logCaught';
import { parseSoundPack, type SoundPack } from '@/lib/soundPack';

/**
 * 🛍️ V4: a megvett (és a saját eladott) hangcsomagok a telefonon — a loop-könyvtár ezekből is kínál.
 * Offline él: a vásárláskor / a Shop-szinkronkor kerül ide; a betöltéskor újra ellenőrizzük.
 */
const STORAGE_KEY = 'remix.soundPacks.v1';

export interface OwnedPack {
  /** a Shop-tétel azonosítója */
  itemId: string;
  pack: SoundPack;
}

interface SoundPackState {
  packs: OwnedPack[];
  loaded: boolean;
  addPack: (itemId: string, pack: SoundPack) => void;
  removePack: (itemId: string) => void;
}

export const useSoundPacks = create<SoundPackState>((set, get) => ({
  packs: [],
  loaded: false,
  addPack: (itemId, pack) => {
    const packs = [...get().packs.filter((p) => p.itemId !== itemId), { itemId, pack }];
    set({ packs });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(packs)).catch((caught) => logCaught('store/soundPackStore.ts:persist', caught));
  },
  removePack: (itemId) => {
    const packs = get().packs.filter((p) => p.itemId !== itemId);
    set({ packs });
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(packs)).catch((caught) => logCaught('store/soundPackStore.ts:remove', caught));
  },
}));

AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    const packs: OwnedPack[] = [];
    for (const r of Array.isArray(list) ? list : []) {
      const o = r as { itemId?: unknown; pack?: unknown };
      const pack = parseSoundPack(o?.pack);
      if (typeof o?.itemId === 'string' && pack) packs.push({ itemId: o.itemId, pack });
    }
    // a betöltés előtt hozzáadott csomag (pl. épp vásárolt) megmarad
    const added = useSoundPacks.getState().packs;
    useSoundPacks.setState({ packs: [...packs.filter((p) => !added.some((a) => a.itemId === p.itemId)), ...added], loaded: true });
  })
  .catch((caught) => {
    logCaught('store/soundPackStore.ts:load', caught);
    useSoundPacks.setState({ loaded: true });
  });
