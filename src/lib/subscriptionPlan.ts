import { ANNUAL_BILLED_MONTHS, TIER_PRICE_CENTS } from '@/lib/coins';
import { tierRank, type Tier } from '@/lib/tiers';
import type { UsageMetric } from '@/lib/usageMeter';

/**
 * 🔁 Előfizetés-ciklus mag — tiszta, expo-mentes (PRO-CASH 3.3–3.4).
 *
 * Coinból fizetett előfizetésnél a szerver (`subscribe_with_coins`, `add_addon`,
 * `renew_due_subscriptions`) ugyanezt a szabályt alkalmazza; ez a modul a kliens
 * előnézetéhez mondja ki. A kettőt a contract.test.ts zárolja (add-on árak, minimum-szint).
 *
 *  • Felfelé váltás: azonnal; a régi szint fel nem használt része időarányosan jóváíródik,
 *    az új szint teljes periódusa indul mostantól.
 *  • Lefelé váltás: a következő ciklustól (addig a magasabb szint marad).
 *  • Add-on: havi ismétlődő tétel; felvételkor a periódus hátralévő részét fizeted
 *    időarányosan, megújításkor a teljes árat; levétel a következő ciklustól.
 */

export type PaidTier = Exclude<Tier, 'free'>;
export type BillingPeriodKind = 'month' | 'year';

export type AddonId =
  | 'storage_10gb'
  | 'storage_100gb'
  | 'ai_1m'
  | 'render_60'
  | 'publish_account'
  | 'multistream_target'
  | 'collab_5';

export interface AddonDef {
  id: AddonId;
  /** havi ár cent-Coinban (PRO-CASH 3.3) */
  priceCents: number;
  /** a legalacsonyabb szint, amelyhez vehető */
  minTier: PaidTier;
  /** mit ad egységenként */
  grants: { storageGB?: number; usage?: Partial<Record<UsageMetric, number>>; publishAccounts?: number; multistreamTargets?: number; collaborators?: number };
}

export const ADDONS: readonly AddonDef[] = [
  { id: 'storage_10gb', priceCents: 100, minTier: 'basic', grants: { storageGB: 10 } },
  { id: 'storage_100gb', priceCents: 600, minTier: 'pro', grants: { storageGB: 100 } },
  { id: 'ai_1m', priceCents: 100, minTier: 'basic', grants: { usage: { aiTokens: 1000000 } } },
  { id: 'render_60', priceCents: 100, minTier: 'basic', grants: { usage: { renderMinutes: 60 } } },
  { id: 'publish_account', priceCents: 40, minTier: 'basic', grants: { publishAccounts: 1 } },
  { id: 'multistream_target', priceCents: 40, minTier: 'pro', grants: { multistreamTargets: 1 } },
  { id: 'collab_5', priceCents: 100, minTier: 'basic', grants: { collaborators: 5 } },
];

export function addonDef(id: string): AddonDef | null {
  return ADDONS.find((a) => a.id === id) ?? null;
}

/** Vehető-e az add-on az adott szinten. */
export function addonAllowed(id: AddonId, tier: Tier): boolean {
  const a = addonDef(id);
  return !!a && tier !== 'free' && tierRank(tier) >= tierRank(a.minTier);
}

/** Egy teljes periódus díja (szint × ülés, éves = 10 havi). */
export function periodPriceCents(tier: PaidTier, period: BillingPeriodKind, seats = 1): number {
  const n = tier === 'business' ? Math.max(2, Math.trunc(seats) || 2) : 1;
  return TIER_PRICE_CENTS[tier] * n * (period === 'year' ? ANNUAL_BILLED_MONTHS : 1);
}

/** Egy add-on egy periódusra (havi ár; éves periódusnál × 12 — az add-on nem kap éves kedvezményt). */
export function addonPeriodCents(id: AddonId, qty: number, period: BillingPeriodKind): number {
  const a = addonDef(id);
  return a ? a.priceCents * Math.max(0, Math.trunc(qty)) * (period === 'year' ? 12 : 1) : 0;
}

/** A periódus hátralévő aránya [0, 1] (`now` a periódus előtt → 1, után → 0). */
export function remainingFraction(startMs: number, endMs: number, nowMs: number): number {
  if (!(endMs > startMs)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (endMs - nowMs) / (endMs - startMs)));
}

/** A fel nem használt rész jóváírása: floor(ár × hátralévő arány) — a DB `coin_proration_credit` tükre. */
export function prorationCreditCents(paidCents: number, startMs: number, endMs: number, nowMs: number): number {
  return Math.floor(Math.max(0, paidCents) * remainingFraction(startMs, endMs, nowMs));
}

/** Időarányos díj a hátralévő részre: ceil(ár × hátralévő arány) — add-on felvételkor. */
export function proratedChargeCents(fullCents: number, startMs: number, endMs: number, nowMs: number): number {
  return Math.ceil(Math.max(0, fullCents) * remainingFraction(startMs, endMs, nowMs));
}

/** Felfelé váltás ára most: az új szint teljes periódusa − a régi fel nem használt része (≥ 0). */
export function upgradeCostCents(args: {
  fromTier: PaidTier;
  toTier: PaidTier;
  period: BillingPeriodKind;
  seats?: number;
  startMs: number;
  endMs: number;
  nowMs: number;
}): number {
  const credit = prorationCreditCents(periodPriceCents(args.fromTier, args.period, args.seats), args.startMs, args.endMs, args.nowMs);
  return Math.max(0, periodPriceCents(args.toTier, args.period, args.seats) - credit);
}

export type TierChange = 'same' | 'upgrade' | 'downgrade' | 'start';

/** Milyen váltás ez (a jelenlegi aktív szintről a kért szintre). */
export function tierChangeKind(activeTier: Tier, wanted: PaidTier): TierChange {
  if (activeTier === 'free') {
    return 'start';
  }
  if (activeTier === wanted) {
    return 'same';
  }
  return tierRank(wanted) > tierRank(activeTier) ? 'upgrade' : 'downgrade';
}

/** Megújításkor fizetendő: a (következő) szint periódusdíja + a megmaradó add-onok. */
export function renewalCostCents(args: {
  tier: PaidTier;
  period: BillingPeriodKind;
  seats?: number;
  addons: { id: AddonId; qty: number; cancelAtPeriodEnd?: boolean }[];
}): number {
  return (
    periodPriceCents(args.tier, args.period, args.seats) +
    args.addons
      .filter((a) => !a.cancelAtPeriodEnd)
      .reduce((sum, a) => sum + addonPeriodCents(a.id, a.qty, args.period), 0)
  );
}

/**
 * Felajánljuk-e a magasabb szintet (PRO-CASH 3.3 példa: Amatőr + add-onok = a Haladó ára,
 * de a Haladó többet ad). Igaz, ha a havi összeg eléri a következő szint havidíját.
 */
export function suggestUpgrade(tier: PaidTier, monthlyAddonCents: number): PaidTier | null {
  const order: PaidTier[] = ['basic', 'pro', 'ultra'];
  const i = order.indexOf(tier);
  if (i < 0 || i === order.length - 1) {
    return null;
  }
  const next = order[i + 1];
  return TIER_PRICE_CENTS[tier] + monthlyAddonCents >= TIER_PRICE_CENTS[next] ? next : null;
}
