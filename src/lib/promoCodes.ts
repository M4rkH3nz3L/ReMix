/**
 * 🎟️ Promo / kupon / creator-kód — PURE beváltás-logika (Monetization §06.4/§06.5).
 *
 * A bevett kliens-referencia / szerver-enforce minta: EZ a modul a kliens-oldali
 * UX-előnézet (azonnal mutatja: érvénytelen / lejárt / kimerült, mielőtt hálózatot
 * hívnánk), a HITELES beváltás a `redeem_promo` security-definer RPC-n megy (a kliens
 * sosem ad magának kedvezményt). A két oldal ugyanazt a szabályt mondja ki — a döntés
 * itt tiszta függvény, így unit-tesztelt, és a kedvezmény FÜGGETLEN az 5/3 koin-aránytól
 * és a 30% Marketplace-fee-től (külön `kind:'promo'` főkönyvi ág).
 */

export type PromoKind = 'percent' | 'credit' | 'proDays';

export interface PromoCode {
  code: string;
  kind: PromoKind;
  /** percent: 1–100 (%) · credit: jóváírt coin · proDays: Pro-napok */
  value: number;
  /** ISO időbélyeg vagy null (nincs lejárat) */
  expiresAt?: string | null;
  /** globális beváltás-plafon (null = korlátlan) */
  maxRedemptions?: number | null;
  /** per-user plafon (alap 1) */
  perUserLimit?: number | null;
  active?: boolean;
  campaignId?: string | null;
  creatorId?: string | null;
}

export type RedeemReason =
  | 'ok'
  | 'invalid'
  | 'inactive'
  | 'expired'
  | 'limit_reached'
  | 'per_user_limit_reached';

export interface RedeemContext {
  nowMs: number;
  /** ahányszor EZ a user már beváltotta ezt a kódot */
  userRedemptions: number;
  /** ahányszor BÁRKI beváltotta ezt a kódot (globális) */
  globalRedemptions: number;
}

/** Kód-normalizálás: trim + nagybetű (a beváltás case-insensitive). */
export function normalizePromoCode(raw: string): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** Lejárt-e a kód a megadott időben? (nincs expiry → sosem jár le) */
export function isExpired(code: Pick<PromoCode, 'expiresAt'>, nowMs: number): boolean {
  if (!code.expiresAt) {
    return false;
  }
  const t = Date.parse(code.expiresAt);
  return Number.isFinite(t) && nowMs >= t;
}

/**
 * A beváltás determinisztikus döntése (UX-előnézet ÉS a szerver-enforce spec-je).
 * A sorrend számít: aktív → lejárat → globális limit → per-user limit.
 */
export function redemptionDecision(
  code: PromoCode | null | undefined,
  ctx: RedeemContext
): { ok: boolean; reason: RedeemReason } {
  if (!code || !code.code || !code.kind) {
    return { ok: false, reason: 'invalid' };
  }
  if (code.active === false) {
    return { ok: false, reason: 'inactive' };
  }
  if (isExpired(code, ctx.nowMs)) {
    return { ok: false, reason: 'expired' };
  }
  const globalMax = code.maxRedemptions;
  if (typeof globalMax === 'number' && globalMax >= 0 && ctx.globalRedemptions >= globalMax) {
    return { ok: false, reason: 'limit_reached' };
  }
  const perUser = typeof code.perUserLimit === 'number' && code.perUserLimit >= 0 ? code.perUserLimit : 1;
  if (ctx.userRedemptions >= perUser) {
    return { ok: false, reason: 'per_user_limit_reached' };
  }
  return { ok: true, reason: 'ok' };
}

/** A beváltáskor jóváírandó jutalom (klampelt, biztonságos értékekkel). */
export function promoReward(code: Pick<PromoCode, 'kind' | 'value'>): { kind: PromoKind; value: number } {
  const raw = Number(code.value) || 0;
  switch (code.kind) {
    case 'percent':
      return { kind: 'percent', value: Math.min(100, Math.max(1, Math.round(raw))) };
    case 'credit':
      return { kind: 'credit', value: Math.max(0, Math.round(raw)) };
    case 'proDays':
      return { kind: 'proDays', value: Math.max(0, Math.round(raw)) };
    default:
      return { kind: 'credit', value: 0 };
  }
}

/** Százalékos kedvezmény alkalmazása egy összegre (lefelé kerekítve, nem-negatív). */
export function applyPercentDiscount(amount: number, percent: number): number {
  const a = Math.max(0, Number(amount) || 0);
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  return Math.max(0, Math.round(a - (a * p) / 100));
}
