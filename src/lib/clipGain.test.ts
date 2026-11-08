import { CLIP_VOLUME_MAX, dbToVolume, formatDb, volumeToDb } from './clipGain';

describe('clipGain', () => {
  it('+6 dB = ×1,9953; +12 dB a teteje; 0 dB = 1', () => {
    expect(dbToVolume(6)).toBeCloseTo(1.99526, 4);
    expect(dbToVolume(20)).toBeCloseTo(CLIP_VOLUME_MAX, 9);
    expect(CLIP_VOLUME_MAX).toBeCloseTo(3.98107, 4);
    expect(dbToVolume(0)).toBe(1);
  });
  it('0 dB körül a csúszka rápattan; −60 dB = néma', () => {
    expect(dbToVolume(0.2)).toBe(1);
    expect(dbToVolume(-0.25)).toBe(1);
    expect(dbToVolume(-60)).toBe(0);
  });
  it('oda-vissza: a régi (0–1) hangerők változatlanok', () => {
    for (const v of [1, 0.8, 0.5, 0.1, 0.01]) expect(dbToVolume(volumeToDb(v))).toBeCloseTo(v, 9);
    expect(volumeToDb(0)).toBe(-60);
  });
  it('felirat', () => {
    expect(formatDb(0)).toBe('−∞ dB');
    expect(formatDb(1)).toBe('0.0 dB');
    expect(formatDb(dbToVolume(6))).toBe('+6.0 dB');
    expect(formatDb(0.5)).toBe('−6.0 dB');
  });
});
