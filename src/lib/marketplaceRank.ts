/**
 * 🛍️ Marketplace-ranking (audit §4.6) — tiszta, expo-mentes.
 *
 * A shop/template-piac listázása ma letöltés/dátum szerint megy; ez egy valódi,
 * jel-alapú rangsoroló: letöltés-SEBESSÉG (nem össz-letöltés) × BAYESIÁNUS rating
 * (a kevés-szavazatú tétel ne verje a sok-review-sat) × frissesség. A
 * [feedRanking](./feedRanking.ts) engagement-alapú; ez a shop-sajátos (downloads +
 * rating + kor). Determinisztikus (`now` paraméter), önmagában tesztelhető.
 */

export interface ListingStats {
  id: string;
  /** összes letöltés/vásárlás */
  downloads: number;
  /** átlagos csillag 0–5 */
  rating: number;
  /** hány értékelésből (a bayesiánus súlyozáshoz) */
  ratingCount: number;
  /** a tétel kora órában */
  ageHours: number;
}

export interface MarketWeights {
  /** a bayesiánus prior globális átlaga (0–5) */
  priorMean: number;
  /** a prior súlya „virtuális szavazatokban" (mennyi review kell, hogy a saját rating domináljon) */
  priorWeight: number;
  /** a letöltés-sebesség nevezőjének óra-eltolása (friss tétel se osszon ~0-val) */
  offsetDays: number;
}

export const DEFAULT_MARKET_WEIGHTS: MarketWeights = { priorMean: 4, priorWeight: 10, offsetDays: 1 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bayesiánus (súlyozott) átlag-rating: a kevés-szavazatú tételt a globális átlag
 * (`priorMean`) felé húzza, így egy 5★/1-review nem ver egy 4.8★/1000-review-t.
 */
export function bayesianRating(
  rating: number,
  count: number,
  priorMean = DEFAULT_MARKET_WEIGHTS.priorMean,
  priorWeight = DEFAULT_MARKET_WEIGHTS.priorWeight,
): number {
  const c = Math.max(0, count || 0);
  const r = clamp(rating || 0, 0, 5);
  return (priorWeight * priorMean + c * r) / (priorWeight + c);
}

/**
 * Egy listázás rangsor-pontszáma: letöltés/nap × minőség-szorzó (a bayesiánus
 * rating 0–1-re normálva, de sosem 0-ra → a rating nélküli új tétel is látszik).
 */
export function marketplaceScore(s: ListingStats, now = 0, w: MarketWeights = DEFAULT_MARKET_WEIGHTS): number {
  void now; // a kor már `ageHours`-ban jön (determinisztikus); a `now` csak a szimmetriáért
  const ageDays = Math.max(0, (s.ageHours || 0) / 24);
  const velocity = Math.max(0, s.downloads || 0) / (ageDays + Math.max(0.0001, w.offsetDays));
  const quality = bayesianRating(s.rating, s.ratingCount, w.priorMean, w.priorWeight) / 5;
  return velocity * (0.5 + 0.5 * quality);
}

/** Listázások csökkenő rangsor-pontszám szerint (stabil: döntetlennél az eredeti sorrend). */
export function rankListings<T extends ListingStats>(listings: T[], w: MarketWeights = DEFAULT_MARKET_WEIGHTS): T[] {
  return listings
    .map((item, i) => ({ item, i, score: marketplaceScore(item, 0, w) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}
