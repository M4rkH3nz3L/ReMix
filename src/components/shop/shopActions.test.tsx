/**
 * 💰 Dupla koppintás a boltban: két szinkron koppintás UGYANABBAN a renderben (a `busy` még
 * hamis) csak EGY vásárlást / publikálást / visszavonást indíthat; a művelet végén (siker és
 * hiba után is) az új koppintás újra működik, a busy-UI változatlan.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import ShopScreen from '@/app/shop';
import { PublishSheet } from '@/components/shop/PublishSheet';
import { BrowseCard, ListingCard } from '@/components/shop/ShopCards';
import { Chip } from '@/components/ui/controls';

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

const mockPurchase = jest.fn();
const mockUnpublish = jest.fn();
const mockLoadProject = jest.fn();
const mockPublish = jest.fn();

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
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: unknown }) => children }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn() }));
jest.mock('@/lib/webGate', () => ({ requireApp: () => true, requireSignIn: () => true }));
jest.mock('@/lib/storage', () => ({
  listProjects: async () => [],
  loadProject: (...a: unknown[]) => mockLoadProject(...a),
}));
jest.mock('@/lib/shop', () => {
  const ITEM = { id: 'i1', title: 'Sablon', priceCents: 100, kind: 'template', sellerId: 's', sellerName: 'S' };
  return {
    SHOP_KINDS: ['template'],
    InsufficientCreditsError: class extends Error {},
    creditBalance: async () => 1000,
    listShopItems: async () => [ITEM],
    myPurchases: async () => [],
    myListings: async () => [ITEM],
    getPayload: jest.fn(),
    importPayloadAsProject: jest.fn(),
    publishProjectAsItem: (...a: unknown[]) => mockPublish(...a),
    publishSoundPack: jest.fn(),
    purchaseItem: (...a: unknown[]) => mockPurchase(...a),
    storeSoundPack: () => false,
    unpublishItem: (...a: unknown[]) => mockUnpublish(...a),
  };
});

async function mount() {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<ShopScreen />);
  });
  return view;
}
const browse = (v: ReactTestRenderer) => v.root.findByType(BrowseCard).props;

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockPurchase.mockReset();
  mockUnpublish.mockReset();
  mockLoadProject.mockReset();
  mockPublish.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

describe('ShopScreen — dupla koppintás nem vásárol kétszer', () => {
  it('vásárlás: két koppintás ugyanabban a renderben → pontosan EGY purchaseItem', async () => {
    const view = await mount();
    const d = deferred<unknown>();
    mockPurchase.mockReturnValue(d.promise);
    const { onBuy, item } = browse(view);
    act(() => {
      onBuy(item);
      onBuy(item); // ugyanaz a render-kori closure: a busy itt még false
    });
    expect(mockPurchase).toHaveBeenCalledTimes(1);
    expect(browse(view).busy).toBe(true);
    await act(async () => d.resolve({ any: 1 }));
    expect(browse(view).busy).toBe(false);
  });

  it('vásárlás: siker és hiba után is újra lehet koppintani', async () => {
    const view = await mount();
    mockPurchase.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('hálózat')).mockResolvedValueOnce({});
    await act(async () => browse(view).onBuy(browse(view).item));
    await act(async () => browse(view).onBuy(browse(view).item));
    expect(alertSpy).toHaveBeenLastCalledWith('common.error', expect.any(String));
    await act(async () => browse(view).onBuy(browse(view).item));
    expect(mockPurchase).toHaveBeenCalledTimes(3);
  });

  it('publikálás: két koppintás ugyanabban a renderben → EGY publikálás', async () => {
    const view = await mount();
    const sheet = () => view.root.findByType(PublishSheet).props;
    act(() => {
      sheet().setPubProjectId('p1');
      sheet().setPubTitle('Új sablon');
    });
    const d = deferred<unknown>();
    mockLoadProject.mockReturnValue(d.promise);
    mockPublish.mockResolvedValue({ id: 'x' });
    const { doPublish } = sheet();
    act(() => {
      doPublish();
      doPublish();
    });
    expect(mockLoadProject).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ id: 'p1' }));
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(sheet().busy).toBe(false);
  });

  it('visszavonás: két megerősítés ugyanabban a renderben → EGY unpublishItem, utána újra megy', async () => {
    const view = await mount();
    const sellTab = view.root.findAll((n) => n.type === Chip && n.props.label === 'shop.tabSell')[0];
    await act(async () => sellTab.props.onPress());
    const { confirmUnpublish, item } = view.root.findByType(ListingCard).props;
    act(() => {
      confirmUnpublish(item);
      confirmUnpublish(item); // két nyitva hagyott megerősítő
    });
    const d = deferred<void>();
    mockUnpublish.mockReturnValue(d.promise);
    const destructive = alertSpy.mock.calls.map((c) => (c[2] as { onPress?: () => void }[])[1]);
    act(() => {
      destructive[0].onPress?.();
      destructive[1].onPress?.();
    });
    expect(mockUnpublish).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    mockUnpublish.mockRejectedValueOnce(new Error('hálózat')).mockResolvedValueOnce(undefined);
    await act(async () => destructive[0].onPress?.());
    await act(async () => destructive[0].onPress?.());
    expect(mockUnpublish).toHaveBeenCalledTimes(3);
  });
});
