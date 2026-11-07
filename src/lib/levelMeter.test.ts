import { CLIP_LEVEL, clipRanges, levelDb, meterFill, trackLevelAt } from '@/lib/levelMeter';
import type { OfflineMixClip } from '@/lib/offlineMix';
import type { WaveformData } from '@/lib/waveform';

const wave: WaveformData = { duration: 4, peaksPerSecond: 2, peaks: [0.1, 0.2, 0.5, 0.5, 0.8, 0.8, 0.2, 0.2] };
const clip = (over: Partial<OfflineMixClip> = {}): OfflineMixClip => ({
  id: 'c', track: 'music', uri: 'u', start: 1, duration: 2, trimIn: 1, volume: 0.5, fadeIn: 0, fadeOut: 0, pan: 0, gain: 1, speed: 1, reversed: false, ...over,
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

describe('clipRanges — túlvezérlés-pontok', () => {
  // 0–1 mp halk (0.4), 1–2 mp hangos (0.9); két egymásra tett klip → 1–2 mp között 1.8
  const w: WaveformData = { duration: 3, peaksPerSecond: 4, peaks: [0.4, 0.4, 0.4, 0.4, 0.9, 0.9, 0.9, 0.9, 0.4, 0.4, 0.4, 0.4] };
  const c = (id: string): OfflineMixClip => ({ id, track: 'music', uri: id, start: 0, duration: 3, trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, pan: 0, gain: 1, speed: 1, reversed: false });

  it('csak a túlvezérelt szakaszt jelöli, összevonva', () => {
    const r = clipRanges([c('a'), c('b')], () => w, 3, 0.25);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(1, 5);
    expect(r[0].end).toBeCloseTo(2, 5);
  });

  it('tiszta mixnél nincs jelölés', () => {
    expect(clipRanges([c('a')], () => w, 3, 0.25)).toEqual([]);
  });
});


describe('⏩⏪ trackLevelAt gyorsított és megfordított szakasszal', () => {
  it('2×: a forrásban kétszer annyit lép; megfordítva a végéről olvas', () => {
    // a forrás 1 mp-enként: 0.1/0.2 · 0.5/0.5 · 0.8/0.8 · 0.2/0.2 (2 csúcs/mp)
    const fast = clip({ start: 0, duration: 1, trimIn: 0, speed: 2, volume: 1 });
    expect(trackLevelAt([fast], waveOf, 0.75)).toBeCloseTo(0.5); // forrás 1,5 mp
    const back = clip({ start: 0, duration: 2, trimIn: 1, speed: 1, reversed: true, volume: 1 });
    expect(trackLevelAt([back], waveOf, 0.25)).toBeCloseTo(0.8); // a vége felől: forrás 1 + 1,75 = 2,75 mp
    expect(trackLevelAt([back], waveOf, 1.75)).toBeCloseTo(0.5); // forrás 1 + 0,25 = 1,25 mp
  });
});
