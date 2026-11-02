/** 🎧 A hangszerkesztés alapjai (PRO-AUDIO A1, A2, A7, A16): a műveletek után a hang ugyanott szól. */
import { sourceTimeOf } from '@/lib/avSync';
import { coalesceKey } from '@/lib/historyCoalesce';
import { sampleChannel } from '@/lib/keyframes';
import { createEmptyProject, splitClip } from '@/lib/projectUtils';
import { trimAudioLeft } from '@/lib/audioTrim';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';

const clip = (over: Partial<AudioClip> = {}) =>
  ({ kind: 'audio', id: 'a', uri: 'file:///a.m4a', label: 'a', start: 10, duration: 8, trimIn: 2, sourceDuration: 30, volume: 1, ...over }) as AudioClip;

describe('A1 audio-split', () => {
  const pair = (c: AudioClip, t: number) => splitClip(c, t) as [AudioClip, AudioClip];

  it('a második fél folytatja a forrást, nem az elejéről szól', () => {
    const [a, b] = pair(clip(), 13);
    expect(a.duration).toBeCloseTo(3);
    expect(b.start).toBe(13);
    expect(b.trimIn).toBeCloseTo(5);
  });

  it('bármely pillanatban ugyanaz a forrás-idő szól, mint vágás előtt', () => {
    const c = clip();
    const [a, b] = pair(c, 13);
    for (const t of [10.5, 12.9, 13, 15, 17.9]) {
      const part = t < 13 ? a : b;
      expect(sourceTimeOf(part, t)).toBeCloseTo(sourceTimeOf(c, t));
    }
  });

  it('a fade a szélén marad: az első fél nem halkul el a vágásnál', () => {
    const [a, b] = pair(clip({ fadeIn: 1, fadeOut: 2 }), 13);
    expect(a.fadeIn).toBe(1);
    expect(a.fadeOut).toBe(0);
    expect(b.fadeIn).toBe(0);
    expect(b.fadeOut).toBe(2);
  });

  it('a hangerő-automáció folytonos marad a vágásnál', () => {
    const c = clip({ keyframes: { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 8, value: 1, easing: 'linear' }] } as AudioClip['keyframes'] });
    const [a, b] = pair(c, 14);
    expect(sampleChannel(a.keyframes?.volume, 3, 1)).toBeCloseTo(sampleChannel(c.keyframes?.volume, 3, 1));
    expect(sampleChannel(b.keyframes?.volume, 1, 1)).toBeCloseTo(sampleChannel(c.keyframes?.volume, 5, 1));
  });
});

describe('A2 bal-trim', () => {
  const k = { volume: [{ time: 0, value: 0, easing: 'linear' }, { time: 8, value: 1, easing: 'linear' }] } as AudioClip['keyframes'];

  it('rövidítéskor az automáció a hanggal marad', () => {
    const c = clip({ keyframes: k });
    const next = { ...c, ...trimAudioLeft(c, 2) };
    expect(sampleChannel(next.keyframes?.volume, 1, 1)).toBeCloseTo(sampleChannel(k?.volume, 3, 1));
  });

  it('nyújtáskor is a hanggal marad', () => {
    const c = clip({ keyframes: k });
    const next = { ...c, ...trimAudioLeft(c, -2) };
    expect(next.duration).toBe(10);
    expect(sampleChannel(next.keyframes?.volume, 6, 1)).toBeCloseTo(sampleChannel(k?.volume, 4, 1));
  });

  it('automáció nélkül nincs mező', () => {
    expect(trimAudioLeft(clip(), 1)).not.toHaveProperty('keyframes');
  });
});

describe('A16 visszavonás', () => {
  it('a fader-húzás és a tempó egy lépés', () => {
    expect(coalesceKey({ type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 })).toBe('gain:music');
    expect(coalesceKey({ type: 'SET_BPM', bpm: 120 })).toBe('bpm');
  });

  it('külön sáv külön lépés', () => {
    expect(coalesceKey({ type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 })).not.toBe(coalesceKey({ type: 'SET_TRACK_GAIN', trackType: 'sfx', gain: 0.5 }));
  });
});

describe('A7 sávok közti mozgatás', () => {
  const load = () => {
    const p: Project = createEmptyProject('t', '9:16', undefined, 'audio');
    useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip({ start: 1 })] } : t)) }, []);
  };

  it('a hívó illesztése marad, nem kerekít frame-re', () => {
    load();
    expect(useEditorStore.getState().moveClip('a', 'voiceover', 2.345678, true)).toBeTruthy();
    const moved = useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0];
    expect(moved?.start).toBeCloseTo(2.345678, 5);
  });
});
