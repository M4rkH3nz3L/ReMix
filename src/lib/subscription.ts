/**
 * 💳 Előfizetés-lekérdezés — a per-user szint (Free / Amatőr / Haladó / Profi / Vállalati) SZERVER-oldali forrása.
 *
 * A `subscriptions` tábla (RLS: csak a sajátját olvashatja) a tier egyetlen
 * hiteles forrása. A kliens (entitlementStore) bejelentkezéskor ezt lekéri és
 * offline-cache-eli. Hiányzó sor / hiba / offline → védekezőn `free`.
 *
 * A billing (RevenueCat/Stripe) később ír a táblába; ide nem kell nyúlni.
 */
import { supabase } from '@/lib/supabase';
import { activeTierFromRow, asTier, type Tier } from '@/lib/tiers';

export interface SubscriptionInfo {
  /** az AKTÍV szint (mind az 5: free / basic / pro / ultra / business — a szervezettől örökölt Vállalati is) */
  tier: Tier;
  /** ISO dátum, ameddig a Pro érvényes; `null` = lejárat nélkül */
  proUntil: string | null;
}

/** A teljes előfizetés-sor a profil megjelenítéséhez (minden adat). */
export interface SubscriptionDetails {
  tier: Tier;
  status: string;
  currentPeriodEnd: string | null;
  source: string;
  createdAt: string | null;
  updatedAt: string | null;
}


/**
 * A bejelentkezett user előfizetése a Supabase-ből, vagy `null`, ha nincs
 * backend / nincs sor / hiba. A hívó (entitlementStore) a `null`-t `free`-ként
 * kezeli, és megtartja az offline cache-t, ha volt.
 */
export async function fetchMySubscription(userId: string): Promise<SubscriptionInfo | null> {
  if (!supabase || !userId) {
    return null;
  }
  // a hiteles aktív szint a szervertől (my_subscription: státusz, lejárat ÉS a szervezeti tagság)
  const { data: rpcData, error: rpcError } = await supabase.rpc('my_subscription');
  if (!rpcError && rpcData && typeof rpcData === 'object') {
    const r = rpcData as { tier?: unknown; until?: unknown };
    const tier = asTier(r.tier);
    return { tier, proUntil: tier !== 'free' && typeof r.until === 'string' ? r.until : null };
  }
  // tartalék (régi szerver): a saját sor, ugyanazzal a szabállyal, mint a DB active_tier_for
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  const tier = activeTierFromRow(data);
  return { tier, proUntil: typeof data.current_period_end === 'string' ? data.current_period_end : null };
}

/**
 * A bejelentkezett user TELJES előfizetés-sora a profil megjelenítéséhez, vagy
 * `null` (nincs backend / nincs sor / hiba). Csak kijelzéshez — a Pro-kaput az
 * entitlementStore dönti el.
 */
export async function fetchSubscriptionDetails(
  userId: string
): Promise<SubscriptionDetails | null> {
  if (!supabase || !userId) {
    return null;
  }
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, current_period_end, source, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return {
    tier: activeTierFromRow(data),
    status: String(data.status ?? 'active'),
    currentPeriodEnd:
      typeof data.current_period_end === 'string' ? data.current_period_end : null,
    source: String(data.source ?? 'manual'),
    createdAt: typeof data.created_at === 'string' ? data.created_at : null,
    updatedAt: typeof data.updated_at === 'string' ? data.updated_at : null,
  };
}
