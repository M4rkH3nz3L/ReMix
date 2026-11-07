import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { removePreset, renamePreset, sanitizePresets, upsertPreset, type PresetKind, type UserPreset } from '@/lib/userPresets';

/**
 * ⭐ Saját presetek tárolása — a telefonon (AsyncStorage), projekteken átívelő, offline. Minden
 * változás azonnal mentődik; betöltéskor a lista ellenőrződik (`sanitizePresets`).
 */
export const USER_PRESETS_KEY = 'remix.userPresets.v1';

interface State {
  list: UserPreset[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (kind: PresetKind, name: string, value: unknown) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

async function persist(list: UserPreset[]): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
  } catch (caught) {
    logCaught('store/userPresetStore.ts:persist', caught);
  }
}

export const useUserPresets = create<State>((set, get) => ({
  list: [],
  loaded: false,
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(USER_PRESETS_KEY);
      set({ list: sanitizePresets(raw ? JSON.parse(raw) : []), loaded: true });
    } catch (caught) {
      logCaught('store/userPresetStore.ts:load', caught);
      set({ list: [], loaded: true });
    }
  },
  save: async (kind, name, value) => {
    const next = upsertPreset(get().list, kind, name, value, makeId('preset'), new Date().toISOString());
    if (!next) return false;
    set({ list: next });
    await persist(next);
    return true;
  },
  rename: async (id, name) => {
    const next = renamePreset(get().list, id, name);
    set({ list: next });
    await persist(next);
  },
  remove: async (id) => {
    const next = removePreset(get().list, id);
    set({ list: next });
    await persist(next);
  },
}));
