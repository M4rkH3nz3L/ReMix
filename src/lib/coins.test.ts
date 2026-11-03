import {
  COIN_PACKS,
  EMPTY_WALLET,
  MIN_PAYOUT_CENTS,
  canRequestPayout,
  coinsToCents,
  creatorShare,
  formatCoins,
  formatEur,
  parseWallet,
  payoutEur,
  spendPlan,
  subscriptionCostCents,
} from '@/lib/coins';

describe('coins — árak és díjak (PRO-CASH 2–3.)', () => {
  it('havidíj: Amatőr 2 / Haladó 4 / Profi 8 Coin; éves = 10 havi', () => {
    expect(subscriptionCostCents('basic', 1)).toBe(200);
    expect(subscriptionCostCents('pro', 1)).toBe(400);
    expect(subscriptionCostCents('ultra', 1)).toBe(800);
    expect(subscriptionCostCents('basic', 12)).toBe(2000);
  });

  it('Vállalati: 10 Coin / fő, min. 2 fő', () => {
    expect(subscriptionCostCents('business', 1, 5)).toBe(5000);
    expect(subscriptionCostCents('business', 1, 1)).toBe(2000);
  });

  it('bolt 70/30, ajándék 80/20; a platform a lefelé kerekített díjat kapja', () => {
    expect(creatorShare(500, 'sale')).toBe(350);
    expect(creatorShare(10000, 'gift')).toBe(8000);
    expect(creatorShare(10, 'gift')).toBe(8);
    expect(creatorShare(25, 'sale')).toBe(18); // díj floor(7,5) = 7
  });

  it('beváltás: 1 megkeresett Coin = 3 €', () => {
    expect(payoutEur(2000)).toBe(60);
    expect(payoutEur(14400)).toBe(432);
  });

  it('a csomag-bónusz csak a 10 Coin feletti csomagokon', () => {
    expect(COIN_PACKS.filter((p) => p.bonusCoins > 0).map((p) => p.coins)).toEqual([10, 25, 50]);
  });
});

describe('coins — kijelzés és bevitel', () => {
  it('formatCoins: két tizedes csak ha kell, ezres tagolás', () => {
    expect(formatCoins(40)).toBe('0,40');
    expect(formatCoins(1200)).toBe('12');
    expect(formatCoins(125050)).toBe('1 250,50');
    expect(formatCoins(-5)).toBe('−0,05');
  });

  it('coinsToCents: tizedesvesszőt is elfogad; érvénytelen → 0', () => {
    expect(coinsToCents('0,4')).toBe(40);
    expect(coinsToCents(2.5)).toBe(250);
    expect(coinsToCents('abc')).toBe(0);
    expect(coinsToCents(-1)).toBe(0);
  });

  it('formatEur', () => {
    expect(formatEur(432)).toBe('432,00 €');
  });
});

describe('coins — költési sorrend és kifizetés (a DB coin_debit tükre)', () => {
  const w = { ...EMPTY_WALLET, bonus: 300, purchased: 1000, earnedAvailable: 500, earnedPending: 200, balance: 2000 };

  it('bónusz → vásárolt → beváltható → függő', () => {
    expect(spendPlan(w, 500)).toEqual({ bonus: 300, purchased: 200, earnedAvailable: 0, earnedPending: 0 });
    expect(spendPlan(w, 1900)).toEqual({ bonus: 300, purchased: 1000, earnedAvailable: 500, earnedPending: 100 });
  });

  it('kevés egyenleg → null', () => {
    expect(spendPlan(w, 2001)).toBeNull();
  });

  it('kifizetés csak a beváltható megkeresettből, min. 20 Coin', () => {
    const rich = { ...w, earnedAvailable: 5000 };
    expect(canRequestPayout(rich, MIN_PAYOUT_CENTS)).toBe(true);
    expect(canRequestPayout(rich, MIN_PAYOUT_CENTS - 1)).toBe(false);
    expect(canRequestPayout({ ...rich, earnedAvailable: 100, purchased: 99999 }, 2000)).toBe(false);
  });

  it('parseWallet: a my_wallet() válaszát normalizálja', () => {
    expect(parseWallet({ purchased: 5, earned_pending: '7', balance: 12, next_release_at: '2026-12-01' })).toEqual({
      ...EMPTY_WALLET,
      purchased: 5,
      earnedPending: 7,
      balance: 12,
      nextReleaseAt: '2026-12-01',
    });
    expect(parseWallet(null)).toEqual(EMPTY_WALLET);
  });
});
