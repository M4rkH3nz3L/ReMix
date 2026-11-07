import { mixRange, offlineMixPlan, pcm24, wavHeader24, OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { FxState } from '@/lib/audioDsp';
import type { AudioClip, Project } from '@/types/project';

/** 🎚️ Stemek: a sávonkénti kimenetek összege = a keverés master nélkül (halkítással, busszal). */

const SR = OFFLINE_SAMPLE_RATE;
const tone = (f: number, sec: number, gate?: (t: number) => number) =>
  Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / SR) * (gate ? gate(i / SR) : 1));
const sources = new Map([
  ['file:///voice.wav', { channels: [tone(220, 4, (t) => (t > 1 && t < 2.5 ? 1 : 0))], sampleRate: SR }],
  ['file:///music.wav', { channels: [tone(440, 4), tone(441, 4)], sampleRate: SR }],
  ['file:///fx.wav', { channels: [tone(880, 1)], sampleRate: SR }],
]);
const clip = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'c', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', start: 0, duration: 4, sourceDuration: 4, id: 'c', uri: '', ...over }) as AudioClip;
const base = createEmptyProject('stems', '1:1', undefined, 'audio');
const project: Project = {
  ...base,
  audioMaster: { duckTrigger: 'voiceover', limiter: true } as unknown as Project['audioMaster'],
  audioBuses: [{ id: 'rev', name: 'Zengés', fx: { reverb: 0.5 }, gain: 0.8 }],
  audioSends: { sfx: { rev: 0.6 } },
  tracks: base.tracks.map((t) =>
    t.type === 'voiceover'
      ? { ...t, clips: [clip({ id: 'v', uri: 'file:///voice.wav' })] }
      : t.type === 'music'
        ? { ...t, clips: [clip({ id: 'm', uri: 'file:///music.wav', autoDuck: true })] }
        : t.type === 'sfx'
          ? { ...t, clips: [clip({ id: 'f', uri: 'file:///fx.wav', start: 2, duration: 1, sourceDuration: 1 })] }
          : t
  ),
};
const render = (solo?: string[], master = false) => {
  const p = offlineMixPlan(project);
  const plan = { ...p, master: master ? p.master : undefined, ...(solo ? { solo } : {}) };
  const n = 4 * SR;
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let a = 0; a < n; a += 11025) mixRange(plan, sources, [out[0].subarray(a, a + 11025), out[1].subarray(a, a + 11025)] as [Float32Array, Float32Array], a, Math.min(n, a + 11025), 1, fxState(solo));
  return out;
};
const states = new Map<string, Map<string, FxState>>();
const fxState = (solo?: string[]) => {
  const k = (solo ?? ['all']).join();
  if (!states.has(k)) states.set(k, new Map());
  return states.get(k)!;
};
const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

describe('🎚️ stemek', () => {
  it('a halkítás és a zengés-busz mellett is: Σ stem = a keverés master nélkül', () => {
    expect(offlineMixPlan(project).ducking).toBe(true);
    const mix = render();
    const stems = ['voiceover', 'music', 'sfx'].map((t) => render([t]));
    let max = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < mix[c].length; i++) max = Math.max(max, Math.abs(stems[0][c][i] + stems[1][c][i] + stems[2][c][i] - mix[c][i]));
    expect(max).toBeLessThan(1e-6);
  });
  it('a zene-stem a beszéd alatt halkul (a kulcs a némított beszéd-sávból jön)', () => {
    const music = render(['music'])[0];
    const before = rms(music, Math.round(0.3 * SR), Math.round(0.9 * SR));
    const under = rms(music, Math.round(1.6 * SR), Math.round(2.3 * SR));
    expect(20 * Math.log10(under / before)).toBeLessThan(-6);
  });
  it('az effekt-stem a saját zengését is viszi (a busz a küldéséből)', () => {
    const fx = render(['sfx'])[0];
    // a klip 3 s-kor véget ér, a zengés lecsengése utána is szól
    expect(rms(fx, Math.round(3.05 * SR), Math.round(3.3 * SR))).toBeGreaterThan(1e-4);
    // a zene-stemben nincs zengés-visszatérés (nem küld a buszra)
    expect(rms(render(['voiceover'])[0], Math.round(3.05 * SR), Math.round(3.3 * SR))).toBeLessThan(1e-6);
  });
});

describe('24 bites WAV', () => {
  it('fejléc és minták', () => {
    const h = new DataView(wavHeader24(10, 2, 44100).buffer);
    expect(h.getUint16(34, true)).toBe(24);
    expect(h.getUint32(40, true)).toBe(60);
    const b = pcm24([Float32Array.from([1, -1, 0.5])]);
    expect(Array.from(b)).toEqual([0xff, 0xff, 0x7f, 0x01, 0x00, 0x80, 0x00, 0x00, 0x40]);
  });
});
