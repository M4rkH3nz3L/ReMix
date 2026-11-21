import { COIN_TIERS, KIND_ICON, giftIcon, savedPayoutAccount, subscriptionMonths } from '@/lib/walletCardOps';

describe('walletCardOps — a pénztárca-kártya tiszta magja', () => {
  it('a Coinnal vehető szintek: basic, pro, ultra (free és business nélkül, sorrendben)', () => {
    expect(COIN_TIERS).toEqual(['basic', 'pro', 'ultra']);
  });

  it('a tranzakció-ikonok: a 14 ismert fajta rögzítve, ismeretlenre nincs bejegyzés', () => {
    expect(Object.keys(KIND_ICON)).toHaveLength(14);
    expect(KIND_ICON.payout).toBe('cash');
    expect(KIND_ICON.reversal).toBe('arrow-undo');
    expect(KIND_ICON.weird).toBeUndefined();
  });

  it('az ajándék ikonja a katalógusból; ismeretlen id → 🎁', () => {
    const gifts = [{ id: 'g1', name: 'Rózsa', icon: '🌹', costCents: 10 }];
    expect(giftIcon(gifts, 'g1')).toBe('🌹');
    expect(giftIcon(gifts, 'nincs')).toBe('🎁');
    expect(giftIcon([], 'g1')).toBe('🎁');
  });

  it('az előfizetés hossza: éves = 12, havi = 1 hónap', () => {
    expect(subscriptionMonths(true)).toBe(12);
    expect(subscriptionMonths(false)).toBe(1);
  });

  it('mentett kifizetési fiók: mindig PayPal; ugyanaz az e-mail → a KYC-állapot marad, új → none', () => {
    const prev = { provider: 'stripe' as const, email: 'a@b.c', kycStatus: 'verified' as const };
    expect(savedPayoutAccount(prev, 'a@b.c')).toEqual({ provider: 'paypal', email: 'a@b.c', kycStatus: 'verified' });
    expect(savedPayoutAccount(prev, 'uj@b.c')).toEqual({ provider: 'paypal', email: 'uj@b.c', kycStatus: 'none' });
    expect(savedPayoutAccount(null, 'a@b.c')).toEqual({ provider: 'paypal', email: 'a@b.c', kycStatus: 'none' });
    // kis-/nagybetű különbség = más e-mail (nincs normalizálás)
    expect(savedPayoutAccount(prev, 'A@b.c').kycStatus).toBe('none');
    // a mezősorrend rögzített
    expect(Object.keys(savedPayoutAccount(null, 'x'))).toEqual(['provider', 'email', 'kycStatus']);
  });
});
