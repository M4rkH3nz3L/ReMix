import { requireSupabase, supabase } from '@/lib/supabase';
import { InsufficientCreditsError } from '@/lib/shop';
import { currentUserId } from '@/lib/feed';

/**
 * 📣 Poszt-promóció (reklám / kiemelés) kliens-rétege — kredit-alapú, NÉZŐNKÉNTI
 * költés. A szponzor büdzsét + nézőnkénti összeget ad; a poszt kiemelt lesz, és
 * a megtekintések fogyasztják a büdzsét (`promote_post` RPC + record_post_view).
 * A statisztikák a poszt-sorból (számlálók) + a promóció-sorból (RLS: szponzor/
 * tulaj) + a `creator_totals` RPC-ből jönnek.
 */

export interface Promotion {
  id: string;
  postId: string;
  budgetCredits: number;
  costPerView: number;
  viewsTarget: number;
  viewsDelivered: number;
  spentCredits: number;
  status: 'active' | 'paused' | 'done';
  createdAt: string;
}

interface PromoRow {
  id: string;
  post_id: string;
  budget_credits: number;
  cost_per_view: number;
  views_target: number;
  views_delivered: number;
  spent_credits: number;
  status: Promotion['status'];
  created_at: string;
}

function toPromotion(r: PromoRow): Promotion {
  return {
    id: r.id,
    postId: r.post_id,
    budgetCredits: r.budget_credits,
    costPerView: r.cost_per_view,
    viewsTarget: r.views_target,
    viewsDelivered: r.views_delivered,
    spentCredits: r.spent_credits,
    status: r.status,
    createdAt: r.created_at,
  };
}

const PROMO_COLUMNS =
  'id, post_id, budget_credits, cost_per_view, views_target, views_delivered, spent_credits, status, created_at';

/**
 * Poszt kiemelése: `budget` kredit büdzsé, `costPerView` nézőnkénti összeg →
 * `floor(budget/costPerView)` cél-megtekintés. Escrow (a büdzsé azonnal levon).
 * Kevés kredit → InsufficientCreditsError (a UI a kredit-vásárlásra irányít).
 */
export async function promotePost(
  postId: string,
  budget: number,
  costPerView: number
): Promise<{ promotionId: string; viewsTarget: number }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('promote_post', {
    p_post: postId,
    p_budget: Math.trunc(budget),
    p_cost_per_view: Math.max(1, Math.trunc(costPerView)),
  });
  if (error) {
    if (/insufficient_credits/.test(error.message)) {
      throw new InsufficientCreditsError();
    }
    throw new Error(error.message);
  }
  const res = (data ?? {}) as { promotionId?: string; viewsTarget?: number };
  return { promotionId: res.promotionId ?? '', viewsTarget: res.viewsTarget ?? 0 };
}

/** Egy poszt legutóbbi promóciója (RLS: szponzor vagy a poszt tulaja), vagy null. */
export async function postPromotion(postId: string): Promise<Promotion | null> {
  if (!supabase) {
    return null;
  }
  const { data } = await supabase
    .from('post_promotions')
    .select(PROMO_COLUMNS)
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toPromotion(data as PromoRow) : null;
}

/** A szponzorált (általam indított) promócióim. */
export async function myPromotions(): Promise<Promotion[]> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    return [];
  }
  const { data, error } = await sb
    .from('post_promotions')
    .select(PROMO_COLUMNS)
    .eq('sponsor_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    return [];
  }
  return (data as PromoRow[]).map(toPromotion);
}

export interface CreatorTotals {
  views: number;
  likes: number;
  saves: number;
  comments: number;
  remixes: number;
}

/** Az alkotó összesített statisztikái (a publikus posztjain). */
export async function creatorTotals(userId: string): Promise<CreatorTotals> {
  const empty: CreatorTotals = { views: 0, likes: 0, saves: 0, comments: 0, remixes: 0 };
  if (!supabase) {
    return empty;
  }
  const { data } = await supabase.rpc('creator_totals', { p_user: userId });
  const t = (data ?? {}) as Partial<CreatorTotals>;
  return {
    views: t.views ?? 0,
    likes: t.likes ?? 0,
    saves: t.saves ?? 0,
    comments: t.comments ?? 0,
    remixes: t.remixes ?? 0,
  };
}
