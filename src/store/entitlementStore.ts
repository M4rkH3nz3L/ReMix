import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { fetchMySubscription } from '@/lib/subscription';

/**
 * 💳 Entitlement-store — a Free / Pro szint EGYETLEN kliens-oldali forrása.
 *
 * A Pro nyitja a fizetős felhő-workereket (AI + felhő-HD render, lásd
 * `@/lib/capabilities`). Az alap, eszközön futó szerkesztés + export MINDIG
 * ingyenes, ez a store csak a felhő-funkciók kapuja.
 *
 * A Pro **userenként** él: a hiteles forrás a Supabase `subscriptions` tábla
 * (`@/lib/subscription`), amit bejelentkezéskor a `syncFromUser()` szinkronizál
 * (az auth-store hívja). A lokális AsyncStorage csak **offline gyorsítótár**,
 * userenként külön kulcson — így fiókváltásnál nem szivárog a Pro.
 *
 * A valós vásárlás (App Store / Play IAP, pl. RevenueCat) egy későbbi fázis: az
 * a Supabase-sort írja (webhook), a kliens onnan szinkronizál. Dev-hez a
 * `mockUpgrade()` lokális override (a következő sikeres szinkron felülírja).
 */

export type Tier = 'free' | 'pro';

/** Per-user AsyncStorage-kulcs (v2: a v1 device-szintű volt, ez userenkénti). */
function cacheKey(userId: string | null): string {
  return `remix.entitlement.v2.${userId ?? 'anon'}`;
}

interface Persisted {
  tier: Tier;
  /** ISO dátum, ameddig a Pro érvényes; `null` = lejárat nélkül (dev/örökös) */
  proUntil: string | null;
}

interface EntitlementState extends Persisted {
  /** kié a betöltött entitlement (null = nincs bejelentkezve) */
  userId: string | null;
  /** lefutott-e már az induló betöltés (guard-döntés előtt kell) */
  hydrated: boolean;
  /** aktív-e most a Pro (szint + lejárat figyelembevételével) */
  isPro: () => boolean;
  /** app-indításkor egyszer: csak jelzi, hogy készen állunk (a valós szintet a
   *  `syncFromUser` hozza, amint az auth eldőlt) */
  hydrate: () => Promise<void>;
  /** a bejelentkezett user szintjének szinkronja: offline-cache azonnal, majd
   *  Supabase-forrás. `null` userId → kijelentkezve, vissza Free-re. */
  syncFromUser: (userId: string | null) => Promise<void>;
  /** szint beállítása (valós IAP siker / szerver-szinkron után) */
  setTier: (tier: Tier, proUntil?: string | null) => void;
  /** DEV/mock: azonnali Pro lejárat nélkül — teszteléshez (lokális override) */
  mockUpgrade: () => void;
  /** DEV: vissza Free-re */
  mockDowngrade: () => void;
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
        tier: p.tier === 'pro' ? 'pro' : 'free',
        proUntil: typeof p.proUntil === 'string' ? p.proUntil : null,
      };
    }
  } catch {
    // sérült/hiányzó mentés — Free
  }
  return { tier: 'free', proUntil: null };
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  tier: 'free',
  proUntil: null,
  userId: null,
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
    // A valós szintet a syncFromUser hozza, amint az auth-store eldöntötte, ki
    // van bejelentkezve. Itt csak jelezzük, hogy a store készen áll.
    set({ hydrated: true });
  },

  syncFromUser: async (userId) => {
    // 1) offline-first: a user cache-ét azonnal betöltjük (kijelentkezve Free)
    if (userId) {
      const cached = await loadCache(userId);
      set({ userId, tier: cached.tier, proUntil: cached.proUntil, hydrated: true });
    } else {
      set({ userId: null, tier: 'free', proUntil: null, hydrated: true });
      return;
    }
    // 2) hiteles forrás: Supabase. Sikernél felülírjuk + perzisztáljuk; hibánál
    //    (offline) marad az imént betöltött cache.
    try {
      const sub = await fetchMySubscription(userId);
      // közben fiókot válthattak — csak akkor írjunk, ha még ez a user aktív
      if (get().userId !== userId) {
        return;
      }
      if (sub) {
        const next: Persisted = {
          tier: sub.tier,
          proUntil: sub.tier === 'pro' ? sub.proUntil : null,
        };
        set(next);
        persist(userId, next);
      } else {
        // nincs sor a szerveren → Free (és ezt cache-eljük is)
        const next: Persisted = { tier: 'free', proUntil: null };
        set(next);
        persist(userId, next);
      }
    } catch {
      // best-effort; marad az offline cache
    }
  },

  setTier: (tier, proUntil = null) => {
    const next: Persisted = { tier, proUntil: tier === 'pro' ? proUntil : null };
    set(next);
    persist(get().userId, next);
  },

  mockUpgrade: () => {
    const next: Persisted = { tier: 'pro', proUntil: null };
    set(next);
    persist(get().userId, next);
  },

  mockDowngrade: () => {
    const next: Persisted = { tier: 'free', proUntil: null };
    set(next);
    persist(get().userId, next);
  },
}));

/** Nem-reaktív pillanatkép a Pro-állapotról (store-on kívüli logikához, pl.
 *  a backend-router gate-jéhez, ahol nincs React-kontextus). */
export function isProNow(): boolean {
  return useEntitlement.getState().isPro();
}
