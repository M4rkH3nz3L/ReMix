import { clipGainAt, encodeWav16, mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan, panGains } from '@/lib/offlineMix';
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
    const plan = offlineMixPlan(project([clip({ voiceEnhance: true, audioFx: { highpass: 80, reverb: 0.4 } })], { audioMaster: { target: 'podcast', lufs: -16, truePeak: -1.5, dynamics: 'balanced' } }));
    expect(plan.unsupported.sort()).toEqual(['effects', 'master', 'voiceEnhance']);
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
});

