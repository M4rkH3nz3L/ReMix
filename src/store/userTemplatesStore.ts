import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { ImageTemplate } from '@/lib/imageTemplates';
import { logCaught } from '@/lib/logCaught';

/**
 * 🧩 Saját kép-sablonok (IMAGE-PROD S9 · DS1 „Mentés sablonként”): a telefonon, projekteken
 * átívelően, offline. A sablon csak rétegeket tartalmaz (a fotók helyőrzővé válnak), így nem
 * hivatkozik törölhető médiára.
 */
const KEY = 'remix.imagetemplates.v1';
/** ennyi saját sablon fér el (a legrégebbi esik ki) */
export const USER_TEMPLATES_MAX = 60;

function isTemplate(x: unknown): x is ImageTemplate {
  const t = x as ImageTemplate;
  return !!t && typeof t.key === 'string' && typeof t.width === 'number' && typeof t.height === 'number' && Array.isArray(t.layers);
}

interface UserTemplatesState {
  templates: ImageTemplate[];
  hydrate: () => Promise<void>;
  add: (tpl: ImageTemplate) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const useUserTemplates = create<UserTemplatesState>((set, get) => {
  let loading: Promise<void> | null = null;
  const hydrate = () => {
    loading ??= AsyncStorage.getItem(KEY)
      .then((raw) => {
        const list = raw ? (JSON.parse(raw) as unknown[]) : [];
        set({ templates: Array.isArray(list) ? list.filter(isTemplate).map((t) => ({ ...t, custom: true })) : [] });
      })
      .catch((caught) => {
        logCaught('store/userTemplatesStore.ts:hydrate', caught);
      });
    return loading;
  };
  const persist = async (templates: ImageTemplate[]) => {
    set({ templates });
    await AsyncStorage.setItem(KEY, JSON.stringify(templates)).catch((caught) => {
      logCaught('store/userTemplatesStore.ts:save', caught);
    });
  };
  return {
    templates: [],
    hydrate,
    add: async (tpl) => {
      await hydrate();
      await persist([{ ...tpl, custom: true }, ...get().templates.filter((t) => t.key !== tpl.key)].slice(0, USER_TEMPLATES_MAX));
    },
    remove: async (key) => {
      await hydrate();
      await persist(get().templates.filter((t) => t.key !== key));
    },
  };
});
