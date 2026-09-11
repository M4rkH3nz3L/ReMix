/**
 * 💳 Előfizetés-lekérdezés — a per-user Pro szint SZERVER-oldali forrása.
 *
 * A `subscriptions` tábla (RLS: csak a sajátját olvashatja) a tier egyetlen
 * hiteles forrása. A kliens (entitlementStore) bejelentkezéskor ezt lekéri és
 * offline-cache-eli. Hiányzó sor / hiba / offline → védekezőn `free`.
 *
 * A billing (RevenueCat/Stripe) később ír a táblába; ide nem kell nyúlni.
 */
import { supabase } from '@/lib/supabase';

export interface SubscriptionInfo {
  tier: 'free' | 'pro';
  /** ISO dátum, ameddig a Pro érvényes; `null` = lejárat nélkül */
  proUntil: string | null;
}

/** A státuszok, amelyeknél a Pro még aktívnak számít (a lejáratot külön nézzük). */
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

/**
 * A bejelentkezett user előfizetése a Supabase-ből, vagy `null`, ha nincs
 * backend / nincs sor / hiba. A hívó (entitlementStore) a `null`-t `free`-ként
 * kezeli, és megtartja az offline cache-t, ha volt.
 */
export async function fetchMySubscription(userId: string): Promise<SubscriptionInfo | null> {
  if (!supabase || !userId) {
    return null;
  }
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const active = ACTIVE_STATUSES.has(String(data.status ?? 'active'));
  const tier: SubscriptionInfo['tier'] = data.tier === 'pro' && active ? 'pro' : 'free';
  const proUntil = typeof data.current_period_end === 'string' ? data.current_period_end : null;
  return { tier, proUntil };
}
