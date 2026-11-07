import { trimAudioLeft } from '@/lib/audioTrim';
import { mixRange, offlineMixPlan } from '@/lib/offlineMix';
import { createEmptyProject, splitClip } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

/** 🔁 A vágott / balról húzott loop-klip a minta közepéről folytatódik (a hurok-ablak marad). */

const SR = 44100;
// 4 s forrás: minden minta egyedi (a rossz forrás-pozíció azonnal kiderül)
const src = Float32Array.from({ length: 4 * SR }, (_, i) => 0.3 * Math.sin(i * 0.0137) + 0.2 * Math.sin(i * 0.00071));
const sources = new Map([['file:///l.wav', { channels: [src, src], sampleRate: SR }]]);
const loop: AudioClip = { kind: 'audio', id: 'L', uri: 'file:///l.wav', label: 'l', start: 0.3, duration: 3.2, trimIn: 0.5, sourceDuration: 4, loopLength: 1, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
const base = createEmptyProject('loop', '1:1', undefined, 'audio');
const withClips = (clips: AudioClip[]): Project => ({ ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips } : t)) });
const render = (p: Project) => {
  const n = 4 * SR;
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  mixRange(offlineMixPlan(p), sources, out, 0, n, 1, new Map());
  return out[0];
};
const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

describe('🔁 loop-klip vágása', () => {
  it('a kettévágott loop-klip pontosan úgy szól, mint az egész (a 2. darab a hurok közepéről indul)', () => {
    const [a, b] = splitClip(loop, 1.75) as [AudioClip, AudioClip];
    expect(b.trimIn).toBe(0.5);
    expect(b.loopOffset).toBeCloseTo(0.45, 9);
    expect(maxDiff(render(withClips([a, b])), render(withClips([loop])))).toBeLessThan(1e-6);
  });
  it('több vágás (ütemenként) a hurok-határon át is folytonos', () => {
    let parts = [loop];
    for (const t of [3, 2.5, 1.3, 0.8]) {
      const i = parts.findIndex((c) => c.start < t && t < c.start + c.duration);
      const [x, y] = splitClip(parts[i], t) as [AudioClip, AudioClip];
      parts = [...parts.slice(0, i), x, y, ...parts.slice(i + 1)];
    }
    expect(parts).toHaveLength(5);
    expect(maxDiff(render(withClips(parts)), render(withClips([loop])))).toBeLessThan(1e-6);
  });
  it('a bal él húzása: a hurok-ablak marad, a megmaradt rész ugyanott szól', () => {
    const r = trimAudioLeft(loop, 0.7);
    expect(r.trimIn).toBe(0.5);
    expect(r.loopOffset).toBeCloseTo(0.7, 9);
    const moved = { ...loop, ...r };
    const whole = render(withClips([loop]));
    const cut = render(withClips([moved]));
    // a mikro-fade (10 ms) után mintára egyezik
    const from = Math.round((1.0 + 0.012) * SR);
    expect(maxDiff(cut.subarray(from, Math.round(3.4 * SR)), whole.subarray(from, Math.round(3.4 * SR)))).toBeLessThan(1e-6);
    // balra is húzható a forrás elején túl (a hurok visszafelé is ismétlődik)
    const left = trimAudioLeft(loop, -0.3);
    expect(left.start).toBe(0);
    expect(left.loopOffset).toBeCloseTo(0.7, 9);
  });
});
