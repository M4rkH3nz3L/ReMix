/** 💡 nudgeUpsell (C2.3): a motor döntése a valódi paywall-store-t nyitja — munkamenetenként egyszer, „Most nem” után csend. */
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';
import { nudgeUpsell, useUpsell } from '@/store/upsellStore';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(() => {
  usePaywall.setState({ visible: false, capability: null, offer: null });
  useUpsell.setState({ sessionId: 's1', sessionShown: 0, dismissedAt: null, hydrated: true });
  useEntitlement.setState({ tier: 'free', proUntil: null, devPro: false });
});

describe('nudgeUpsell', () => {
  it('Free export után megnyitja a paywallt az Amatőr-ajánlattal, de csak egyszer munkamenetenként', async () => {
    await expect(nudgeUpsell('export_watermark', 'export_done')).resolves.toBe(true);
    expect(usePaywall.getState()).toMatchObject({ visible: true, offer: { tier: 'basic', trigger: 'export_watermark' } });
    usePaywall.setState({ visible: false });
    await expect(nudgeUpsell('long_export', 'export_done')).resolves.toBe(false);
    expect(usePaywall.getState().visible).toBe(false);
  });

  it('szerkesztő közben nem nyílik', async () => {
    await expect(nudgeUpsell('long_export', 'editor')).resolves.toBe(false);
  });

  it('„Most nem” után csend (új munkamenetben is)', async () => {
    useUpsell.getState().dismiss();
    useUpsell.setState({ sessionId: 's2', sessionShown: 0 });
    await expect(nudgeUpsell('winback', 'home')).resolves.toBe(false);
  });
});
