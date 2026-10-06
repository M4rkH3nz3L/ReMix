import { nearQuota, usageStatus } from '@/lib/usageClient';
import { TIER_QUOTAS } from '@/lib/usageMeter';

describe('usageStatus (audit §2.2)', () => {
  it('minden metrikára used/limit/remaining/ratio', () => {
    const st = usageStatus({ aiTokens: 10000, cloudJobs: 5 }, 'free');
    const ai = st.find((s) => s.metric === 'aiTokens')!;
    expect(ai).toMatchObject({ used: 10000, limit: TIER_QUOTAS.free.aiTokens, remaining: 10000 });
    expect(ai.ratio).toBeCloseTo(0.5); // 10000 / 20000
    const jobs = st.find((s) => s.metric === 'cloudJobs')!;
    expect(jobs).toMatchObject({ used: 5, limit: 25, remaining: 20 });
  });

  it('korlátlan (ultra) → ratio 0, remaining Infinity', () => {
    const st = usageStatus({ aiTokens: 1e9 }, 'ultra');
    const ai = st.find((s) => s.metric === 'aiTokens')!;
    expect(ai.ratio).toBe(0);
    expect(ai.remaining).toBe(Infinity);
  });

  it('hiányzó metrika → used 0', () => {
    const st = usageStatus({}, 'free');
    expect(st.every((s) => s.used === 0)).toBe(true);
  });
});

describe('nearQuota — soft-warn', () => {
  it('a 80%+-ot elérő (korlátos) metrikák', () => {
    // free aiTokens limit 20000 → 16500 = 82.5% → warn; cloudJobs 5/25 = 20% → nem
    const warned = nearQuota({ aiTokens: 16500, cloudJobs: 5 }, 'free');
    expect(warned.map((s) => s.metric)).toEqual(['aiTokens']);
  });
  it('korlátlan sosem warn', () => {
    expect(nearQuota({ aiTokens: 1e9 }, 'ultra')).toEqual([]);
  });
  it('állítható küszöb', () => {
    expect(nearQuota({ cloudJobs: 13 }, 'free', 0.5).map((s) => s.metric)).toEqual(['cloudJobs']); // 13/25=52%
  });
});
