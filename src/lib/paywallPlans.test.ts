import { compactAmount, planPrice, planRows, recommendedTier } from '@/lib/paywallPlans';
import { TIER_ORDER } from '@/lib/tiers';

describe('paywallPlans (C1.4)', () => {
  it('minden sorban mind az 5 szintnek van cellája', () => {
    for (const row of planRows()) {
      expect(Object.keys(row.cells).sort()).toEqual([...TIER_ORDER].sort());
    }
  });

  it('a Free a felhőből semmit nem kap, reklámos, vízjeles', () => {
    const rows = Object.fromEntries(planRows().map((r) => [r.label, r.cells]));
    expect(rows['paywallSheet.row.ads'].free).toEqual({ kind: 'bool', value: false });
    expect(rows['paywallSheet.row.watermark'].free).toEqual({ kind: 'bool', value: false });
    expect(rows['paywallSheet.row.cloudStorage'].free).toEqual({ kind: 'text', key: 'paywallSheet.cell.ownCloud', params: undefined });
    expect(rows['paywallSheet.row.ai'].free.kind === 'text' && rows['paywallSheet.row.ai'].free.key).toBe('paywallSheet.cell.onDeviceAi');
    expect(rows['paywallSheet.row.cloudStorage'].basic).toEqual({ kind: 'text', key: 'paywallSheet.cell.gb', params: { gb: 3 } });
    expect(rows['paywallSheet.row.ai'].ultra).toEqual({ kind: 'text', key: 'paywallSheet.amount.million', params: { n: 3 } });
  });

  it('árak: Coinban havi/éves, az áruházi euró, Vállalati fejenként', () => {
    expect(planPrice('basic', 'monthly')).toEqual({ coins: 2, storeEur: 11.99 });
    expect(planPrice('pro', 'annual')).toEqual({ coins: 40, storeEur: 239.99 });
    expect(planPrice('business', 'monthly')).toEqual({ coins: 10, storeEur: null });
  });

  it('a kiemelt szint a kiváltó képességből jön; alapból Amatőr', () => {
    expect(recommendedTier(null)).toBe('basic');
    expect(recommendedTier('localRender')).toBe('basic');
  });

  it('compactAmount', () => {
    expect(compactAmount(200000)).toEqual({ key: 'paywallSheet.amount.thousand', n: 200 });
    expect(compactAmount(3000000)).toEqual({ key: 'paywallSheet.amount.million', n: 3 });
  });
});
