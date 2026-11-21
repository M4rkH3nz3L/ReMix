/**
 * 🪙 A pénztárca-kártya (src/components/profile/WalletCard.tsx) tiszta, expo-mentes
 * magja: a tranzakció-ikonok, a Coinnal vehető szintek és a kis leképezések.
 * A kártyából kiemelve (REFACTOR) — a viselkedés változatlan.
 */
import type { Tier } from '@/lib/tiers';
import type { Gift, PayoutAccount } from '@/lib/wallet';

export const KIND_ICON: Record<string, string> = {
  topup: 'add-circle',
  purchase: 'cart',
  sale: 'pricetag',
  refund: 'return-down-back',
  payout: 'cash',
  transfer: 'swap-horizontal',
  gift: 'gift',
  promo: 'pricetags',
  subscription: 'rocket',
  addon: 'add',
  bonus: 'sparkles',
  release: 'lock-open',
  expire: 'time',
  reversal: 'arrow-undo',
};

/** A Coinnal megvehető egyéni szintek (a Vállalati a szervezeti fiókból jön, 4. fázis). */
export const COIN_TIERS: Exclude<Tier, 'free' | 'business'>[] = ['basic', 'pro', 'ultra'];

export function giftIcon(gifts: Gift[], id: string): string {
  return gifts.find((g) => g.id === id)?.icon ?? '🎁';
}

/** az előfizetés hossza hónapban: éves = 12, havi = 1 */
export function subscriptionMonths(annual: boolean): 1 | 12 {
  return annual ? 12 : 1;
}

/** a mentett kifizetési fiók: ugyanarra az e-mailre a KYC-állapot megmarad, újra 'none' */
export function savedPayoutAccount(prev: PayoutAccount | null, email: string): PayoutAccount {
  return { provider: 'paypal', email, kycStatus: prev?.email === email ? (prev?.kycStatus ?? 'none') : 'none' };
}
