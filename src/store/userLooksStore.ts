import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { isLook, type ImageLook } from '@/lib/imageLooks';
import { logCaught } from '@/lib/logCaught';

/**
 * 🎞️ Saját lookok (IMAGE-PROD S17): a fotó korrekciós verme + színenkénti HSL-je, a telefonon, projekteken
 * átívelően, offline. Csak paraméter — nem hivatkozik médiára.
 */
const KEY = 'remix.imagelooks.v1';
/** ennyi saját look fér el (a legrégebbi esik ki) */
export const USER_LOOKS_MAX = 40;

interface UserLooksState {
  looks: ImageLook[];
  hydrate: () => Promise<void>;
  add: (look: ImageLook) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const useUserLooks = create<UserLooksState>((set, get) => {
  let loading: Promise<void> | null = null;
  const hydrate = () => {
    loading ??= AsyncStorage.getItem(KEY)
      .then((raw) => {
        const list = raw ? (JSON.parse(raw) as unknown[]) : [];
        set({ looks: Array.isArray(list) ? list.filter(isLook).map((l) => ({ ...l, custom: true })) : [] });
      })
      .catch((caught) => {
        logCaught('store/userLooksStore.ts:hydrate', caught);
      });
    return loading;
  };
  const persist = async (looks: ImageLook[]) => {
    set({ looks });
    await AsyncStorage.setItem(KEY, JSON.stringify(looks)).catch((caught) => {
      logCaught('store/userLooksStore.ts:save', caught);
    });
  };
  return {
    looks: [],
    hydrate,
    add: async (look) => {
      await hydrate();
      await persist([{ ...look, custom: true }, ...get().looks.filter((l) => l.key !== look.key)].slice(0, USER_LOOKS_MAX));
    },
    remove: async (key) => {
      await hydrate();
      await persist(get().looks.filter((l) => l.key !== key));
    },
  };
});
