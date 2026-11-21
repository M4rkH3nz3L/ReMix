/**
 * 🪙 Coin-pénztárca kliens-réteg (PRO-CASH 2. fejezet).
 *
 * Minden összeg cent-Coinban (1 Coin = 100); az árak, díjak és a kijelzés a tiszta
 * `@/lib/coins` magban. Minden pénzmozgás SZERVER-HITELES: a terhelés/jóváírás
 * SECURITY DEFINER RPC-ken megy (`subscribe_with_coins`, `send_gift`, …), a kifizetés
 * a worker `/wallet/payout`-ján (csak a beváltható megkeresett Coinból).
 */

// Barrel — expo-mentes mag: walletCore/ (sor-modellek, típusos hibák, előfizetés-normalizálás);
// hálózat: walletClient/ (Supabase RPC-k + worker: egyenleg, előfizetés, ajándék, kifizetés, ajánló, bevétel)
export type {
  CreditTx,
  Gift,
  GiftEvent,
  PayoutAccount,
  PayoutRequest,
  PayoutReviewRow,
} from '@/lib/walletCore/types';
export {
  AddonNotAllowedError,
  BelowMinPayoutError,
  GiftNotFoundError,
  InsufficientEarnedError,
  KycRequiredError,
  ManagedByStoreError,
  NoPayoutAccountError,
  PayoutWeeklyLimitError,
  RecipientNotFoundError,
  SelfSendError,
} from '@/lib/walletCore/errors';
export { parseSubscription, type MySubscription } from '@/lib/walletCore/subscription';
export type { EarningsMonth } from '@/lib/coins';
export { creditHistory, fetchWallet, startWebTopup } from '@/lib/walletClient/balance';
export {
  addAddon,
  fetchSubscription,
  removeAddon,
  setAutoRenew,
  startTrial,
  subscribeWithCoins,
} from '@/lib/walletClient/subscription';
export { listGifts, receivedGifts, sendGift } from '@/lib/walletClient/gifts';
export {
  fetchPayoutAccount,
  listPayoutsUnderReview,
  myPayoutRequests,
  requestPayout,
  reviewPayout,
  setPayoutAccount,
  startStripeKyc,
} from '@/lib/walletClient/payouts';
export { claimReferral, myReferralStats } from '@/lib/walletClient/referral';
export { downloadDac7, downloadEarningsStatement, fetchEarnings } from '@/lib/walletClient/earnings';
