// A pénzügyi RPC-k / worker-válaszok hibakódjainak típusos hibái

/** Címzett nem található. */
export class RecipientNotFoundError extends Error {
  constructor() {
    super('recipient_not_found');
    this.name = 'RecipientNotFoundError';
  }
}
/** Magadnak nem küldhetsz. */
export class SelfSendError extends Error {
  constructor() {
    super('cannot_send_to_self');
    this.name = 'SelfSendError';
  }
}
/** Ismeretlen ajándék. */
export class GiftNotFoundError extends Error {
  constructor() {
    super('gift_not_found');
    this.name = 'GiftNotFoundError';
  }
}
/** Nincs beállított kifizetési célszámla. */
export class NoPayoutAccountError extends Error {
  constructor() {
    super('no_payout_account');
    this.name = 'NoPayoutAccountError';
  }
}
/** A kiváltandó összeg a minimum (20 Coin) alatt van. */
export class BelowMinPayoutError extends Error {
  constructor() {
    super('below_min_payout');
    this.name = 'BelowMinPayoutError';
  }
}
/** Nincs ennyi BEVÁLTHATÓ megkeresett Coin (a vásárolt / függő nem váltható). */
export class InsufficientEarnedError extends Error {
  constructor() {
    super('insufficient_earned');
    this.name = 'InsufficientEarnedError';
  }
}
/** Az előfizetést az áruház kezeli (App Store / Play) — ott módosítható. */
export class ManagedByStoreError extends Error {
  constructor() {
    super('managed_by_store');
    this.name = 'ManagedByStoreError';
  }
}
/** Kifizetés előtt azonosítás (KYC) kell. */
export class KycRequiredError extends Error {
  constructor() {
    super('kyc_required');
    this.name = 'KycRequiredError';
  }
}
/** Hetente legfeljebb egy kifizetés kérhető. */
export class PayoutWeeklyLimitError extends Error {
  constructor() {
    super('payout_weekly_limit');
    this.name = 'PayoutWeeklyLimitError';
  }
}

/** Az add-on nem vehető (szint / számlázás). */
export class AddonNotAllowedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AddonNotAllowedError';
  }
}
