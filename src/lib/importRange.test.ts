import { clampImportRange } from './importRange';
import { MAX_PROJECT_DURATION_SEC } from './projectUtils';

describe('clampImportRange — YT/TikTok import -tól–-ig (TECH-TOP §6)', () => {
  test('érvényes tartomány forráson belül változatlan', () => {
    expect(clampImportRange(10, 40, 120)).toEqual({ fromSec: 10, toSec: 40, durationSec: 30 });
  });

  test('a 10 perc-plafon érvényesül (to = from + max)', () => {
    const r = clampImportRange(0, 10000, undefined); // ismeretlen forrás, túl hosszú
    expect(r.durationSec).toBe(MAX_PROJECT_DURATION_SEC);
    expect(r.toSec).toBe(MAX_PROJECT_DURATION_SEC);
  });

  test('to a forrás-hosszra vágódik', () => {
    expect(clampImportRange(100, 200, 150)).toEqual({ fromSec: 100, toSec: 150, durationSec: 50 });
  });

  test('to ≤ from → alap-ablak (from + max, forrásig)', () => {
    expect(clampImportRange(500, 100, Infinity)).toEqual({
      fromSec: 500,
      toSec: 500 + MAX_PROJECT_DURATION_SEC,
      durationSec: MAX_PROJECT_DURATION_SEC,
    });
  });

  test('ismeretlen forrás + nincs to → from..from+max', () => {
    const r = clampImportRange(30, NaN, undefined);
    expect(r).toEqual({ fromSec: 30, toSec: 30 + MAX_PROJECT_DURATION_SEC, durationSec: MAX_PROJECT_DURATION_SEC });
  });

  test('negatív from → 0; forráson túli from → reset 0', () => {
    expect(clampImportRange(-50, 20, 100).fromSec).toBe(0);
    expect(clampImportRange(200, 250, 100).fromSec).toBe(0); // 200 > 100 forrás → reset
  });

  test('egyedi max (pl. 60 mp)', () => {
    expect(clampImportRange(0, 300, undefined, 60).durationSec).toBe(60);
  });
});
