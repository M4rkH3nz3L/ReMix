import { formantCorrect } from '@/lib/formant';
import { offlineMixPlan, stretchJobs } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip } from '@/types/project';

/** 🗣️ V7.3: a formáns-korrekció — a tolt magánhangzó hangszíne visszaáll, a hangmagasság marad. */
const SR = 44100;

/** szintetikus magánhangzó: impulzussor `f0`-n két rezonátoron (formánsok) át, 1 s */
function vowel(f0: number, formants: number[]): Float32Array {
  const n = SR;
  const src = new Float64Array(n);
  for (let t = 0; t < n; t += SR / f0) src[Math.round(t)] = 1;
  let x = src;
  for (const f of formants) {
    const r = Math.exp((-Math.PI * 80) / SR);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    const a2 = -r * r;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + a1 * (y[i - 1] ?? 0) + a2 * (y[i - 2] ?? 0);
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return Float32Array.from(x, (v) => (0.5 * v) / peak);
}

/** a 250–3000 Hz-es sáv spektrális súlypontja (a formánsok helye) a jel közepéről */
function centroid(x: Float32Array): number {
  const n = 4096;
  const off = (x.length - n) >> 1;
  let num = 0;
  let den = 0;
  for (let k = Math.round((250 * n) / SR); k <= Math.round((3000 * n) / SR); k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += x[off + i] * w * Math.cos((2 * Math.PI * k * i) / n);
      im -= x[off + i] * w * Math.sin((2 * Math.PI * k * i) / n);
    }
    const p = re * re + im * im;
    num += p * ((k * SR) / n);
    den += p;
  }
  return num / den;
}

/** az alaphang autokorrelációval (80–500 Hz) */
function pitchOf(x: Float32Array): number {
  const off = 10000;
  const n = 8192;
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.round(SR / 500); lag <= Math.round(SR / 80); lag++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[off + i] * x[off + i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  return SR / bestLag;
}

describe('🗣️ V7.3 formantCorrect', () => {
  const ratio = 2 ** (5 / 12); // +5 félhang
  const ref = vowel(150, [700, 1200]);
  const naive = vowel(150 * ratio, [700 * ratio, 1200 * ratio]); // a naiv tolás a formánsokat is viszi
  const fixed = formantCorrect(ref, naive, SR);

  it('a naiv tolás a formánsokat is felviszi; a korrekció után a súlypont az eredetié (±7 %)', () => {
    const c0 = centroid(ref);
    const c1 = centroid(naive);
    const c2 = centroid(fixed);
    expect(c1 / c0).toBeGreaterThan(1.2);
    expect(Math.abs(c2 / c0 - 1)).toBeLessThan(0.07);
  });

  it('a hangmagasság a tolt marad (200 Hz ± 2 %)', () => {
    expect(Math.abs(pitchOf(fixed) / (150 * ratio) - 1)).toBeLessThan(0.02);
  });

  it('azonos burkolónál (nincs tolás) a jel érintetlen: a hiba −60 dB alatt; a hossz a tolt jelé', () => {
    const same = formantCorrect(ref, ref, SR);
    let e = 0;
    let s = 0;
    for (let i = 0; i < ref.length; i++) {
      e += (same[i] - ref[i]) ** 2;
      s += ref[i] ** 2;
    }
    expect(10 * Math.log10(e / s)).toBeLessThan(-60);
    expect(formantCorrect(ref, naive.subarray(0, 30000), SR).length).toBe(30000);
  });

  it('csendben nem robban (néma keret érintetlen, nincs NaN)', () => {
    const z = new Float32Array(10000);
    const out = formantCorrect(z, z, SR);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('a terv: bekapcsolt formánsnál a fő- és a harmónia-hang is formáns-feladat, külön kulccsal; 0 eltolásnál nincs', () => {
    const base = createEmptyProject('f', '9:16', undefined, 'audio');
    const clip = (fx: AudioClip['audioFx']): AudioClip => ({ kind: 'audio', id: 'c', label: 'c', uri: 'file:///v.wav', start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: fx });
    const jobsOf = (fx: AudioClip['audioFx']) => {
      const p = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip(fx)] } : t)) };
      return stretchJobs(offlineMixPlan(p)).jobs;
    };
    const on = jobsOf({ pitchSemitones: 5, harmony: 7, formant: true });
    expect(on.map((j) => [j.pitch, !!j.formant])).toEqual([[5, true], [12, true]]);
    expect(on.every((j) => j.key.endsWith('|fm'))).toBe(true);
    expect(jobsOf({ pitchSemitones: 5 }).map((j) => !!j.formant)).toEqual([false]);
    expect(jobsOf({ pitchSemitones: 0, formant: true })).toEqual([]);
  });
});

