// A pénztárca kliens-oldali sor-modelljei (cent-Coin)

export interface CreditTx {
  id: string;
  /** cent-Coin (+ jóváírás / − terhelés) */
  deltaCents: number;
  /** melyik alegyenleget érintette */
  bucket: 'purchased' | 'bonus' | 'earned_pending' | 'earned_available' | null;
  kind: string;
  note: string | null;
  createdAt: string;
}

export interface PayoutRequest {
  id: string;
  cents: number;
  amountEurCents: number;
  status: string;
  createdAt: string;
}

export interface PayoutAccount {
  provider: 'paypal' | 'stripe' | null;
  email: string | null;
  /** a partner (Stripe Connect / PayPal) által végzett azonosítás állapota — kifizetés csak 'verified'-del */
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
}

export interface Gift {
  id: string;
  name: string;
  icon: string;
  costCents: number;
}

export interface GiftEvent {
  id: string;
  giftId: string;
  /** az alkotónak jóváírt rész (80%), cent-Coin */
  creatorCents: number;
  createdAt: string;
}

/** Ellenőrzésre váró kifizetés (admin, `payout.review`). */
export interface PayoutReviewRow {
  id: string;
  username: string | null;
  cents: number;
  amountEurCents: number;
  riskFlags: string[];
  createdAt: string;
}
