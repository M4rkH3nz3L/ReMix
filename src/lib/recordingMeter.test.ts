import { HOT_DB, meterLevel, nextHot, recordingClock } from './recordingMeter';

describe('recordingMeter', () => {
  it('dBFS → 0–1 kijelző (−60…0), csend és hiány 0', () => {
    expect(meterLevel(0)).toBe(1);
    expect(meterLevel(-30)).toBeCloseTo(0.5);
    expect(meterLevel(-60)).toBe(0);
    expect(meterLevel(-160)).toBe(0);
    expect(meterLevel(null)).toBe(0);
    expect(meterLevel(undefined)).toBe(0);
    expect(meterLevel(Number.NaN)).toBe(0);
    expect(meterLevel(3)).toBe(1);
  });
  it('a „túl hangos” jelzés a küszöbnél bekapcsol és megmarad', () => {
    expect(nextHot(false, HOT_DB - 0.1)).toBe(false);
    expect(nextHot(false, HOT_DB)).toBe(true);
    expect(nextHot(true, -50)).toBe(true);
    expect(nextHot(false, null)).toBe(false);
  });
  it('felvételi idő mm:ss', () => {
    expect(recordingClock(0)).toBe('0:00');
    expect(recordingClock(61_900)).toBe('1:01');
  });
});
