import { nearQuota, usageStatus } from '@/lib/usageClient';
import { TIER_QUOTAS } from '@/lib/usageMeter';

describe('usageStatus (audit §2.2)', () => {
  it('minden metrikára used/limit/remaining/ratio', () => {
    const st = usageStatus({ aiTokens: 100000, cloudJobs: 5 }, 'basic');
    const ai = st.find((s) => s.metric === 'aiTokens')!;
    expect(ai).toMatchObject({ used: 100000, limit: TIER_QUOTAS.basic.aiTokens, remaining: 100000 });
    expect(ai.ratio).toBeCloseTo(0.5); // 100000 / 200000
    const jobs = st.find((s) => s.metric === 'cloudJobs')!;
    expect(jobs).toMatchObject({ used: 5, limit: 150, remaining: 145 });
  });

  it('korlátlan (ultra exports) → ratio 0, remaining Infinity', () => {
    const st = usageStatus({ exports: 1e9 }, 'ultra');
    const ai = st.find((s) => s.metric === 'exports')!;
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
    // basic aiTokens limit 200000 → 165000 = 82.5% → warn; cloudJobs 5/150 → nem
    const warned = nearQuota({ aiTokens: 165000, cloudJobs: 5 }, 'basic');
    expect(warned.map((s) => s.metric)).toEqual(['aiTokens']);
  });
  it('korlátlan sosem warn', () => {
    expect(nearQuota({ exports: 1e9 }, 'ultra')).toEqual([]);
  });
  it('a 0-s keret (Free AI/render) nem ad hamis figyelmeztetést', () => {
    expect(nearQuota({}, 'free').map((s) => s.metric)).toEqual([]);
  });
  it('állítható küszöb', () => {
    expect(nearQuota({ cloudJobs: 13 }, 'free', 0.5).map((s) => s.metric)).toEqual(['cloudJobs']); // 13/25=52%
  });
});
