import { refreshEntitlement } from '@/lib/billing';
import {
  normalizePromoCode,
  promoReward,
  redemptionDecision,
  type PromoCode,
  type RedeemReason,
} from '@/lib/promoCodes';
import { requireSupabase } from '@/lib/supabase';

/**
 * 🎟️ Promo / kupon — kliens-kötés.
 *
 * SZERVER-HITELES beváltás: a kliens sosem ad magának kedvezményt. A `preview`
 * EGY pontos kódra kér vissza (nincs enumeráció), és a pure {@link redemptionDecision}-nal
 * AZONNALI UX-visszajelzést ad (érvénytelen/lejárt/kimerült). A `redeem` a
 * `redeem_promo` SECURITY DEFINER RPC-t hívja — ez a tényleges jóváírás.
 * Lásd `@/lib/promoCodes` (a szabály tiszta magja), `@/lib/wallet` (koin-főkönyv).
 */

export interface PromoPreview {
  found: boolean;
  code: PromoCode | null;
  /** a pure döntés az aktuális kliens-időre */
  ok: boolean;
  reason: RedeemReason;
  reward: { kind: PromoCode['kind']; value: number } | null;
}

function toPromoCode(d: Record<string, unknown>): PromoCode {
  return {
    code: String(d.code ?? ''),
    kind: d.kind as PromoCode['kind'],
    value: Number(d.value ?? 0),
    expiresAt: (d.expiresAt as string | null) ?? null,
    maxRedemptions: (d.maxRedemptions as number | null) ?? null,
    perUserLimit: (d.perUserLimit as number | null) ?? null,
    active: Boolean(d.active),
    campaignId: (d.campaignId as string | null) ?? null,
    creatorId: (d.creatorId as string | null) ?? null,
  };
}

/**
 * UX-előnézet: a kód státusza beváltás ELŐTT. A döntést a pure
 * {@link redemptionDecision} hozza a szerver-adta számlálók + a kliens-idő alapján.
 */
export async function previewPromo(rawCode: string): Promise<PromoPreview> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('preview_promo', { p_code: normalizePromoCode(rawCode) });
  if (error) {
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (!d.found) {
    return { found: false, code: null, ok: false, reason: 'invalid', reward: null };
  }
  const code = toPromoCode(d);
  const decision = redemptionDecision(code, {
    nowMs: Date.now(),
    userRedemptions: Number(d.userRedemptions ?? 0),
    globalRedemptions: Number(d.globalRedemptions ?? 0),
  });
  return {
    found: true,
    code,
    ok: decision.ok,
    reason: decision.reason,
    reward: decision.ok ? promoReward(code) : null,
  };
}

export interface PromoResult {
  kind: PromoCode['kind'];
  value: number;
  balance?: number;
  proUntil?: string;
}

/**
 * HITELES beváltás a `redeem_promo` RPC-n. A szerver dönt és ír — a hibaüzenet a
 * pure {@link RedeemReason} kódja (invalid_code/inactive/expired/limit_reached/…).
 * proDays-kódnál frissíti a helyi jogosultságot.
 */
export async function redeemPromo(rawCode: string): Promise<PromoResult> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('redeem_promo', { p_code: normalizePromoCode(rawCode) });
  if (error) {
    throw new Error(error.message);
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.kind === 'proDays') {
    await refreshEntitlement().catch(() => {});
  }
  return {
    kind: d.kind as PromoCode['kind'],
    value: Number(d.value ?? 0),
    balance: d.balance != null ? Number(d.balance) : undefined,
    proUntil: d.pro_until != null ? String(d.pro_until) : undefined,
  };
}
