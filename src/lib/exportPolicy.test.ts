import { exportPolicy } from '@/lib/exportPolicy';
import type { Tier } from '@/lib/tiers';

const TIERS: Tier[] = ['free', 'basic', 'pro', 'ultra'];

describe('exportPolicy', () => {
  it('felhő-render MINDIG mért + vízjel nélküli (minden tier)', () => {
    for (const tier of TIERS) {
      expect(exportPolicy(tier, 'cloud')).toEqual({ metered: true, watermark: false });
    }
  });

  it('on-device SOHA nem mért; vízjel CSAK a nem-fizető (free) tieren', () => {
    expect(exportPolicy('free', 'local')).toEqual({ metered: false, watermark: true });
    for (const tier of ['basic', 'pro', 'ultra'] as Tier[]) {
      expect(exportPolicy(tier, 'local')).toEqual({ metered: false, watermark: false });
    }
  });
});
