import {
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
import { parseSubscription } from '@/lib/walletCore/subscription';
import * as wallet from '@/lib/wallet';

/** 🪙 A pénztárca expo-mentes magja (REFACTOR: a src/lib/wallet.ts-ből kiemelve) — a mai viselkedés rögzítve. */

describe('walletCore/errors — a típusos hibák neve és üzenete (a UI a kódra fordít)', () => {
  it.each([
    ['RecipientNotFoundError', RecipientNotFoundError, 'recipient_not_found'],
    ['SelfSendError', SelfSendError, 'cannot_send_to_self'],
    ['GiftNotFoundError', GiftNotFoundError, 'gift_not_found'],
    ['NoPayoutAccountError', NoPayoutAccountError, 'no_payout_account'],
    ['BelowMinPayoutError', BelowMinPayoutError, 'below_min_payout'],
    ['InsufficientEarnedError', InsufficientEarnedError, 'insufficient_earned'],
    ['ManagedByStoreError', ManagedByStoreError, 'managed_by_store'],
    ['KycRequiredError', KycRequiredError, 'kyc_required'],
    ['PayoutWeeklyLimitError', PayoutWeeklyLimitError, 'payout_weekly_limit'],
  ] as const)('%s → Error-leszármazott, pontos üzenettel', (name, Cls, message) => {
    const e = new Cls();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe(name);
    expect(e.message).toBe(message);
  });

  it('az AddonNotAllowedError az okot üzenetként viszi', () => {
    const e = new AddonNotAllowedError('tier_too_low');
    expect(e.name).toBe('AddonNotAllowedError');
    expect(e.message).toBe('tier_too_low');
  });

  it('a barrel UGYANAZT az osztályt adja tovább (instanceof a hívóknál működik)', () => {
    expect(wallet.KycRequiredError).toBe(KycRequiredError);
    expect(wallet.AddonNotAllowedError).toBe(AddonNotAllowedError);
  });
});

describe('parseSubscription — a my_subscription() válasz normalizálása', () => {
  it('nem-objektum → alapértékek (free, aktív, 1 hely, havi)', () => {
    for (const raw of [undefined, null, 'x', 7]) {
      expect(parseSubscription(raw)).toEqual({
        tier: 'free',
        status: 'active',
        source: 'manual',
        seats: 1,
        billingPeriod: 'month',
        until: null,
        autoRenew: false,
        pendingTier: null,
        renewalCost: 0,
        trialAvailable: false,
        addons: [],
      });
    }
  });

  it('teljes válasz: számok stringből, 0 hely → 1, add-on qty 0 → 1', () => {
    const s = parseSubscription({
      tier: 'pro',
      status: 'past_due',
      source: 'store',
      seats: 0,
      billing_period: 'year',
      until: '2027-01-01',
      auto_renew: true,
      pending_tier: 'creator',
      renewal_cost: '1500',
      trial_available: true,
      addons: [{ id: 1, addon: 'storage', qty: 0, cancel_at_period_end: true }],
    });
    expect(s).toMatchObject({ tier: 'pro', seats: 1, billingPeriod: 'year', until: '2027-01-01', autoRenew: true, renewalCost: 1500 });
    expect(s.addons).toEqual([{ id: '1', addon: 'storage', qty: 1, cancelAtPeriodEnd: true }]);
  });

  it('csak a szó szerinti true / string számít (auto_renew "true", until szám → nem)', () => {
    const s = parseSubscription({ auto_renew: 'true', trial_available: 1, until: 5, pending_tier: 5, renewal_cost: NaN, seats: 'abc' });
    expect(s.autoRenew).toBe(false);
    expect(s.trialAvailable).toBe(false);
    expect(s.until).toBeNull();
    expect(s.pendingTier).toBeNull();
    expect(s.renewalCost).toBe(0);
    expect(s.seats).toBe(1);
  });

  it('a negatív / tört díj és hely érintetlenül átmegy (nincs kerekítés)', () => {
    const s = parseSubscription({ seats: 2.5, renewal_cost: -3 });
    expect(s.seats).toBe(2.5);
    expect(s.renewalCost).toBe(-3);
  });
});

describe('wallet barrel — a publikus felület', () => {
  it('a futásidejű exportok listája változatlan', () => {
    expect(Object.keys(wallet).sort()).toEqual(
      [
        'AddonNotAllowedError',
        'BelowMinPayoutError',
        'GiftNotFoundError',
        'InsufficientEarnedError',
        'KycRequiredError',
        'ManagedByStoreError',
        'NoPayoutAccountError',
        'PayoutWeeklyLimitError',
        'RecipientNotFoundError',
        'SelfSendError',
        'addAddon',
        'claimReferral',
        'creditHistory',
        'downloadDac7',
        'downloadEarningsStatement',
        'fetchEarnings',
        'fetchPayoutAccount',
        'fetchSubscription',
        'fetchWallet',
        'listGifts',
        'listPayoutsUnderReview',
        'myPayoutRequests',
        'myReferralStats',
        'parseSubscription',
        'receivedGifts',
        'removeAddon',
        'requestPayout',
        'reviewPayout',
        'sendGift',
        'setAutoRenew',
        'setPayoutAccount',
        'startStripeKyc',
        'startTrial',
        'startWebTopup',
        'subscribeWithCoins',
      ].sort()
    );
  });
});
