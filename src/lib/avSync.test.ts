import { DRIFT_THRESHOLD_SEC, shouldResync, sourceTimeOf } from '@/lib/avSync';

/**
 * 🧱 CORE §2.6 — az A/V-szinkron MATEK headless tesztje (RN-render nélkül): a
 * forrás-idő (egységes seek-pont) és a drift-korrekciós küszöb.
 */

describe('sourceTimeOf — forrás-idő a klipen', () => {
  it('trimIn + (playhead - start)', () => {
    expect(sourceTimeOf({ start: 5, trimIn: 2 }, 8)).toBeCloseTo(5); // 2 + (8-5)
    expect(sourceTimeOf({ start: 0, trimIn: 0 }, 3)).toBeCloseTo(3);
    expect(sourceTimeOf({ start: 10 }, 12)).toBeCloseTo(2); // trimIn hiányzik = 0
  });
  it('a klip ELŐTTI playhead nem ad negatív forrás-időt (0-ra vágva)', () => {
    expect(sourceTimeOf({ start: 5, trimIn: 1 }, 2)).toBe(0);
  });
});

describe('shouldResync — drift-korrekció küszöbe', () => {
  it('a küszöb ALATT nincs resync', () => {
    expect(shouldResync(10, 10.1)).toBe(false); // 0.1 < 0.25
    expect(shouldResync(10, 10)).toBe(false);
  });
  it('a küszöb FÖLÖTT resync kell (mindkét irányban)', () => {
    expect(shouldResync(10, 10.4)).toBe(true); // +0.4
    expect(shouldResync(10, 9.5)).toBe(true); // -0.5
  });
  it('egyedi küszöb', () => {
    expect(shouldResync(10, 10.05, 0.01)).toBe(true);
    expect(shouldResync(10, 10.05, 0.1)).toBe(false);
  });
  it('az alap-küszöb ~¼ mp', () => {
    expect(DRIFT_THRESHOLD_SEC).toBeCloseTo(0.25);
  });
});
