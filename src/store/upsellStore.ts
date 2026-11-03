import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import {
  decideUpsell,
  markDismissed,
  markShown,
  type UpsellState,
  type UpsellSurface,
  type UpsellTrigger,
} from '@/lib/upsell';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';

/**
 * 💡 Az ösztönzés állapota (PRO-CASH 4.4, C2.3). A döntés a tiszta `@/lib/upsell` motoré; ez a
 * store csak tárolja (a 72 órás csend túléli az app újraindítását, a munkamenet-számláló nem).
 */
const KEY = 'remix.upsell.v1';

interface UpsellStore extends UpsellState {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  dismiss: () => void;
}

export const useUpsell = create<UpsellStore>((set, get) => ({
  // minden appindítás új munkamenet
  sessionId: makeId('ses'),
  sessionShown: 0,
  dismissedAt: null,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const p = raw ? (JSON.parse(raw) as { dismissedAt?: number | null }) : {};
      set({ dismissedAt: typeof p.dismissedAt === 'number' ? p.dismissedAt : null, hydrated: true });
    } catch (caught) {
      logCaught('store/upsellStore.ts:hydrate', caught);
      set({ hydrated: true });
    }
  },
  dismiss: () => {
    const next = markDismissed(get(), Date.now());
    set({ dismissedAt: next.dismissedAt });
    AsyncStorage.setItem(KEY, JSON.stringify({ dismissedAt: next.dismissedAt })).catch((caught) => {
      logCaught('store/upsellStore.ts:dismiss', caught);
    });
  },
}));

/**
 * Egy ösztönző pillanat: ha a motor engedi (Free, nem szerkesztő-felület, munkamenet-keret,
 * 72 órás csend), megnyitja a paywallt az ajánlott szinttel. Visszaadja, megjelent-e.
 */
export async function nudgeUpsell(trigger: UpsellTrigger, surface: UpsellSurface): Promise<boolean> {
  const store = useUpsell.getState();
  if (!store.hydrated) {
    await store.hydrate();
  }
  const state = useUpsell.getState();
  const decision = decideUpsell(trigger, { tier: useEntitlement.getState().effectiveTier(), surface, nowMs: Date.now() }, state);
  if (!decision.show) {
    return false;
  }
  useUpsell.setState(markShown(state));
  usePaywall.getState().openOffer(decision.offer);
  return true;
}
