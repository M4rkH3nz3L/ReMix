import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';

/**
 * 🎧 V6 — mintapontos időmodell: a hang-/zene-projektben a vágás, a mozgatás, a beillesztés és a lejátszófej a
 * MINTÁRA ül (44,1 kHz), a videó-projektben továbbra is a képkockára.
 */
const SR = 44100;
const store = () => useEditorStore.getState();
afterEach(() => store().closeProject());

function projectOf(kind: 'audio' | 'music' | 'video'): Project {
  const base = createEmptyProject('rács', '9:16', undefined, kind);
  const clip: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: 'file:///a.wav', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  return { ...base, id: `p_${kind}`, fps: 30, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) };
}
const music = () => store().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
const onSample = (x: number) => Math.abs(x * SR - Math.round(x * SR)) < 1e-6;

describe('🎧 V6 — szerkesztési rács', () => {
  it.each(['audio', 'music'] as const)('%s-projekt: a vágás a mintára ül (nem a képkockára), a jobb fél forrás-pozíciója is', (kind) => {
    store().loadProject(projectOf(kind));
    expect(store().splitClipAt('c', 1.23456)).toBeTruthy();
    const [a, b] = music();
    expect(b.start).toBe(Math.round(1.23456 * SR) / SR);
    expect(onSample(b.start) && onSample(b.trimIn ?? 0) && onSample(a.duration)).toBe(true);
    expect(Math.abs(b.start * 30 - Math.round(b.start * 30))).toBeGreaterThan(0.01); // nem frame-határ
    // a két fél pontosan illeszkedik (a forrás folytatódik)
    expect(Math.round((a.start + a.duration) * SR)).toBe(Math.round(b.start * SR));
    expect(Math.round((b.trimIn ?? 0) * SR)).toBe(Math.round(1.23456 * SR));
  });

  it('videó-projekt: a vágás marad a frame-rácson', () => {
    store().loadProject(projectOf('video'));
    store().splitClipAt('c', 1.23456);
    expect(music()[1].start).toBe(Math.round(1.23456 * 30) / 30);
  });

  it('a mozgatás, a beillesztés és a lejátszófej (snap) is a mintára — hang-projektben', () => {
    store().loadProject(projectOf('audio'));
    store().moveClip('c', 'music', 0.777777);
    expect(music()[0].start).toBe(Math.round(0.777777 * SR) / SR);
    store().setPlayhead(2.000013, true);
    expect(store().playhead).toBe(Math.round(2.000013 * SR) / SR);
    store().selectClip('c');
    store().copyClips();
    expect(store().pasteClipsAt('music', 5.1234567)).toBe(1);
    expect(music().some((c) => c.start === Math.round(5.1234567 * SR) / SR)).toBe(true);
  });
});
