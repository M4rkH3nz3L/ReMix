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
  /**
   * DEV-override: a `mockUpgrade()` állítja, és a `syncFromUser` TISZTELETBEN
   * tartja — sosem downgrade-el alá. Enélkül a szerver `free` sora azonnal
   * visszaállítaná Free-re a dev-Pro-t (a Pro „nem maradna bekapcsolva").
   * Éles buildben (`__DEV__ === false`) hatástalan.
   */
  devPro?: boolean;
}

/** Egy „fizetés" hossza dev-ben: 1 hónap = 30 nap. */
export const PRO_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** DEV/mock: egy „fizetés" — Pro +30 napra (ismételt hívás hosszabbít). A
   *  lejárati dátumot elmentjük; a syncFromUser tiszteletben tartja (nem
   *  downgrade-el a lejárat előtt). Lokális dev-override. */
  mockUpgrade: () => void;
  /** DEV: vissza Free-re (a dev-override törlése is) */
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
        devPro: p.devPro === true,
      };
    }
  } catch {
    // sérült/hiányzó mentés — Free
  }
  return { tier: 'free', proUntil: null, devPro: false };
}

/** A `proUntil` a jövőben van-e (vagy null = lejárat nélkül). */
function stillValid(proUntil: string | null): boolean {
  if (proUntil == null) {
    return true;
  }
  const until = Date.parse(proUntil);
  return Number.isNaN(until) ? true : until > Date.now();
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  tier: 'free',
  proUntil: null,
  devPro: false,
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
    let cached: Persisted = { tier: 'free', proUntil: null, devPro: false };
    if (userId) {
      cached = await loadCache(userId);
      set({
        userId,
        tier: cached.tier,
        proUntil: cached.proUntil,
        devPro: !!cached.devPro,
        hydrated: true,
      });
    } else {
      set({ userId: null, tier: 'free', proUntil: null, devPro: false, hydrated: true });
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
      const server: Persisted = sub
        ? { tier: sub.tier, proUntil: sub.tier === 'pro' ? sub.proUntil : null }
        : { tier: 'free', proUntil: null };

      // DEV-override: ha aktív és MÉG NEM járt le, ne engedjük a szervernek
      // Free-re downgrade-elni (a dev-Pro maradjon bekapcsolva a lejáratig).
      let next: Persisted = server;
      const devPro = __DEV__ && !!cached.devPro && stillValid(cached.proUntil);
      if (devPro && server.tier !== 'pro') {
        next = { tier: 'pro', proUntil: cached.proUntil ?? null, devPro: true };
      }
      set({ ...next, devPro });
      persist(userId, { ...next, devPro });
    } catch {
      // best-effort; marad az offline cache
    }
  },

  setTier: (tier, proUntil = null) => {
    // valós IAP/szerver-forrás → a dev-override-ot töröljük
    const next: Persisted = { tier, proUntil: tier === 'pro' ? proUntil : null, devPro: false };
    set(next);
    persist(get().userId, next);
  },

  mockUpgrade: () => {
    // egy „fizetés" = +30 nap. Ha még érvényes a Pro, ONNAN hosszabbítunk
    // (megújítás), különben mosttól. A lejáratot elmentjük (devPro override).
    const now = Date.now();
    const current = get().proUntil;
    const base =
      current && Date.parse(current) > now ? Date.parse(current) : now;
    const until = new Date(base + PRO_PERIOD_DAYS * DAY_MS).toISOString();
    const next: Persisted = { tier: 'pro', proUntil: until, devPro: true };
    set(next);
    persist(get().userId, next);
  },

  mockDowngrade: () => {
    const next: Persisted = { tier: 'free', proUntil: null, devPro: false };
    set(next);
    persist(get().userId, next);
  },
}));

/** Nem-reaktív pillanatkép a Pro-állapotról (store-on kívüli logikához, pl.
 *  a backend-router gate-jéhez, ahol nincs React-kontextus). */
export function isProNow(): boolean {
  return useEntitlement.getState().isPro();
}
