/**
 * 💠 Előfizetési szintek (tier-modell) — EGY hely, ami kimondja a szintek SORRENDJÉT.
 *
 * Az audit (§2.1) fő fókusza: a kapuzás NE `if pro` legyen, hanem `capability.minTier`
 * — `Free → Basic → Pro → Ultra`. Ez a modul a **tiszta, expo-mentes mag** (a
 * [capabilities.ts](./capabilities.ts) ad minTier-t a műveleteknek, az
 * [entitlementStore](../store/entitlementStore.ts) tartja a user aktuális szintjét).
 *
 * Backward-compat: a mai rendszer `free`/`pro`-t használ; a `basic`/`ultra` a modellben
 * már létezik (a gate-logika kész rájuk), csak a billing/IAP-termékek bekötése hátravan
 * (audit §2.4). A `tierMeetsMin` rangsor szerint dönt, így egy `ultra` user minden
 * `pro`/`basic`/`free` képességet is megkap.
 */

export type Tier = 'free' | 'basic' | 'pro' | 'ultra';

/** A szintek növekvő sorrendben (a rang = az index). */
export const TIER_ORDER: readonly Tier[] = ['free', 'basic', 'pro', 'ultra'] as const;

/** A szint rangja (0 = free … 3 = ultra). Ismeretlen értékre free-rang (0). */
export function tierRank(tier: Tier): number {
  const i = TIER_ORDER.indexOf(tier);
  return i < 0 ? 0 : i;
}

/** Eléri-e a `userTier` legalább a `minTier`-t (rangsor szerint). */
export function tierMeetsMin(userTier: Tier, minTier: Tier): boolean {
  return tierRank(userTier) >= tierRank(minTier);
}

/** Fizetős szint-e (bármi a free fölött). */
export function isPaidTier(tier: Tier): boolean {
  return tierRank(tier) > 0;
}

/** i18n-kulcs a szint megjelenítéséhez (a fordítás a hívónál `t(...)`-tal). */
export function tierLabelKey(tier: Tier): string {
  return `lib.tiers.label.${tier}`;
}

/** Normalizálás ismeretlen/hibás bemenetről a legközelebbi érvényes tierre. */
export function asTier(value: unknown): Tier {
  return typeof value === 'string' && (TIER_ORDER as readonly string[]).includes(value)
    ? (value as Tier)
    : 'free';
}
