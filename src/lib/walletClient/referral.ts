import { requireSupabase, supabase } from '@/lib/supabase';
import { currentUid } from '@/lib/walletClient/session';

/** 🤝 Az ajánló megadása (a regisztrációt követő 7 napon belül, egyszer). */
export async function claimReferral(username: string): Promise<void> {
  const { error } = await requireSupabase().rpc('claim_referral', { p_username: username.trim().replace(/^@/, '') });
  if (error) {
    throw new Error(
      /referrer_not_found|cannot_refer_self|referral_already_set|referral_window_closed|referral_loop/.exec(error.message)?.[0] ?? error.message
    );
  }
}

/** Az általam meghívottak száma és az eddigi jutalék (cent-Coin). */
export async function myReferralStats(): Promise<{ invited: number; earnedCents: number }> {
  const uid = currentUid();
  if (!supabase || !uid) {
    return { invited: 0, earnedCents: 0 };
  }
  const { data } = await supabase.from('referrals').select('earned_cents').eq('referrer_id', uid);
  const rows = (data ?? []) as { earned_cents: number }[];
  return { invited: rows.length, earnedCents: rows.reduce((n, r) => n + Number(r.earned_cents || 0), 0) };
}
