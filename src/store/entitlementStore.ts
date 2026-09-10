import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * 💳 Entitlement-store — a Free / Pro szint EGYETLEN forrása.
 *
 * A Pro nyitja a fizetős felhő-workereket (AI + felhő-HD render, lásd
 * `@/lib/capabilities`). Az alap, eszközön futó szerkesztés + export MINDIG
 * ingyenes, ez a store csak a felhő-funkciók kapuja.
 *
 * A valós vásárlás (App Store / Play IAP) egy natív IAP-réteg lesz az EAS
 * buildben (pl. RevenueCat) — az a `setTier('pro', proUntil)`-t hívja a
 * sikeres tranzakció után. Addig a `mockUpgrade()` dev-kapcsoló teszteléshez.
 * A perzisztálás AsyncStorage-ban (mint a brandStore), hogy újraindítás után
 * is megmaradjon a szint.
 */

export type Tier = 'free' | 'pro';

const KEY = 'remix.entitlement.v1';

interface Persisted {
  tier: Tier;
  /** ISO dátum, ameddig a Pro érvényes; `null` = lejárat nélkül (dev/örökös) */
  proUntil: string | null;
}

interface EntitlementState extends Persisted {
  /** betöltötte-e már a store a mentett állapotot (hydration) */
  hydrated: boolean;
  /** aktív-e most a Pro (szint + lejárat figyelembevételével) */
  isPro: () => boolean;
  /** AsyncStorage → store (app-indításkor, egyszer) */
  hydrate: () => Promise<void>;
  /** szint beállítása (valós IAP siker után hívja a natív réteg) */
  setTier: (tier: Tier, proUntil?: string | null) => void;
  /** DEV/mock: azonnali Pro lejárat nélkül — teszteléshez */
  mockUpgrade: () => void;
  /** DEV: vissza Free-re */
  mockDowngrade: () => void;
}

function persist(p: Persisted): void {
  AsyncStorage.setItem(KEY, JSON.stringify(p)).catch(() => {
    // a perzisztálás best-effort; a memóriabeli állapot marad a forrás
  });
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  tier: 'free',
  proUntil: null,
  hydrated: false,

  isPro: () => {
    const { tier, proUntil } = get();
    if (tier !== 'pro') {
      return false;
    }
    if (proUntil == null) {
      return true; // lejárat nélküli (dev/örökös)
    }
    const until = Date.parse(proUntil);
    return Number.isNaN(until) ? true : until > Date.now();
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        set({
          tier: p.tier === 'pro' ? 'pro' : 'free',
          proUntil: typeof p.proUntil === 'string' ? p.proUntil : null,
          hydrated: true,
        });
        return;
      }
    } catch {
      // sérült/hiányzó mentés — Free marad
    }
    set({ hydrated: true });
  },

  setTier: (tier, proUntil = null) => {
    const next: Persisted = { tier, proUntil: tier === 'pro' ? proUntil : null };
    set(next);
    persist(next);
  },

  mockUpgrade: () => {
    const next: Persisted = { tier: 'pro', proUntil: null };
    set(next);
    persist(next);
  },

  mockDowngrade: () => {
    const next: Persisted = { tier: 'free', proUntil: null };
    set(next);
    persist(next);
  },
}));

/** Nem-reaktív pillanatkép a Pro-állapotról (store-on kívüli logikához, pl.
 *  a backend-router gate-jéhez, ahol nincs React-kontextus). */
export function isProNow(): boolean {
  return useEntitlement.getState().isPro();
}
