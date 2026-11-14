import { CRITICAL_STEP_MS, MAX_CRITICAL_PAUSE_MS, newThrottle, restAfterSlice, summarizePower, type PowerState } from '@/lib/thermalPolicy';

const p = (thermal: number, extra: Partial<PowerState> = {}): PowerState => ({ thermal, battery: 0.8, charging: false, lowPower: false, ...extra });

describe('thermalPolicy — S19 hő-alkalmazkodás', () => {
  test('névleges / emelkedett hő vagy ismeretlen állapot: nincs pihenő', () => {
    const st = newThrottle();
    expect(restAfterSlice(null, 12, st)).toBe(0);
    expect(restAfterSlice(p(0), 12, st)).toBe(0);
    expect(restAfterSlice(p(1), 12, st)).toBe(0);
  });

  test('súlyos hő: a munkával azonos pihenő (50% kitöltés)', () => {
    expect(restAfterSlice(p(2), 13.4, newThrottle())).toBe(13);
  });

  test('kritikus hő: lépésenkénti szünet, összesen legfeljebb a plafonig, utána a súlyos tempó', () => {
    const st = newThrottle();
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const r = restAfterSlice(p(3), 12, st);
      if (r === 12) {
        break;
      }
      expect(r).toBeLessThanOrEqual(CRITICAL_STEP_MS);
      total += r;
    }
    expect(total).toBe(MAX_CRITICAL_PAUSE_MS);
    expect(restAfterSlice(p(3), 12, st)).toBe(12);
  });

  test('összegzés: max hő, forró idő, akkumulátor-esés; töltés közben nincs esés-adat', () => {
    const s = [
      { atMs: 0, thermal: 0, battery: 0.9, charging: false, lowPower: false },
      { atMs: 2000, thermal: 2, battery: 0.89, charging: false, lowPower: false },
      { atMs: 4000, thermal: 1, battery: 0.875, charging: false, lowPower: false },
    ];
    expect(summarizePower(s, 500)).toEqual({ samples: 3, maxThermal: 2, hotMs: 2000, batteryDropPct: 2.5, restMs: 500 });
    expect(summarizePower(s.map((x) => ({ ...x, charging: true })), 0).batteryDropPct).toBeNull();
    expect(summarizePower([], 0)).toEqual({ samples: 0, maxThermal: 0, hotMs: 0, batteryDropPct: null, restMs: 0 });
  });
});
