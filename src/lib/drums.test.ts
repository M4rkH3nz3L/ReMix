import {
  DRUM_VOICES,
  STEPS_PER_BAR,
  emptyPattern,
  hasHits,
  hitTimeSec,
  patternDurationSec,
  patternHits,
  stepCount,
  stepSec,
  toggleStep,
} from '@/lib/drums';

describe('drums — step-sequencer mag', () => {
  it('stepSec: 120 BPM → 0.125s (16-od)', () => {
    expect(stepSec(120)).toBe(0.125);
    expect(stepSec(60)).toBe(0.25);
    expect(stepSec(0)).toBe(0.125); // default 120
  });

  it('stepCount / emptyPattern: bars × 16', () => {
    expect(stepCount(2)).toBe(32);
    const p = emptyPattern(1);
    expect(Object.keys(p).sort()).toEqual([...DRUM_VOICES].sort());
    expect(p.kick).toHaveLength(STEPS_PER_BAR);
    expect(p.kick.every((x) => x === false)).toBe(true);
  });

  it('toggleStep: be/ki, tartományon kívül no-op', () => {
    let p = emptyPattern(1);
    p = toggleStep(p, 'kick', 0);
    expect(p.kick[0]).toBe(true);
    p = toggleStep(p, 'kick', 0);
    expect(p.kick[0]).toBe(false);
    expect(toggleStep(p, 'kick', 999)).toBe(p); // no-op
  });

  it('patternHits: aktív cellák voice+step', () => {
    let p = emptyPattern(1);
    p = toggleStep(p, 'kick', 0);
    p = toggleStep(p, 'kick', 4);
    p = toggleStep(p, 'snare', 4);
    const hits = patternHits(p);
    expect(hits).toContainEqual({ voice: 'kick', step: 0 });
    expect(hits).toContainEqual({ voice: 'kick', step: 4 });
    expect(hits).toContainEqual({ voice: 'snare', step: 4 });
    expect(hits).toHaveLength(3);
  });

  it('hitTimeSec: 120 BPM → step 4 = 0.5s (egy beat)', () => {
    expect(hitTimeSec(0, 120)).toBe(0);
    expect(hitTimeSec(4, 120)).toBe(0.5);
    expect(hitTimeSec(8, 120)).toBe(1);
  });

  it('patternDurationSec: a teljes rács', () => {
    expect(patternDurationSec(1, 120)).toBe(2); // 16 × 0.125
    expect(patternDurationSec(2, 120)).toBe(4);
  });

  it('hasHits', () => {
    expect(hasHits(emptyPattern(1))).toBe(false);
    expect(hasHits(toggleStep(emptyPattern(1), 'hihat', 2))).toBe(true);
  });
});
