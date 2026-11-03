import { create } from 'zustand';

import { isProRequiredError } from '@/lib/backend';
import type { CapabilityId } from '@/lib/capabilities';
import type { UpsellOffer } from '@/lib/upsell';
import { logCaught } from '@/lib/logCaught';

/**
 * 🔒 Paywall-store — bárhonnan megnyitható Pro-ajánlat.
 *
 * A felhő-hívások `ProRequiredError`-t dobnak, ha nincs Pro; a UI ezt elkapja
 * és `openPaywall(err.capability)`-vel felhozza az ajánlatot. Egyetlen
 * `<PaywallSheet />` (a szerkesztő gyökerében) figyeli ezt az állapotot.
 */

interface PaywallState {
  visible: boolean;
  /** melyik funkció váltotta ki (a fejléchez) */
  capability: CapabilityId | null;
  /** ösztönző pillanatból nyílt (C2.3): az ajánlott szint és az üzenet */
  offer: UpsellOffer | null;
  open: (capability?: CapabilityId) => void;
  openOffer: (offer: UpsellOffer) => void;
  close: () => void;
}

export const usePaywall = create<PaywallState>((set) => ({
  visible: false,
  capability: null,
  offer: null,
  open: (capability) => set({ visible: true, capability: capability ?? null, offer: null }),
  openOffer: (offer) => set({ visible: true, capability: null, offer }),
  close: () => set({ visible: false }),
}));

/**
 * Egy felhő-műveletet futtat, és ha az Pro-hiányra bukik, MEGNYITJA a paywallt
 * (nem dob tovább). Minden más hibát visszaad a hívónak (`onError`).
 * A UI így egy sorral kezeli a Pro-gate-et:
 *
 *   guardPro(() => importYouTubeMedia(url, 'video'), (e) => Alert.alert('Hiba', e.message));
 */
export async function guardPro<T>(
  fn: () => Promise<T>,
  onError?: (err: Error) => void
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logCaught('store/paywallStore.ts:guardPro', err);
    if (isProRequiredError(err)) {
      usePaywall.getState().open(err.capability);
      return undefined;
    }
    onError?.(err as Error);
    return undefined;
  }
}
