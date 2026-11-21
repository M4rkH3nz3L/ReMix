/**
 * 💰 Dupla koppintás a pénztárcán: két szinkron koppintás UGYANABBAN a renderben (a `busy` még
 * hamis) csak EGY pénzmozgató hívást indíthat; a hívás végén (siker és hiba után is) az új
 * koppintás újra működik, a busy-UI változatlan.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import { WalletCard } from '@/components/profile/WalletCard';
import { CashoutSection } from '@/components/profile/wallet/CashoutSection';
import { CoinSubscriptionSection } from '@/components/profile/wallet/CoinSubscriptionSection';
import { GiftSection } from '@/components/profile/wallet/GiftSection';
import { WalletBalanceSection } from '@/components/profile/wallet/WalletBalanceSection';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mockRequestPayout = jest.fn();
const mockSubscribe = jest.fn();
const mockSendGift = jest.fn();
const mockBuyDev = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    Easing: new Proxy({}, { get: () => () => () => 0 }),
    withSpring: (v: unknown) => v,
    withTiming: (v: unknown) => v,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => object) => fn(),
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/components/profile/EarningsCard', () => ({ EarningsCard: () => null }));
jest.mock('@/components/profile/ReferralCard', () => ({ ReferralCard: () => null }));
jest.mock('@/components/profile/SubscriptionManageCard', () => ({ SubscriptionManageCard: () => null }));
jest.mock('@/lib/billing', () => ({
  billingClientAvailable: () => false,
  purchaseCoinPack: jest.fn(),
  PurchaseCancelledError: class extends Error {},
}));
jest.mock('@/lib/shop', () => ({
  InsufficientCreditsError: class extends Error {},
  buyCreditsDev: (...a: unknown[]) => mockBuyDev(...a),
}));
jest.mock('@/lib/wallet', () => {
  class E extends Error {}
  return {
    GiftNotFoundError: class extends E {},
    InsufficientEarnedError: class extends E {},
    KycRequiredError: class extends E {},
    ManagedByStoreError: class extends E {},
    NoPayoutAccountError: class extends E {},
    PayoutWeeklyLimitError: class extends E {},
    RecipientNotFoundError: class extends E {},
    SelfSendError: class extends E {},
    BelowMinPayoutError: class extends E {},
    requestPayout: (...a: unknown[]) => mockRequestPayout(...a),
    sendGift: (...a: unknown[]) => mockSendGift(...a),
    subscribeWithCoins: (...a: unknown[]) => mockSubscribe(...a),
    setPayoutAccount: jest.fn(),
    startStripeKyc: jest.fn(),
    startWebTopup: jest.fn(),
    creditHistory: async () => [],
    fetchPayoutAccount: async () => null,
    fetchWallet: async () => ({ balance: 5000, purchased: 0, bonus: 0, earned: 5000, earnedAvailable: 5000 }),
    listGifts: async () => [],
    myPayoutRequests: async () => [],
    receivedGifts: async () => [],
  };
});

const PAYOUT_OK = { status: 'paid', balance: 3000, amountEurCents: 6000 };
const GIFT = { id: 'g1', icon: '🌹', name: 'Rózsa', costCents: 100 } as never;

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<WalletCard />);
  });
  return view;
}
const cashout = (v: ReactTestRenderer) => v.root.findByType(CashoutSection).props;

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockRequestPayout.mockReset();
  mockSubscribe.mockReset();
  mockSendGift.mockReset();
  mockBuyDev.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

describe('WalletCard — dupla koppintás nem mozgat kétszer pénzt', () => {
  it('kifizetés: két koppintás ugyanabban a renderben → pontosan EGY requestPayout', async () => {
    const view = await mount();
    act(() => cashout(view).setPayoutCoins('20'));
    const d = deferred<typeof PAYOUT_OK>();
    mockRequestPayout.mockReturnValue(d.promise);
    const { onCashout } = cashout(view);
    await act(async () => {
      onCashout();
      onCashout(); // ugyanaz a render-kori closure: a busy itt még false
    });
    expect(mockRequestPayout).toHaveBeenCalledTimes(1);
    expect(mockRequestPayout).toHaveBeenCalledWith(2000);
    // a busy-UI változatlan: fut közben letiltva
    expect(cashout(view).busy).toBe(true);
    await act(async () => d.resolve(PAYOUT_OK));
    expect(cashout(view).busy).toBe(false);
  });

  it('kifizetés: siker után az új koppintás újra indít', async () => {
    const view = await mount();
    act(() => cashout(view).setPayoutCoins('20'));
    mockRequestPayout.mockResolvedValue(PAYOUT_OK);
    await act(async () => cashout(view).onCashout());
    act(() => cashout(view).setPayoutCoins('20'));
    await act(async () => cashout(view).onCashout());
    expect(mockRequestPayout).toHaveBeenCalledTimes(2);
  });

  it('kifizetés: hiba után a zár felenged, az új koppintás újra indít', async () => {
    const view = await mount();
    act(() => cashout(view).setPayoutCoins('20'));
    mockRequestPayout.mockRejectedValueOnce(new Error('hálózat')).mockResolvedValueOnce(PAYOUT_OK);
    await act(async () => cashout(view).onCashout());
    expect(alertSpy).toHaveBeenCalledWith('common.error', expect.any(String));
    expect(cashout(view).busy).toBe(false);
    await act(async () => cashout(view).onCashout());
    expect(mockRequestPayout).toHaveBeenCalledTimes(2);
  });

  it('előfizetés Coinból: dupla koppintás → EGY subscribeWithCoins', async () => {
    const view = await mount();
    const d = deferred<unknown>();
    mockSubscribe.mockReturnValue(d.promise);
    const { onSubscribe } = view.root.findByType(CoinSubscriptionSection).props;
    await act(async () => {
      onSubscribe();
      onSubscribe();
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ balance: 0, until: '2026-12-01T00:00:00Z', kind: 'start', credit: 0 }));
  });

  it('ajándék: két megerősítő gomb ugyanabban a renderben → EGY sendGift', async () => {
    const view = await mount();
    act(() => view.root.findByType(GiftSection).props.setSendTo('anna'));
    const d = deferred<unknown>();
    mockSendGift.mockReturnValue(d.promise);
    const { onPickGift } = view.root.findByType(GiftSection).props;
    act(() => {
      onPickGift(GIFT);
      onPickGift(GIFT); // két nyitva hagyott megerősítő
    });
    const sends = alertSpy.mock.calls.map((c) => (c[2] as { text: string; onPress?: () => void }[])[1]);
    await act(async () => {
      sends[0].onPress?.();
      sends[1].onPress?.();
    });
    expect(mockSendGift).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ balance: 4900 }));
  });

  it('dev-jóváírás: dupla koppintás → EGY buyCreditsDev', async () => {
    const view = await mount();
    const d = deferred<number>();
    mockBuyDev.mockReturnValue(d.promise);
    const { onBuyDev } = view.root.findByType(WalletBalanceSection).props;
    await act(async () => {
      onBuyDev(1);
      onBuyDev(1);
    });
    expect(mockBuyDev).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(5100));
  });
});
