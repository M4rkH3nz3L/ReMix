import { CLIP_LEVEL, levelDb, meterFill, trackLevelAt } from '@/lib/levelMeter';
import type { OfflineMixClip } from '@/lib/offlineMix';
import type { WaveformData } from '@/lib/waveform';

const wave: WaveformData = { duration: 4, peaksPerSecond: 2, peaks: [0.1, 0.2, 0.5, 0.5, 0.8, 0.8, 0.2, 0.2] };
const clip = (over: Partial<OfflineMixClip> = {}): OfflineMixClip => ({
  track: 'music', uri: 'u', start: 1, duration: 2, trimIn: 1, volume: 0.5, fadeIn: 0, fadeOut: 0, pan: 0, gain: 1, ...over,
});
const waveOf = () => wave;

describe('trackLevelAt (PRO-AUDIO 17/8)', () => {
  it('a forrás csúcsa a vágott ablakból × a klip hangereje', () => {
    // t = 1.5 → forrás 1.5 mp → peaks[3] = 0.5; × 0.5 hangerő
    expect(trackLevelAt([clip()], waveOf, 1.5)).toBeCloseTo(0.25, 5);
  });

  it('a klipen kívül csend, ismeretlen hullámforma = csend', () => {
    expect(trackLevelAt([clip()], waveOf, 0.5)).toBe(0);
    expect(trackLevelAt([clip()], () => null, 1.5)).toBe(0);
  });

  it('a sáv- és master-erősítés és a fade is számít (mint az exportban)', () => {
    expect(trackLevelAt([clip({ gain: 0.5 })], waveOf, 1.5)).toBeCloseTo(0.125, 5);
    expect(trackLevelAt([clip({ fadeIn: 1 })], waveOf, 1.5)).toBeCloseTo(0.125, 5);
  });

  it('az átfedő klipek összeadódnak: a túlvezérlés nem marad rejtve', () => {
    const loud = clip({ volume: 1, trimIn: 2 });
    expect(trackLevelAt([loud, loud], waveOf, 1.5)).toBeGreaterThanOrEqual(CLIP_LEVEL);
  });
});

describe('levelDb / meterFill', () => {
  it('0 dBFS = teli, −60 alatt üres, a csend nem −∞', () => {
    expect(meterFill(1)).toBe(1);
    expect(meterFill(2)).toBe(1);
    expect(meterFill(0)).toBe(0);
    expect(levelDb(0)).toBe(-60);
    expect(levelDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(meterFill(0.5)).toBeCloseTo((60 - 6.02) / 60, 2);
  });
});
