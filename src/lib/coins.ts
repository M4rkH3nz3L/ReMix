import type { Tier } from '@/lib/tiers';

/**
 * 🪙 Coin-gazdaság — tiszta, expo-mentes mag (PRO-CASH 2. fejezet).
 *
 * A főkönyv egész **cent-Coinban** számol (1 Coin = 100 cent-Coin); a felület két
 * tizedessel mutatja. A pénzmozgás SZERVER-HITELES (a `coin_debit` / `coin_credit` DB-
 * függvények); ez a modul a kliens előnézetéhez és kijelzéséhez ugyanazt a szabályt
 * mondja ki, amit a DB. A kettőt a `contract.test.ts` zárolja (díjak, árak, minimum).
 *
 * Három alegyenleg (PRO-CASH 2.2): vásárolt (nem váltható), bónusz (nem váltható, lejár),
 * megkeresett (függő 30 napig, utána beváltható). Költési sorrend: bónusz → vásárolt →
 * beváltható → függő.
 */

export const CENTS_PER_COIN = 100;
/** 1 Coin vételára euróban: web (Stripe) és áruház (Apple/Google jutalék miatt magasabb). */
export const COIN_PRICE_EUR_WEB = 5;
export const COIN_PRICE_EUR_STORE = 5.99;
/** 1 MEGKERESETT Coin beváltási értéke euróban. */
export const COIN_PAYOUT_EUR = 3;
/** Kifizetési minimum (20 Coin) és tartás (30 nap). */
export const MIN_PAYOUT_CENTS = 2000;
export const EARNED_HOLD_DAYS = 30;
/** A bolti tétel minimális ára (0,20 Coin), ha nem ingyenes. */
export const MIN_SHOP_PRICE_CENTS = 20;

/** Havidíj cent-Coinban, Vállalatinál fejenként (PRO-CASH 3.1). A DB `tier_price_cents` tükre. */
export const TIER_PRICE_CENTS: Record<Tier, number> = {
  free: 0,
  basic: 200,
  pro: 400,
  ultra: 800,
  business: 1000,
};
/** Éves fizetésnél ennyi havi díjat számlázunk 12 hónapért (2 hónap ajándék). */
export const ANNUAL_BILLED_MONTHS = 10;

/** A platform díja százalékban (bolt 70/30, ajándék 80/20 — D3). A DB `coin_fee_pct` tükre. */
export const FEE_PCT = { sale: 30, gift: 20 } as const;
export type FeeKind = keyof typeof FEE_PCT;

/** Coin-csomagok (PRO-CASH 2.1); a bónusz a bónusz-alegyenlegre kerül. */
export interface CoinPack {
  id: string;
  coins: number;
  bonusCoins: number;
  priceEurWeb: number;
  priceEurStore: number;
}
export const COIN_PACKS: readonly CoinPack[] = [
  { id: 'coins_1', coins: 1, bonusCoins: 0, priceEurWeb: 5, priceEurStore: 5.99 },
  { id: 'coins_5', coins: 5, bonusCoins: 0, priceEurWeb: 25, priceEurStore: 29.99 },
  { id: 'coins_10', coins: 10, bonusCoins: 0.5, priceEurWeb: 50, priceEurStore: 59.99 },
  { id: 'coins_25', coins: 25, bonusCoins: 2, priceEurWeb: 125, priceEurStore: 149.99 },
  { id: 'coins_50', coins: 50, bonusCoins: 5, priceEurWeb: 250, priceEurStore: 299.99 },
];

export function coinPack(id: string): CoinPack | null {
  return COIN_PACKS.find((p) => p.id === id) ?? null;
}

/** Az alkotó része: ár − floor(ár × díj%) — a platform a lefelé kerekített díjat kapja. */
export function creatorShare(priceCents: number, kind: FeeKind): number {
  const p = Math.max(0, Math.trunc(priceCents));
  return p - Math.floor((p * FEE_PCT[kind]) / 100);
}

/** Az előfizetés ára cent-Coinban (havi vagy éves; Vállalatinál × ülésszám, min. 2). */
export function subscriptionCostCents(tier: Tier, months: 1 | 12, seats = 1): number {
  const n = tier === 'business' ? Math.max(2, Math.trunc(seats) || 2) : 1;
  return TIER_PRICE_CENTS[tier] * n * (months === 12 ? ANNUAL_BILLED_MONTHS : 1);
}

/** A beváltás euró-értéke (cent-Coin → €). */
export function payoutEur(cents: number): number {
  return (Math.max(0, Math.trunc(cents)) * COIN_PAYOUT_EUR) / CENTS_PER_COIN;
}

/** cent-Coin → Coin (szám). */
export function centsToCoins(cents: number): number {
  return Math.trunc(cents) / CENTS_PER_COIN;
}

/** Coin (felhasználói bevitel, tizedessel is) → cent-Coin; érvénytelenre 0. */
export function coinsToCents(coins: number | string): number {
  const n = typeof coins === 'string' ? Number(coins.replace(',', '.')) : coins;
  return Number.isFinite(n) && n > 0 ? Math.round(n * CENTS_PER_COIN) : 0;
}

/** Kijelzés: „0,40”, „12”, „1 250,50” (magyar tizedesvessző, egész Coinnál tizedes nélkül). */
export function formatCoins(cents: number): string {
  const c = Math.trunc(cents);
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / CENTS_PER_COIN)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = abs % CENTS_PER_COIN;
  return `${neg ? '−' : ''}${whole}${frac ? `,${String(frac).padStart(2, '0')}` : ''}`;
}

/** Euró kijelzése két tizedessel, magyar formában („432,00 €”). */
export function formatEur(eur: number): string {
  return `${eur.toFixed(2).replace('.', ',')} €`;
}

/** A pénztárca bontása (a DB `my_wallet()` válasza), cent-Coinban. */
export interface WalletBreakdown {
  purchased: number;
  bonus: number;
  earnedPending: number;
  earnedAvailable: number;
  balance: number;
  nextReleaseAt: string | null;
}

export const EMPTY_WALLET: WalletBreakdown = {
  purchased: 0,
  bonus: 0,
  earnedPending: 0,
  earnedAvailable: 0,
  balance: 0,
  nextReleaseAt: null,
};

/** A `my_wallet()` jsonb-válaszának normalizálása (hiányzó mező → 0). */
export function parseWallet(raw: unknown): WalletBreakdown {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
  return {
    purchased: n(r.purchased),
    bonus: n(r.bonus),
    earnedPending: n(r.earned_pending),
    earnedAvailable: n(r.earned_available),
    balance: n(r.balance),
    nextReleaseAt: typeof r.next_release_at === 'string' ? r.next_release_at : null,
  };
}

/** Egy terhelés bontása alegyenlegenként — a DB `coin_debit` költési sorrendjének tükre. */
export interface SpendPlan {
  bonus: number;
  purchased: number;
  earnedAvailable: number;
  earnedPending: number;
}

/** Mennyi menne le melyik alegyenlegről; kevés egyenlegre `null` (a DB `insufficient_credits`). */
export function spendPlan(w: WalletBreakdown, cents: number): SpendPlan | null {
  let left = Math.max(0, Math.trunc(cents));
  const take = (have: number) => {
    const x = Math.min(left, Math.max(0, have));
    left -= x;
    return x;
  };
  const plan = {
    bonus: take(w.bonus),
    purchased: take(w.purchased),
    earnedAvailable: take(w.earnedAvailable),
    earnedPending: take(w.earnedPending),
  };
  return left > 0 ? null : plan;
}

/** Kérhető-e most kifizetés (csak a beváltható megkeresett Coinból, min. 20 Coin). */
export function canRequestPayout(w: WalletBreakdown, cents: number): boolean {
  return cents >= MIN_PAYOUT_CENTS && cents <= w.earnedAvailable;
}
