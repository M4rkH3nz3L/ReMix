import { buildFxChain, fxUnsupported, runChain } from '@/lib/audioDsp';
import { applyCommand } from '@/lib/commands';
import { DELAY_BEAT_OPTIONS, delayMsForBeats, delayTimeMs, eqBandParams, retimeTempoDelays } from '@/lib/fxParams';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

/** 🎛️ V7: parametrikus EQ és tempóhoz kötött delay — a pure paraméterek, a reducer és a DSP. */
const SR = 44100;

function project(clips: AudioClip[], bpm = 120): Project {
  const base = createEmptyProject('fx', '9:16', undefined, 'audio');
  return { ...base, bpm, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips } : t)) };
}
const clip = (id: string, start: number, fx: AudioClip['audioFx']): AudioClip => ({ kind: 'audio', id, label: id, uri: 'file:///a.wav', start, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: fx });
const music = (p: Project) => p.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];

/** egy szinusz erősítése (dB) a láncon át, a bejáratás után */
function gainAt(chain: ReturnType<typeof buildFxChain>, hz: number): number {
  const n = SR;
  const l = Float32Array.from({ length: n }, (_, i) => 0.25 * Math.sin((2 * Math.PI * hz * i) / SR));
  const r = Float32Array.from(l);
  runChain(chain, l, r, 0);
  let e = 0;
  for (let i = n / 2; i < n; i++) e += l[i] * l[i];
  return 20 * Math.log10(Math.sqrt(e / (n / 2)) / (0.25 / Math.SQRT2));
}

describe('🎛️ V7 fxParams', () => {
  it('EQ: hiányzó frekvencia/Q = a régi fix sávok; a tartományra szorít', () => {
    expect(eqBandParams({ low: 3, mid: 0, high: -2 })).toEqual([
      { key: 'low', freq: 100, q: 1, gain: 3 },
      { key: 'mid', freq: 1000, q: 1, gain: 0 },
      { key: 'high', freq: 8000, q: 1, gain: -2 },
    ]);
    const p = eqBandParams({ low: 20, mid: 4, high: 0, lowFreq: 5, midFreq: 2500.6, highFreq: 99999, midQ: 50, lowQ: 0.01 });
    expect(p.map((b) => [b.freq, b.q, b.gain])).toEqual([[20, 0.3, 12], [2501, 8, 4], [20000, 1, 0]]);
  });

  it('a parametrikus sáv a beállított frekvencián emel, a régi fix helyen alig', () => {
    const chain = () => buildFxChain({ eq: { low: 0, mid: 9, high: 0, midFreq: 3000, midQ: 4 } }, SR);
    expect(gainAt(chain(), 3000)).toBeCloseTo(9, 0);
    expect(gainAt(chain(), 1000)).toBeLessThan(1);
  });

  it('delay: ütemrész + tempó → ms; a régi mérték-alapú idő marad, ha nincs ütemhez kötve', () => {
    expect(delayMsForBeats(0.5, 120)).toBe(250);
    expect(delayMsForBeats(0.75, 90)).toBe(500);
    expect(delayMsForBeats(2, 30)).toBe(2000); // plafon
    expect(DELAY_BEAT_OPTIONS).toContain(0.75);
    expect(delayTimeMs({ delay: 0.5 })).toBe(310);
    expect(delayTimeMs({ delay: 0.5, delayBeats: 0.5, delayMs: 250 })).toBe(250);
    expect(delayTimeMs({ delay: 0.5, delayBeats: 0.5 })).toBe(310); // még nincs kiszámolva → a régi
  });

  it('a DSP visszhangja pontosan a tempóból számolt ms-nél jön (impulzus)', () => {
    const chain = buildFxChain({ delay: 1, delayBeats: 0.25, delayMs: 125 }, SR);
    const l = new Float32Array(SR);
    const r = new Float32Array(SR);
    l[0] = 1;
    r[0] = 1;
    runChain(chain, l, r, 0);
    let peak = 0;
    let at = 0;
    for (let i = 100; i < SR; i++) if (Math.abs(l[i]) > peak) { peak = Math.abs(l[i]); at = i; }
    expect(at).toBe(Math.round(0.125 * SR));
  });

  it('a reducer: tempóváltáskor a delay ms-e frissül, ugyanabban az undo-lépésben; különben a projekt ugyanaz', () => {
    const p0 = retimeTempoDelays(project([clip('a', 0, { delay: 0.6, delayBeats: 0.5 }), clip('b', 0, { delay: 0.6 })]));
    expect(music(p0)[0].audioFx?.delayMs).toBe(250);
    expect(music(p0)[1].audioFx?.delayMs).toBeUndefined();
    expect(retimeTempoDelays(p0)).toBe(p0);
    const p1 = applyCommand(p0, { type: 'SET_BPM', bpm: 100 })!;
    expect(music(p1)[0].audioFx?.delayMs).toBe(300);
    // tempótérkép: a 8. beattől 60 BPM → az ott kezdődő klip 500 ms
    const p2 = applyCommand(p1, { type: 'ADD_CLIPS', trackType: 'music', clips: [clip('c', 10, { delay: 0.5, delayBeats: 0.5 })] })!;
    const p3 = applyCommand(p2, { type: 'SET_TEMPO_MAP', tempoMap: [{ atBeat: 8, bpm: 60 }] })!;
    expect(music(p3).find((c) => c.id === 'c')!.audioFx?.delayMs).toBe(500);
    expect(music(p3).find((c) => c.id === 'a')!.audioFx?.delayMs).toBe(300);
    // az ütemrész választása (UPDATE_CLIP) is azonnal kiszámolja
    const p4 = applyCommand(p3, { type: 'UPDATE_CLIP', clipId: 'b', patch: { audioFx: { delay: 0.6, delayBeats: 1 } } })!;
    expect(music(p4).find((c) => c.id === 'b')!.audioFx?.delayMs).toBe(600);
  });

  it('az ütemre kötött delay a telefonos láncban támogatott (nincs „nem támogatott effekt” jelzés)', () => {
    expect(fxUnsupported({ delay: 0.5, delayBeats: 0.5, delayMs: 250 })).toBe(false);
    expect(fxUnsupported({ eq: { low: 1, mid: 0, high: 0, midFreq: 2000, midQ: 2 } })).toBe(false);
  });
});
