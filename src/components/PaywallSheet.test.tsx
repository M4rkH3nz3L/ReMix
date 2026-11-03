/** 💳 Paywall v2 (C1.4): 5 szint a táblában, havi/éves ár, a Coin-gomb a kiválasztott szintet veszi, a próba csak ha elérhető. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { PaywallSheet } from '@/components/PaywallSheet';
import { usePaywall } from '@/store/paywallStore';

const mockSubscribe = jest.fn(async () => ({ balance: 0, until: '2026-12-03T00:00:00Z', kind: 'start', cost: 200, credit: 0 }));
const mockStartTrial = jest.fn(async () => ({ until: '2026-11-10T00:00:00Z' }));
let mockTrialAvailable = true;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children: unknown }) => children }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/billing', () => ({
  activateProDev: jest.fn(async () => true),
  billingClientAvailable: () => false,
  purchaseTier: jest.fn(),
  PurchaseCancelledError: class extends Error {},
  restorePurchases: jest.fn(),
}));
jest.mock('@/lib/wallet', () => ({
  ManagedByStoreError: class extends Error {},
  fetchSubscription: async () => ({ trialAvailable: mockTrialAvailable }),
  startTrial: (...a: unknown[]) => mockStartTrial(...(a as [])),
  subscribeWithCoins: (...a: unknown[]) => mockSubscribe(...(a as [])),
}));
jest.mock('@/lib/shop', () => ({ InsufficientCreditsError: class extends Error {} }));

const texts = (v: ReactTestRenderer) => v.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));
const press = (v: ReactTestRenderer, startsWith: string) =>
  act(async () => {
    const node = v.root.findAll((n) => typeof n.props.onPress === 'function' && texts({ root: n } as never).some((s) => s.startsWith(startsWith)))[0];
    await node.props.onPress();
  });

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    usePaywall.getState().open();
    view = create(<PaywallSheet />);
  });
  return view;
}

beforeEach(() => {
  mockSubscribe.mockClear();
  mockStartTrial.mockClear();
  mockTrialAvailable = true;
});

describe('PaywallSheet v2', () => {
  it('mind az 5 szint oszlopa és az összehasonlító sorok megjelennek', async () => {
    const all = texts(await mount());
    for (const tier of ['free', 'basic', 'pro', 'ultra', 'business']) {
      expect(all).toContain(`lib.tiers.label.${tier}`);
    }
    expect(all).toContain('paywallSheet.row.cloudStorage');
    expect(all).toContain('paywallSheet.cell.gb:{"gb":25}');
  });

  it('alapból az Amatőr van kiemelve, a Coin-gomb azt veszi havonta', async () => {
    const v = await mount();
    await press(v, 'paywallSheet.payCoins');
    expect(mockSubscribe).toHaveBeenCalledWith('basic', 1);
  });

  it('éves + Profi: 80 Coin, 12 hónapra', async () => {
    const v = await mount();
    await press(v, 'paywallSheet.annualGift');
    await press(v, 'lib.tiers.label.ultra');
    expect(texts(v)).toContain('80 🪙');
    await press(v, 'paywallSheet.payCoins');
    expect(mockSubscribe).toHaveBeenCalledWith('ultra', 12);
  });

  it('a próba gomb csak akkor látszik, ha még elérhető', async () => {
    const v = await mount();
    await press(v, 'paywallSheet.trialCta');
    expect(mockStartTrial).toHaveBeenCalled();
    mockTrialAvailable = false;
    expect(texts(await mount())).not.toContain('paywallSheet.trialCta');
  });
});
