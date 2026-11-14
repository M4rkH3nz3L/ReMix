import {
  cycleVelocity,
  DRUM_ACCENT,
  DRUM_SOFT,
  DRUM_VOICES,
  resizeVelocity,
  SWING_MAX,
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
import { renderDrumsPcm } from '@/lib/instrumentRender';

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

describe('🥁 velocity + swing (R7)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const server = require('../../server/drums.js') as { drumHitChains: (h: unknown[], o: object) => { chains: string[] } };
  const SR = 44100;
  const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const onset = (x: Float32Array) => x.findIndex((v) => Math.abs(v) > 1e-6);

  it('a velocity léptetése: normál → hangsúlyos → halk → normál; átméretezéskor vágva', () => {
    let v = cycleVelocity({}, 'kick', 3);
    expect(v.kick?.[3]).toBe(DRUM_ACCENT);
    v = cycleVelocity(v, 'kick', 3);
    expect(v.kick?.[3]).toBe(DRUM_SOFT);
    v = cycleVelocity(v, 'kick', 3);
    expect(v.kick?.[3]).toBeUndefined();
    expect(resizeVelocity({ kick: new Array(32).fill(64) }, 1).kick).toHaveLength(16);
  });

  it('a swing a páros 16-odokat (páratlan index) késlelteti, 60 %-ra vágva; a velocity átmegy', () => {
    let p = emptyPattern(1);
    for (const s of [0, 1, 2, 3]) p = toggleStep(p, 'hihat', s);
    const hits = patternHits(p, { hihat: [undefined, 64] }, 0.9);
    expect(hits.map((h) => h.step)).toEqual([0, 1 + SWING_MAX, 2, 3 + SWING_MAX]);
    expect(hits[1].velocity).toBe(64);
    expect(hits[0].velocity).toBeUndefined();
    expect(patternHits(p).map((h) => h.step)).toEqual([0, 1, 2, 3]);
  });

  it('mérve: a velocity a csúcsszintben, a swing a késésben (± 1 ms) — a szerver ugyanígy', () => {
    const one = (step: number, velocity?: number) => renderDrumsPcm([{ voice: 'hihat', step, velocity }], 1, 120)[0];
    const norm = peak(one(0));
    expect(peak(one(0, DRUM_ACCENT)) / norm).toBeCloseTo(1 / 0.9, 2);
    expect(peak(one(0, DRUM_SOFT)) / norm).toBeCloseTo(DRUM_SOFT / 127 / 0.9, 2);
    for (const sw of [0.2, 0.33, 0.6]) {
      const [h] = patternHits({ ...emptyPattern(1), hihat: emptyPattern(1).hihat.map((_, i) => i === 1) }, {}, sw);
      const lateMs = ((onset(one(h.step)) - onset(one(1))) / SR) * 1000;
      expect(Math.abs(lateMs - sw * 125)).toBeLessThanOrEqual(1);
      // a worker ugyanarra a ms-ra teszi (adelay) és ugyanazzal a szinttel (volume)
      const [chain] = server.drumHitChains([{ voice: 'hihat', step: h.step, velocity: 64 }], { bpm: 120, bars: 1 }).chains;
      const ms = Number(/adelay=(\d+)\|/.exec(chain)?.[1]);
      expect(Math.abs(ms - (125 + sw * 125))).toBeLessThanOrEqual(1);
      expect(chain).toContain(`volume=${(64 / 127).toFixed(3)}`);
    }
  });
});

// ── 🥁 S12 (MU3): 8 hang, a régi minta kiegészítése, beépített készletek ─────────────────────
import { DRUM_KITS, drumKit, normalizePattern, type DrumPattern } from '@/lib/drums';

describe('drums — S12: 8 hang, normalizálás, készletek', () => {
  it('8 hang: a régi négy + tom, rim, crash, perc; az üres minta minden hangra', () => {
    expect(DRUM_VOICES).toEqual(['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'crash', 'perc']);
    expect(Object.keys(emptyPattern(1))).toEqual(DRUM_VOICES);
  });

  it('normalizePattern: a 4 soros mentett minta a 8 hangra, a rács hosszára; a meglévő ütések maradnak', () => {
    const old = { kick: [true, false, false, false], snare: [false, false, true] } as unknown as DrumPattern;
    const p = normalizePattern(old, 1);
    expect(Object.keys(p)).toEqual(DRUM_VOICES);
    expect(p.kick.length).toBe(16);
    expect(p.kick[0]).toBe(true);
    expect(p.snare[2]).toBe(true);
    expect(p.tom.every((x) => x === false)).toBe(true);
    expect(normalizePattern(null, 2).crash.length).toBe(32);
  });

  it('drumKit: a három készlet; a House 4-on-floor + clap + offbeat hihat + perc, hangsúlyos kick; a Hip-hop swinggel, tom/rim; 2 ütemre ismételve', () => {
    expect(DRUM_KITS).toEqual(['basic', 'house', 'hiphop']);
    const house = drumKit('house', 1);
    expect(house.pattern.kick.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 12]);
    expect(house.pattern.clap.filter(Boolean).length).toBe(2);
    expect(house.pattern.hihat.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([2, 6, 10, 14]);
    expect(house.pattern.perc.filter(Boolean).length).toBe(2);
    expect(house.velocity.kick?.[0]).toBe(127);
    expect(house.swing).toBe(0);
    const hh = drumKit('hiphop', 2);
    expect(hh.swing).toBe(0.2);
    expect(hh.pattern.kick.length).toBe(32);
    expect(hh.pattern.kick.filter(Boolean).length).toBe(8); // 4 ütésenként, 2 ütem
    expect(hh.pattern.tom.map((x, i) => (x ? i : -1)).filter((i) => i >= 0)).toEqual([14, 30]);
    expect(hh.velocity.snare?.[4]).toBe(127);
    expect(hh.velocity.snare?.[20]).toBe(127);
    const basic = drumKit('basic', 1);
    expect(basic.pattern.hihat.filter(Boolean).length).toBe(8);
    expect(hasHits(basic.pattern)).toBe(true);
  });
});
