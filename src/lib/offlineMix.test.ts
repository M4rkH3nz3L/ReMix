import { clipGainAt, encodeWav16, mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, panGains, stretchJobs, withNormalizeGains, crossfades, type DecodedSource } from '@/lib/offlineMix';
import { integratedLoudness } from '@/lib/loudness';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const SR = OFFLINE_SAMPLE_RATE;
const clip = (over: Partial<AudioClip> = {}): AudioClip =>
  ({ kind: 'audio', id: 'c', uri: 'u', label: 'c', start: 0, duration: 1, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
const project = (clips: AudioClip[], extra: Partial<Project> = {}): Project => {
  const p = createEmptyProject('t', '1:1', undefined, 'audio');
  return { ...p, ...extra, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips } : t)) };
};
const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i / n);
const mix = (p: Project, src: Float32Array[]) => {
  const plan = offlineMixPlan(p);
  const n = Math.round(plan.duration * SR);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  mixRange(plan, new Map([['u', { channels: src, sampleRate: SR }]]), out, 0, n);
  return out;
};

describe('offlineMix (A26)', () => {
  it('a forrás-ablak a trimIn-től indul, a klip a start-jára kerül', () => {
    const src = ramp(2 * SR);
    const [l] = mix(project([clip({ start: 0.5, trimIn: 1, duration: 0.5 })]), [src, src]);
    // a mikro-fade (10 ms) után mérve
    expect(l[Math.round(0.5 * SR) + 1000]).toBeCloseTo(src[SR + 1000], 5);
    expect(l[Math.round(0.25 * SR)]).toBe(0);
  });

  it('a lineáris balansz a szerver törvénye: teljes bal pannál a jobb néma, a bal teljes', () => {
    expect(panGains(-1)).toEqual([1, 0]);
    expect(panGains(0.5)).toEqual([0.5, 1]);
    const one = new Float32Array(SR).fill(0.5);
    const [l, r] = mix(project([clip({ pan: -1 })]), [one, one]);
    expect(l[1000]).toBeCloseTo(0.5, 5);
    expect(r[1000]).toBe(0);
  });

  it('fade be és ki szorzatként, a hangerő- és sáv-erősítés szorzódik', () => {
    const c = { ...offlineMixPlan(project([clip({ fadeIn: 0.5, fadeOut: 0.5, volume: 0.8 })], { trackMix: { music: { gain: 0.5 } } })).clips[0] };
    expect(clipGainAt(c, 0)).toBe(0);
    expect(clipGainAt(c, 0.25)).toBeCloseTo(0.8 * 0.5 * 0.5 * 1, 5);
    expect(clipGainAt(c, 0.5)).toBeCloseTo(0.4 * 1 * 1, 5);
  });

  it('a hangerő-automáció az élő lejátszó görbéjét követi', () => {
    const c = offlineMixPlan(project([clip({ keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' }] } as AudioClip['keyframes'] })])).clips[0];
    expect(clipGainAt(c, 0.5)).toBeCloseTo(0.5, 5);
  });

  it('két klip összeadódik, normalizálás nélkül (mint az amix normalize=0)', () => {
    const one = new Float32Array(SR).fill(0.25);
    const [l] = mix(project([clip({ id: 'a' }), clip({ id: 'b' })]), [one, one]);
    expect(l[1000]).toBeCloseTo(0.5, 5);
  });

  it('a szerveres effektek listázódnak, hogy a felület szólhasson', () => {
    const plan = offlineMixPlan(project([clip({ voiceEnhance: true, audioFx: { highpass: 80, denoise: true } })], { audioMaster: { target: 'podcast', lufs: -16, truePeak: -1.5, dynamics: 'balanced' } }));
    // a klip-effektek, a hangjavítás és a master is a közös DSP-ben van
    expect(plan.unsupported).toEqual([]);
    expect(plan.master?.target).toBe('podcast');
    // a hangjavítás csomagja: 75 Hz, zajszűrés, de-esser, kompresszor, −16 LUFS
    expect(plan.clips[0].fx).toMatchObject({ highpass: 80, denoise: true, deEsser: true, compressor: true, normalize: true });
  });

  it('🎛️ a szűrők és az EQ már a közös DSP-ben szólnak (nem „csak szerveres”)', () => {
    const plan = offlineMixPlan(project([clip({ audioFx: { highpass: 80, lowpass: 9000, eq: { low: 2, mid: 0, high: -1 } } })]));
    expect(plan.unsupported).toEqual([]);
    expect(plan.clips[0].fx).toEqual({ highpass: 80, lowpass: 9000, eq: { low: 2, mid: 0, high: -1 } });
  });

  it('a WAV-fejléc és a minták helyesek (dither nélkül pontos)', () => {
    const wav = encodeWav16([Float32Array.from([0, 0.5, -1]), Float32Array.from([1, 0, 0])], 44100, () => 0.5);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(52, true)]).toEqual([0, 32767, 16384, -32767]);
  });

  it('🎧 előnézet = export: a 125 ms-os és a 250 ms-os szeletelés minden effekttel mintára azonos', () => {
    const SR = 44100;
    const n = 3 * SR;
    const tone = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * (i % 30000 < 9000 ? 7000 : 180) * i) / SR) * (i % 40000 < 20000 ? 0.9 : 0.03));
    const p = project([clip({ duration: 2.5, sourceDuration: 3, audioFx: { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, limiter: true } })]);
    const plan = offlineMixPlan(p);
    expect(plan.unsupported).toEqual([]);
    const sources = new Map([[plan.clips[0].uri, { channels: [tone], sampleRate: SR }]]);
    const render = (chunk: number) => {
      const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
      const state = new Map();
      for (let a = 0; a < n; a += chunk) {
        const b = Math.min(n, a + chunk);
        const part: [Float32Array, Float32Array] = [new Float32Array(b - a), new Float32Array(b - a)];
        mixRange(plan, sources, part, a, b, 1, state);
        out[0].set(part[0], a);
        out[1].set(part[1], a);
      }
      return out;
    };
    const preview = render(5512);
    const exported = render(11025);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(preview[0][i] - exported[0][i]), Math.abs(preview[1][i] - exported[1][i]));
    expect(maxDiff).toBeLessThan(1e-6);
    expect(preview[0].some((v) => v !== 0)).toBe(true);
  });

  it('🎚️🎵 hangmagasság és harmónia: a harmónia második hang (0,7×, a felhasználói fade-ekkel), ±12-re szorítva', () => {
    const p = project([clip({ id: 'h', fadeIn: 0.3, fadeOut: 0.4, volume: 0.8, audioFx: { pitchSemitones: 3, harmony: 7 } })]);
    const plan = offlineMixPlan(p);
    expect(plan.unsupported).toEqual([]);
    const [main, harm] = plan.clips;
    expect(main).toMatchObject({ id: 'h', pitch: 3, volume: 0.8 });
    expect(harm).toMatchObject({ id: 'h#harmonia', pitch: 10, fadeIn: 0.3, fadeOut: 0.4 });
    expect(harm.volume).toBeCloseTo(0.56);
    const clamped = offlineMixPlan(project([clip({ id: 'x', audioFx: { pitchSemitones: 10, harmony: 7 } })])).clips[1];
    expect(clamped.pitch).toBe(12);
    const { jobs } = stretchJobs(plan);
    expect(jobs.map((j) => j.pitch).sort((a, b) => a - b)).toEqual([3, 10]);
  });

  it('📏 normalizálás: a halk klip −16 LUFS-re kerül, a csúcs −1,5 dB alatt marad', () => {
    const SR = 44100;
    let seed = 1;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    const n = 4 * SR;
    const quiet = Float32Array.from({ length: n }, () => 0.02 * rnd());
    const p = project([clip({ id: 'n', start: 0, duration: 4, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { normalize: true } })]);
    const base = offlineMixPlan(p);
    expect(base.unsupported).toEqual([]);
    const sources = new Map([[base.clips[0].uri, { channels: [quiet], sampleRate: SR }]]);
    const plan = withNormalizeGains(base, sources);
    expect(plan.clips[0].normGain).toBeGreaterThan(1);
    const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    mixRange(plan, sources, out, 0, n, 1, new Map());
    // a klip széleinek 10 ms-os mikro-fade-je elhanyagolható a 4 s-hoz képest
    expect(integratedLoudness(out[0], out[1], SR)).toBeCloseTo(-16, 0);
    const peak = out[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(20 * Math.log10(peak)).toBeLessThanOrEqual(-1.5 + 1e-3);
  });

  it('🎧 szakaszos (hosszú) forrás: a keverés mintára azonos a teljes forráséval — effektekkel, szeletenként', () => {
    const SR = 44100;
    const n = 6 * SR;
    const tone = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / SR) * (i % 30000 < 15000 ? 0.8 : 0.05));
    const p = project([clip({ start: 0.5, duration: 4, trimIn: 1, sourceDuration: 6, audioFx: { highpass: 90, compressor: true, reverb: 0.3 } })]);
    const plan = offlineMixPlan(p);
    const uri = plan.clips[0].uri;
    const full = new Map<string, DecodedSource>([[uri, { channels: [tone], sampleRate: SR }]]);
    const reads: number[] = [];
    const seg = new Map<string, DecodedSource>([[uri, { channels: [] as Float32Array[], sampleRate: SR, segmented: { read: (from: number, to: number) => {
      reads.push(to - from);
      const out = new Float32Array(to - from);
      for (let i = from; i < to; i++) if (i >= 0 && i < n) out[i - from] = tone[i];
      return [out];
    } } }]]);
    const render = (sources: typeof full, chunk: number) => {
      const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
      const st = new Map();
      for (let a = 0; a < n; a += chunk) {
        const b = Math.min(n, a + chunk);
        const part: [Float32Array, Float32Array] = [out[0].subarray(a, b), out[1].subarray(a, b)];
        mixRange(plan, sources, part, a, b, 1, st);
      }
      return out;
    };
    const a = render(full, 5512);
    const b = render(seg, 5512);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(a[0][i] - b[0][i]), Math.abs(a[1][i] - b[1][i]));
    expect(maxDiff).toBeLessThan(1e-6);
    // csak a szelet (és az első szeletnél a bejáratás) ablakát kérte — nem a teljes forrást
    expect(Math.max(...reads)).toBeLessThan(Math.round(0.8 * SR));
  });

  it('✖️ crossfade: az átfedésben az előző kihalkul, a következő felhangosodik — a szint folytonos', () => {
    const a = clip({ id: 'a', start: 0, duration: 3, volume: 1 });
    const b = clip({ id: 'b', start: 2, duration: 3, volume: 1 });
    const inner = clip({ id: 'c', start: 0.5, duration: 1, volume: 1 });
    const x = crossfades([a, b, inner]);
    expect(x.get('a')?.out).toBeCloseTo(1);
    expect(x.get('b')?.in).toBeCloseTo(1);
    // a teljesen belül lévő klip rétegezés: nincs crossfade
    expect(x.get('c')).toBeUndefined();
    // a keverésben: ugyanaz a jel két klipben → az átfedésben a szint állandó (lineáris crossfade)
    const SR = 44100;
    const p = project([clip({ id: 'a', start: 0, duration: 3, trimIn: 0, sourceDuration: 6, volume: 1 }), clip({ id: 'b', start: 2, duration: 3, trimIn: 2, sourceDuration: 6, volume: 1 })]);
    const plan = offlineMixPlan(p);
    expect(plan.clips.find((c) => c.id === 'a')?.fadeOut).toBeCloseTo(1);
    const dc = new Float32Array(6 * SR).fill(0.5);
    const out: [Float32Array, Float32Array] = [new Float32Array(5 * SR), new Float32Array(5 * SR)];
    mixRange(plan, new Map([[plan.clips[0].uri, { channels: [dc], sampleRate: SR }]]), out, 0, 5 * SR);
    for (const t of [1.5, 2.0, 2.25, 2.5, 2.75, 3.5]) expect(out[0][Math.round(t * SR)]).toBeCloseTo(0.5, 2);
  });
});

