import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { capabilityAllowed, type CapabilityId } from '@/lib/capabilities';
import { fetchMySubscription } from '@/lib/subscription';
import { asTier, isPaidTier, tierMeetsMin, tierRank, type Tier } from '@/lib/tiers';

/**
 * 💳 Entitlement-store — a Free / Pro szint EGYETLEN kliens-oldali forrása.
 *
 * A Pro nyitja a fizetős felhő-workereket (AI + felhő-HD render, lásd
 * `@/lib/capabilities`). Az alap, eszközön futó szerkesztés + export MINDIG
 * ingyenes, ez a store csak a felhő-funkciók kapuja.
 *
 * SZERVER-HITELES: a Pro EGYETLEN forrása a Supabase `subscriptions` tábla
 * (dátumos időszakok, `current_period_end`). A kliens itt CSAK szinkronizál és
 * offline-cache-el — self-grant NINCS (a tábla írása service_role-only). A Pro-t
 * a worker `billing` írja: RevenueCat webhook (valós IAP) vagy /billing/activate
 * (dev/promó). Vásárlás/aktiválás után a kliens `syncFromUser`-rel frissít; a
 * `setTier` csak OPTIMISTA azonnali visszajelzés a szerver-válaszból.
 */

export type { Tier };

/** Per-user AsyncStorage-kulcs (v2: a v1 device-szintű volt, ez userenkénti). */
function cacheKey(userId: string | null): string {
  return `remix.entitlement.v2.${userId ?? 'anon'}`;
}

interface Persisted {
  tier: Tier;
  /** ISO dátum, ameddig a Pro érvényes; `null` = lejárat nélkül (promó/örökös) */
  proUntil: string | null;
  /**
   * 🧪 CSAK DEV: kliens-oldali Pro-felülírás a teszthez. A `syncFromUser` NEM
   * írja felül (túléli a szerver-szinkront) — így weben is működik, ahol a
   * kliens a hosztolt prod Supabase-t nézi, a dev-worker viszont a lokálisba ír.
   * Éles útra NEM hat: a `activateProDev`/`setDevPro` a `__DEV__`-hez kötött UI-ból hívódik.
   */
  devPro?: boolean;
}

interface EntitlementState extends Persisted {
  /** kié a betöltött entitlement (null = nincs bejelentkezve) */
  userId: string | null;
  /** lefutott-e már az induló betöltés (guard-döntés előtt kell) */
  hydrated: boolean;
  /** a TÉNYLEGESEN aktív szint (lejárat + dev-override figyelembevételével). A gate-ek
   *  ezt használják a `capability.minTier` ellen (audit §2.1). */
  effectiveTier: () => Tier;
  /** engedélyezett-e a művelet az aktuális szinten (tier-pontos kapu). */
  allows: (cap: CapabilityId) => boolean;
  /** aktív-e most legalább a Pro (szint + lejárat figyelembevételével) — backward-compat. */
  isPro: () => boolean;
  /** app-indításkor egyszer: csak jelzi, hogy készen állunk (a valós szintet a
   *  `syncFromUser` hozza, amint az auth eldőlt) */
  hydrate: () => Promise<void>;
  /** a bejelentkezett user szintjének szinkronja: offline-cache azonnal, majd
   *  a Supabase `subscriptions`. `null` userId → kijelentkezve, vissza Free-re. */
  syncFromUser: (userId: string | null) => Promise<void>;
  /** OPTIMISTA szint-beállítás a szerver-válaszból (vásárlás/aktiválás után) —
   *  a következő `syncFromUser` a hiteles szerver-állapottal megerősíti. */
  setTier: (tier: Tier, proUntil?: string | null) => void;
  /** 🧪 CSAK DEV: a kliens-oldali Pro-override be/ki (a `__DEV__` profil-gombból). */
  setDevPro: (on: boolean) => void;
}

function persist(userId: string | null, p: Persisted): void {
  AsyncStorage.setItem(cacheKey(userId), JSON.stringify(p)).catch(() => {
    // a perzisztálás best-effort; a memóriabeli állapot marad a forrás
  });
}

async function loadCache(userId: string | null): Promise<Persisted> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        tier: asTier(p.tier),
        proUntil: typeof p.proUntil === 'string' ? p.proUntil : null,
        devPro: p.devPro === true,
      };
    }
  } catch {
    // sérült/hiányzó mentés — Free
  }
  return { tier: 'free', proUntil: null, devPro: false };
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  tier: 'free',
  proUntil: null,
  devPro: false,
  userId: null,
  hydrated: false,

  effectiveTier: () => {
    const { tier, proUntil, devPro } = get();
    if (devPro) {
      // 🧪 dev-override: legalább Pro (de egy magasabb valós szintet nem ránt le)
      return tierRank(tier) >= tierRank('pro') ? tier : 'pro';
    }
    if (!isPaidTier(tier)) {
      return 'free';
    }
    if (proUntil == null) {
      return tier; // lejárat nélküli (promó/örökös)
    }
    const until = Date.parse(proUntil);
    if (Number.isNaN(until)) {
      return tier;
    }
    return until > Date.now() ? tier : 'free'; // lejárt → vissza Free-re
  },

  allows: (cap) => capabilityAllowed(cap, get().effectiveTier()),

  isPro: () => tierMeetsMin(get().effectiveTier(), 'pro'),

  hydrate: async () => {
    // A valós szintet a syncFromUser hozza, amint az auth-store eldöntötte, ki
    // van bejelentkezve. Itt csak jelezzük, hogy a store készen áll.
    set({ hydrated: true });
  },

  syncFromUser: async (userId) => {
    // 1) offline-first: a user cache-ét azonnal betöltjük (kijelentkezve Free)
    if (userId) {
      const cached = await loadCache(userId);
      set({
        userId,
        tier: cached.tier,
        proUntil: cached.proUntil,
        devPro: cached.devPro === true,
        hydrated: true,
      });
    } else {
      set({ userId: null, tier: 'free', proUntil: null, devPro: false, hydrated: true });
      return;
    }
    // 2) hiteles forrás: Supabase subscriptions. Sikernél felülírjuk +
    //    perzisztáljuk; hibánál (offline) marad az imént betöltött cache.
    try {
      const sub = await fetchMySubscription(userId);
      // közben fiókot válthattak — csak akkor írjunk, ha még ez a user aktív
      if (get().userId !== userId) {
        return;
      }
      // 🧪 a dev-override-ot a szerver-állapot NEM kapcsolja ki (túléli a szinkront)
      const devPro = get().devPro === true;
      const next: Persisted = sub
        ? { tier: sub.tier, proUntil: isPaidTier(sub.tier) ? sub.proUntil : null, devPro }
        : { tier: 'free', proUntil: null, devPro };
      set(next);
      persist(userId, next);
    } catch {
      // best-effort; marad az offline cache
    }
  },

  setTier: (tier, proUntil = null) => {
    const next: Persisted = {
      tier,
      proUntil: isPaidTier(tier) ? proUntil : null,
      devPro: get().devPro === true,
    };
    set(next);
    persist(get().userId, next);
  },

  setDevPro: (on) => {
    const { tier, proUntil } = get();
    const next: Persisted = { tier, proUntil, devPro: on };
    set(next);
    persist(get().userId, next);
  },
}));

/** Nem-reaktív pillanatkép a Pro-állapotról (store-on kívüli logikához, pl.
 *  a backend-router gate-jéhez, ahol nincs React-kontextus). */
export function isProNow(): boolean {
  return useEntitlement.getState().isPro();
}
