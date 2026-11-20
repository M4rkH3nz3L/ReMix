import { crossfadePairs, edgeFades } from './fades';
import { clipGainAt, fadeAt, panGains } from './gain';
import { EDGE_EPS, EDGE_FADE_SEC, OFFLINE_SAMPLE_RATE, type OfflineMixClip, type OfflineMixPlan } from './model';
import { mixRange } from './render';
import { needsWholeWindow, sliceSource, sourceRanges, stretchJobs } from './sourcePrep';
import { pipAudioClips, videoAudioClips } from './visualAudio';
import { pcm24, wavHeader16, wavHeader24, wavHeaderF32 } from './wav';
import type { AudioClip, Project } from '@/types/project';

// Az `offlineMix` belső moduljai (REFACTOR): a barrelen át nem elérhető segédek (`fadeAt`,
// `EDGE_EPS`) és a modulhatárokon átnyúló szerződések jelenlegi viselkedése rögzítve.

const clip = (over: Partial<OfflineMixClip> = {}): OfflineMixClip => ({
  id: 'c',
  track: 'music',
  uri: 'u',
  start: 0,
  duration: 1,
  trimIn: 0,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  pan: 0,
  gain: 1,
  speed: 1,
  reversed: false,
  pitch: 0,
  ...over,
});

describe('mix/model — állandók', () => {
  it('a mintavétel, a mikro-fade és a tűrés', () => {
    expect(OFFLINE_SAMPLE_RATE).toBe(44100);
    expect(EDGE_FADE_SEC).toBe(0.01);
    expect(EDGE_EPS).toBe(1e-4);
  });
});

describe('mix/gain — fade és balansz', () => {
  it('fadeAt: be- és kifade szorzata, 0–1-re szorítva', () => {
    const c = clip({ fadeIn: 0.5, fadeOut: 0.25 });
    expect(fadeAt(c, 0)).toBe(0);
    expect(fadeAt(c, 0.25)).toBe(0.5);
    expect(fadeAt(c, 0.5)).toBe(1);
    expect(fadeAt(c, 0.875)).toBe(0.5);
    expect(fadeAt(c, 2)).toBe(0);
    expect(fadeAt(c, -1)).toBe(0);
  });

  it('fadeAt: fade nélkül (vagy negatív fade-del) 1, NaN-időre NaN', () => {
    expect(fadeAt(clip(), 0.3)).toBe(1);
    expect(fadeAt(clip({ fadeIn: -1 }), 0)).toBe(1);
    expect(fadeAt(clip({ fadeIn: 0.1 }), Number.NaN)).toBeNaN();
  });

  it('clipGainAt: hangerő × sáv × fade', () => {
    expect(clipGainAt(clip({ volume: 0.5, gain: 0.8, fadeIn: 0.5 }), 0.25)).toBeCloseTo(0.2, 12);
  });

  it('panGains: lineáris, ±1-re szorítva; NaN átmegy', () => {
    expect(panGains(-3)).toEqual([1, 0]);
    expect(panGains(0.25)).toEqual([0.75, 1]);
    const nan = panGains(Number.NaN);
    expect(nan[0]).toBeNaN();
  });
});

describe('mix/fades — szélek', () => {
  const ac = (over: Partial<AudioClip>) => ({ kind: 'audio', label: 'x', uri: 'a', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, ...over }) as AudioClip;

  it('a tűrésen belüli illesztés folytatás (nincs mikro-fade), azon kívül van', () => {
    const a = ac({ id: 'a', start: 0, duration: 1 });
    const b = ac({ id: 'b', start: 1 + EDGE_EPS / 2, duration: 1, trimIn: 1 + EDGE_EPS / 2 });
    const f = edgeFades([a, b]);
    expect(f.get('a')).toEqual({ in: EDGE_FADE_SEC, out: 0 });
    expect(f.get('b')).toEqual({ in: 0, out: EDGE_FADE_SEC });
    const far = edgeFades([a, ac({ id: 'c', start: 1.01, duration: 1, trimIn: 1.01 })]);
    expect(far.get('a')?.out).toBe(EDGE_FADE_SEC);
  });

  it('crossfadePairs: a tűrésnyi átfedés még nem crossfade', () => {
    expect(crossfadePairs([{ id: 'a', start: 0, duration: 1 }, { id: 'b', start: 1 - EDGE_EPS / 2, duration: 1 }])).toEqual([]);
  });
});

describe('mix/visualAudio — videó- és PiP-hang', () => {
  const base = (tracks: Project['tracks']) => ({ id: 'p', name: 'p', aspectRatio: '1:1', tracks }) as unknown as Project;
  const v = (over: Record<string, unknown>) => ({ kind: 'video', speed: 1, volume: 1, trimIn: 0, sourceDuration: 5, uri: 'v', ...over });

  it('a takart szakasz kimarad, a visszafelé játszott forrás-ablak a végéről indul', () => {
    const p = base([{ id: 'v', type: 'video', clips: [v({ id: 'a', start: 0, duration: 2, reversed: true, speed: 2 }), v({ id: 'b', start: 1.5, duration: 1, volume: 0 })] }] as never);
    const out = videoAudioClips(p, new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a@0', start: 0, duration: 1.5, trimIn: 1, speed: 2, reversed: true, gain: 1 });
  });

  it('a PiP: nem pozitív sebesség → 1, hiányzó trimIn → 0, néma klip kimarad', () => {
    const p = base([{ id: 'p', type: 'pip', clips: [v({ id: 'x', start: 1, duration: 1, speed: 0, trimIn: undefined }), v({ id: 'y', start: 0, duration: 1, volume: 0 })] }] as never);
    expect(pipAudioClips(p)).toEqual([expect.objectContaining({ id: 'pip:x', speed: 1, trimIn: 0, track: 'pip' })]);
  });
});

describe('mix/sourcePrep — forrás-előkészítés', () => {
  it('stretchJobs: az azonos szakasz egy feladat, a formáns csak hangmagasság-eltolással', () => {
    const plan: OfflineMixPlan = { duration: 2, unsupported: [], clips: [clip({ id: 'a', speed: 2, formant: true }), clip({ id: 'b', speed: 2 }), clip({ id: 'c', pitch: 3, formant: true })] };
    const { jobs, plan: out } = stretchJobs(plan);
    expect(jobs.map((j) => j.key)).toEqual(['u#0.000000|1.000000|2|f|0|', 'u#0.000000|1.000000|1|f|3||fm']);
    expect(out.clips[0]).toMatchObject({ uri: jobs[0].key, trimIn: 0, speed: 1, formant: false });
    expect(plan.clips[0].uri).toBe('u');
  });

  it('needsWholeWindow és sourceRanges (bejáratással az effektes klipnél)', () => {
    expect(needsWholeWindow(clip())).toBe(false);
    expect(needsWholeWindow(clip({ loopLength: 0.5 }))).toBe(true);
    const plan: OfflineMixPlan = { duration: 2, unsupported: [], clips: [clip({ uri: 'long', start: 1, trimIn: 0.5, fx: { reverb: 0.2 } }), clip({ uri: 'short' })] };
    const r = sourceRanges(plan, (u) => u === 'long', 50000, 60000);
    expect(r).toHaveLength(1);
    expect(r[0].uri).toBe('long');
    expect(r[0].to).toBe(60000 - 44100 + 22050);
    expect(r[0].from).toBeLessThan(50000 - 44100 + 22050);
  });

  it('sliceSource: a forráson kívül csend, fordítva is', () => {
    const [a] = sliceSource([Float32Array.from([1, 2, 3])], -1, 5, true);
    expect(Array.from(a)).toEqual([0, 3, 2, 1, 0]);
  });
});

describe('mix/render — keverés', () => {
  it('a darabos keverés a blokk-rácsot a klip elejéhez igazítja (egyben = darabokban)', () => {
    const src = new Map([['u', { channels: [Float32Array.from({ length: 3000 }, (_, i) => Math.sin(i / 3))], sampleRate: 44100 }]]);
    const kf = [
      { time: 0, value: 0.2, easing: 'linear' as const },
      { time: 0.05, value: 1, easing: 'linear' as const },
    ];
    const plan: OfflineMixPlan = { duration: 0.07, unsupported: [], clips: [clip({ start: 0.001, duration: 0.06, volumeKf: kf, pan: 0.3, fadeOut: 0.02 })] };
    const whole: [Float32Array, Float32Array] = [new Float32Array(3000), new Float32Array(3000)];
    mixRange(plan, src, whole, 0, 3000);
    const parts: [Float32Array, Float32Array] = [new Float32Array(3000), new Float32Array(3000)];
    for (let a = 0; a < 3000; a += 333) {
      const b = Math.min(3000, a + 333);
      mixRange(plan, src, [parts[0].subarray(a, b), parts[1].subarray(a, b)], a, b);
    }
    expect(Array.from(parts[0])).toEqual(Array.from(whole[0]));
    expect(Array.from(parts[1])).toEqual(Array.from(whole[1]));
    expect(whole[1][100]).not.toBe(0);
  });
});

describe('mix/wav — fejlécek', () => {
  it('a 24 bites fejléc a 16 bitesből íródik át, a lebegőpontos a 3-as formátum', () => {
    const h24 = new DataView(wavHeader24(10, 2, 48000).buffer);
    expect([h24.getUint32(4, true), h24.getUint16(20, true), h24.getUint32(28, true), h24.getUint16(32, true), h24.getUint16(34, true), h24.getUint32(40, true)]).toEqual([96, 1, 288000, 6, 24, 60]);
    const hf = new DataView(wavHeaderF32(10, 1, 44100).buffer);
    expect([hf.getUint16(20, true), hf.getUint16(34, true), hf.getUint32(40, true)]).toEqual([3, 32, 40]);
    expect(new TextDecoder().decode(wavHeader16(0, 2, 44100).subarray(0, 16))).toBe('RIFF$\u0000\u0000\u0000WAVEfmt ');
  });

  it('pcm24: szorítás, NaN → 0 (a Math.round(NaN) a szorítás után is NaN → 0 bájt)', () => {
    expect(Array.from(pcm24([Float32Array.from([2, -2, Number.NaN])]))).toEqual([0xff, 0xff, 0x7f, 0x00, 0x00, 0x80, 0, 0, 0]);
  });
});
