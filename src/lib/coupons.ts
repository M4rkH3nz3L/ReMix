import { tierMeetsMin, type Tier } from '@/lib/tiers';

/**
 * 🎟️ Promó/kupon-kódok (audit §2.9) — tiszta, expo-mentes mag.
 *
 * A validáció (kód-normalizálás, érvényesség, beváltás-limit, min-tier) + a
 * kedvezmény-/jutalom-számítás HITELES logikája, amit a kliens (azonnali
 * visszajelzés) és a worker (beváltáskor, atomikusan) is használ. A kód-tárolás
 * + az atomikus beváltás (usage-count növelés + grant) a server (`coupons` tábla +
 * RPC) — ez a modul a determinisztikus, tesztelt számítás.
 */

export type CouponKind = 'percent' | 'amount' | 'credits' | 'proDays';

export interface Coupon {
  code: string;
  kind: CouponKind;
  /** percent: 0–100 · amount: pénz/coin · credits: coin-szám · proDays: napok */
  value: number;
  /** ISO — ettől érvényes (hiányzó = azonnal) */
  startsAt?: string;
  /** ISO — eddig érvényes (hiányzó = lejárat nélkül) */
  expiresAt?: string;
  /** az ÖSSZES beváltás plafonja (hiányzó = korlátlan) */
  maxRedemptions?: number;
  /** csak ettől a szinttől váltható be (hiányzó = bárki) */
  minTier?: Tier;
  /** hiányzó/true = aktív; false = letiltva */
  enabled?: boolean;
}

export interface RedeemContext {
  now: Date;
  /** eddigi beváltások száma (a maxRedemptions-höz) */
  redemptions?: number;
  /** a beváltó aktuális szintje (a minTier-hez) */
  userTier?: Tier;
}

export type CouponStatus = 'valid' | 'disabled' | 'notStarted' | 'expired' | 'exhausted' | 'tierLocked';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Kód normalizálása az összehasonlításhoz: trim + nagybetű + belső szóköz el. */
export function normalizeCode(input: string): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** A kupon állapota az adott kontextusban (az első blokkoló okot adja vissza). */
export function couponStatus(c: Coupon, ctx: RedeemContext): CouponStatus {
  if (c.enabled === false) {
    return 'disabled';
  }
  const t = ctx.now.getTime();
  if (c.startsAt) {
    const s = Date.parse(c.startsAt);
    if (!Number.isNaN(s) && t < s) {
      return 'notStarted';
    }
  }
  if (c.expiresAt) {
    const e = Date.parse(c.expiresAt);
    if (!Number.isNaN(e) && t > e) {
      return 'expired';
    }
  }
  if (c.maxRedemptions != null && (ctx.redemptions ?? 0) >= c.maxRedemptions) {
    return 'exhausted';
  }
  if (c.minTier && !tierMeetsMin(ctx.userTier ?? 'free', c.minTier)) {
    return 'tierLocked';
  }
  return 'valid';
}

export function isRedeemable(c: Coupon, ctx: RedeemContext): boolean {
  return couponStatus(c, ctx) === 'valid';
}

/**
 * Kedvezményes ár (percent/amount kuponokhoz). A credits/proDays NEM ár-kupon →
 * az árat nem módosítja. Az eredmény sosem negatív.
 */
export function applyDiscount(c: Coupon, price: number): number {
  if (price <= 0) {
    return 0;
  }
  if (c.kind === 'percent') {
    return round2(price * (1 - clamp(c.value, 0, 100) / 100));
  }
  if (c.kind === 'amount') {
    return Math.max(0, round2(price - Math.max(0, c.value)));
  }
  return round2(price); // credits / proDays — ár változatlan
}

/** A megspórolt összeg a `price`-hoz képest. */
export function discountAmount(c: Coupon, price: number): number {
  return round2(Math.max(0, price - applyDiscount(c, price)));
}

export interface CouponReward {
  credits: number;
  proDays: number;
}

/** A kupon jutalma (credits/proDays típusnál), különben nulla. */
export function couponReward(c: Coupon): CouponReward {
  return {
    credits: c.kind === 'credits' ? Math.max(0, Math.floor(c.value)) : 0,
    proDays: c.kind === 'proDays' ? Math.max(0, Math.floor(c.value)) : 0,
  };
}
