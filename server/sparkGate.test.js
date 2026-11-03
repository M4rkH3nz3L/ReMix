// 📏 Mérési kapu (C5.2): áteresztés-összegzés és önköltség-modell.
const { summarizeRuns, costModel, reportMarkdown } = require('./sparkGate');

test('summarizeRuns: token/s a falióra-időből, p50 / p95, hibák külön', () => {
  const runs = [
    { ok: true, ms: 1000, completionTokens: 200, totalTokens: 1000 },
    { ok: true, ms: 3000, completionTokens: 200, totalTokens: 1000 },
    { ok: false, ms: 50 },
  ];
  expect(summarizeRuns(runs, 2000)).toEqual({ requests: 3, failed: 1, outputTokensPerSec: 200, totalTokensPerSec: 1000, p50Ms: 3000, p95Ms: 3000 });
});

test('costModel: a legjobb párhuzamosság, az önköltség és a 3×-os ítélet', () => {
  const levels = { 1: { totalTokensPerSec: 100 }, 4: { totalTokensPerSec: 400 }, 8: { totalTokensPerSec: 380 } };
  const r = costModel(levels, { machineEur: 3600, months: 36, watts: 240, kwhEur: 0.3, networkEurMonth: 10, utilization: 0.6 });
  expect(r.bestConcurrency).toBe(4);
  expect(Math.round(r.tokensPerMonth)).toBe(622080000); // 400 × 2 592 000 × 0,6
  expect(r.monthlyEur.amortization).toBe(100);
  expect(r.monthlyEur.power).toBeCloseTo(51.84, 2); // 0,24 kW × 720 h × 0,3 €
  expect(r.costEurPer1M).toBeCloseTo(0.2602, 3); // (100 + 51,84 + 10) € / 622,08 M token
  expect(r.pass).toBe(true); // nettó 3,94 € / 1 M vs 0,26 € önköltség
  expect(r.maxSubscribersAtQuota(1000000)).toBe(622);
});

test('gyenge gépnél a kapu nem enged át (a keretet kell csökkenteni)', () => {
  const r = costModel({ 1: { totalTokensPerSec: 2 } }, { machineEur: 3600, months: 36, watts: 240, kwhEur: 0.3 });
  expect(r.pass).toBe(false);
});

test('a jegyzőkönyv a fő számokat tartalmazza', () => {
  const levels = { 4: { requests: 8, failed: 0, outputTokensPerSec: 50, totalTokensPerSec: 400, p50Ms: 900, p95Ms: 1500 } };
  const cost = { machineEur: 3600, months: 36, watts: 240, kwhEur: 0.3, networkEurMonth: 10 };
  const md = reportMarkdown({ when: '2026-11-04', url: 'http://spark/v1', model: 'm', levels, cost, result: costModel(levels, cost), quotas: { Amatőr: 200000 } });
  expect(md).toContain('| 4 | 8 | 0 | 50,0 | 400,0 | 900 | 1500 |');
  expect(md).toContain('✅ megfelel');
  expect(md).toContain('| Amatőr | 200');
});
