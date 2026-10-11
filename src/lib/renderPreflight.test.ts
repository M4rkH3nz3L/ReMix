import { cloudRenderBlocked, type RenderHealth } from '@/lib/renderPreflight';

// ☁️ A felhő-render preflight (ne ragadjon 25%-on, ha nincs worker) pure pajzsa.

const h = (over: Partial<RenderHealth>): RenderHealth => ({ render: 'cloud+local', cloudRenderMinSec: 15, workers: 1, ...over });

describe('cloudRenderBlocked', () => {
  it('hosszú videó + van felhő-mód + NINCS worker → blokkol', () => {
    expect(cloudRenderBlocked(h({ workers: 0 }), 30)).toBe(true);
  });

  it('hosszú videó + van worker → nem blokkol', () => {
    expect(cloudRenderBlocked(h({ workers: 2 }), 30)).toBe(false);
  });

  it('RÖVID videó (küszöb alatt) → nem blokkol, akkor sem ha nincs worker (lokálisan renderel)', () => {
    expect(cloudRenderBlocked(h({ workers: 0 }), 10)).toBe(false);
  });

  it('nincs felhő-mód (csak lokális) → sosem blokkol', () => {
    expect(cloudRenderBlocked(h({ render: 'local', workers: 0 }), 30)).toBe(false);
  });

  it('a `workers` mező HIÁNYA (régi szerver) → nem blokkol (a szerver-gate a backstop)', () => {
    expect(cloudRenderBlocked({ render: 'cloud+local', cloudRenderMinSec: 15 }, 30)).toBe(false);
  });

  it('a küszöb a health-ből jön (pl. 20 mp)', () => {
    expect(cloudRenderBlocked(h({ cloudRenderMinSec: 20, workers: 0 }), 18)).toBe(false); // 18 ≤ 20 → lokális
    expect(cloudRenderBlocked(h({ cloudRenderMinSec: 20, workers: 0 }), 25)).toBe(true); // 25 > 20 → queue, nincs worker
  });
});
