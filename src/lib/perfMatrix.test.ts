import { MATRIX_HEADER, matrixRow, upsertMatrixRow, type PerfResult } from '@/lib/perfMatrix';

const r = (device: string, extra: Partial<PerfResult> = {}): PerfResult => ({
  date: '2026-11-14',
  device,
  os: 'iPadOS 26.1',
  engine: { chunks: 32, late: 0, avgMixMs: 3.25, maxMixMs: 9.4 },
  exportRun: { tracks: 8, sec: 60, ms: 4000 },
  longSourceMs: 41.6,
  denoise60Ms: 700,
  formant10Ms: 55.2,
  maxThermal: 0,
  ...extra,
});

describe('perfMatrix — V13 eszközmátrix', () => {
  test('a sor magyar tizedesvesszővel, a mértékegységekkel', () => {
    expect(matrixRow(r('iPad M1'))).toBe('| 2026-11-14 | iPad M1 | iPadOS 26.1 | 3,3 / 9 ms (0/32) | 8 sáv × 60 s: 15,0× valós idő | 42 ms | 7,0 s | 55 ms | 0 |');
    expect(matrixRow(r('x', { maxThermal: -1, engine: { chunks: 0, late: 0, avgMixMs: 9, maxMixMs: 0 } }))).toContain('| 0,0 / 0 ms (0/0) |');
    expect(matrixRow(r('x', { maxThermal: -1 }))).toMatch(/\| \? \|$/);
  });

  test('upsert: hiányzó táblázat → fejléccel a végére; új eszköz → hozzáfűz; meglévő → csere', () => {
    let md = '# Terv\n\nszöveg\n';
    md = upsertMatrixRow(md, matrixRow(r('iPad M1')));
    expect(md).toContain(`${MATRIX_HEADER}\n| 2026-11-14 | iPad M1 |`);
    md = upsertMatrixRow(md, matrixRow(r('iPhone 17 Pro Max')));
    md = upsertMatrixRow(md, matrixRow(r('iPad M1', { date: '2026-12-01' })));
    const rows = md.split('\n').filter((l) => l.startsWith('| 20'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('2026-12-01 | iPad M1');
    expect(rows[1]).toContain('iPhone 17 Pro Max');
  });

  test('a táblázat utáni szöveg érintetlen marad', () => {
    const md = upsertMatrixRow(`${MATRIX_HEADER}\n${matrixRow(r('A'))}\n\nutána`, matrixRow(r('B')));
    expect(md.endsWith('\n\nutána')).toBe(true);
    expect(md.split('\n').filter((l) => l.startsWith('| 20'))).toHaveLength(2);
  });
});
