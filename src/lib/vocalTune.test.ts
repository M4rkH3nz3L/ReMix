import { assembleShifted, harmonyPlan, noteSegments, pitchTrack, tunePlan } from '@/lib/vocalTune';
import type { MusicKey } from '@/lib/pitch';

/** 🎤 V3.2: ének-hangolás hangonként — felismerés, hangokra bontás, terv, összeillesztés. */
const SR = 44100;
const C: MusicKey = { root: 0, scale: 'major' };
/** énekszerű hang: alaphang + felharmonikusok, enyhe vibrato */
const voice = (hz: number, sec: number) => {
  let ph = 0;
  return Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => {
    // a vibrato (±0,3 %, 5 Hz) a fázis integrálásával
    ph += (2 * Math.PI * hz * (1 + 0.003 * Math.sin((2 * Math.PI * 5 * i) / SR))) / SR;
    return 0.3 * Math.sin(ph) + 0.15 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
  });
};
const concat = (...xs: Float32Array[]) => {
  const out = new Float32Array(xs.reduce((s, x) => s + x.length, 0));
  let at = 0;
  for (const x of xs) {
    out.set(x, at);
    at += x.length;
  }
  return out;
};

describe('🎤 ének-hangolás', () => {
  // E4 enyhén hamisan (+35 cent), szünet, G4 −40 cent, A3 pontosan
  const sung = concat(voice(329.63 * 2 ** (35 / 1200), 0.6), new Float32Array(Math.round(0.2 * SR)), voice(392 * 2 ** (-40 / 1200), 0.5), voice(220, 0.5));
  const frames = pitchTrack(sung, SR);
  const segs = noteSegments(frames);

  it('a hangmagasság-felismerés ±10 centen belül (a hangok belsejében)', () => {
    const at = (t: number) => frames.reduce((best, f) => (Math.abs(f.time - t) < Math.abs(best.time - t) ? f : best)).hz;
    const cents = (hz: number, want: number) => 1200 * Math.log2(hz / want);
    expect(Math.abs(cents(at(0.3), 329.63 * 2 ** (35 / 1200)))).toBeLessThan(10);
    expect(Math.abs(cents(at(1.05), 392 * 2 ** (-40 / 1200)))).toBeLessThan(10);
    expect(Math.abs(cents(at(1.55), 220))).toBeLessThan(10);
    expect(at(0.7)).toBe(0); // a szünet zöngétlen
  });

  it('három hang a helyén, a hamis hangok a skálára (−35, +40 cent), a tiszta kimarad', () => {
    expect(segs.length).toBe(3);
    expect(segs[0].start).toBeLessThan(0.1);
    expect(Math.abs(segs[1].start - 0.8)).toBeLessThan(0.08);
    const plan = tunePlan(segs, C, 1);
    expect(plan.length).toBe(2);
    expect(plan[0].cents).toBeGreaterThan(-45);
    expect(plan[0].cents).toBeLessThan(-25);
    expect(plan[1].cents).toBeGreaterThan(30);
    expect(plan[1].cents).toBeLessThan(50);
    expect(tunePlan(segs, C, 0.5)[0].cents).toBeCloseTo(plan[0].cents / 2, -1);
  });

  it('harmónia: a terc a hangnem szerint (E → G: +3 félhang, G → B: +4, A → C: +3), a hamisság is javítva', () => {
    const h = harmonyPlan(segs, C, 2);
    expect(h.length).toBe(3);
    expect(Math.abs(h[0].cents - (300 - 35))).toBeLessThan(10);
    expect(Math.abs(h[1].cents - (400 + 40))).toBeLessThan(10);
    expect(Math.abs(h[2].cents - 300)).toBeLessThan(10);
  });

  it('az összeillesztés: a darab belseje a tolt jel, a széleken egyenletes áttűnés, a darabon kívül az eredeti', () => {
    const base = [new Float32Array(1000).fill(0.5)];
    const piece = { start: 200, data: [new Float32Array(400).fill(-0.5)] };
    const [out] = assembleShifted(base, [piece], 50);
    expect(out[100]).toBe(0.5);
    expect(out[400]).toBe(-0.5);
    expect(out[700]).toBe(0.5);
    expect(out[200]).toBeGreaterThan(0.4);
    expect(Math.abs(out[225])).toBeLessThan(0.5);
  });
});
