import { mixForExport } from '@/lib/audioExportMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { Clip, Project, TrackType } from '@/types/project';

const project = (): Project => {
  const p = createEmptyProject('t', '9:16', undefined, 'audio');
  return { ...p, tracks: p.tracks.map((t) => (['music', 'voiceover'].includes(t.type) ? { ...t, clips: [{ id: t.type } as Clip] } : t)) };
};
const clips = (p: Project | null, type: TrackType) => p?.tracks.find((t) => t.type === type)?.clips.length;

describe('mixForExport', () => {
  it('a némított sáv nem kerül az exportba', () => {
    const out = mixForExport(project(), (t) => t !== 'music', 1);
    expect(clips(out, 'music')).toBe(0);
    expect(clips(out, 'voiceover')).toBe(1);
  });

  it('az eredeti projekt nem változik', () => {
    const p = project();
    mixForExport(p, () => false, 1);
    expect(clips(p, 'music')).toBe(1);
  });

  it('ha semmi nem szól, nincs export', () => {
    expect(mixForExport(project(), () => false, 1)).toBeNull();
  });

  it('a master a meglévő sáv-erősítésre szoroz', () => {
    const out = mixForExport({ ...project(), trackMix: { music: { gain: 0.5 } } }, () => true, 0.5);
    expect(out?.trackMix?.music?.gain).toBeCloseTo(0.25);
    expect(out?.trackMix?.voiceover?.gain).toBeCloseTo(0.5);
  });

  it('teljes hangerőn a keverés érintetlen', () => {
    expect(mixForExport(project(), () => true, 1)?.trackMix).toBeUndefined();
  });
});

describe('mixForExport — videó-projekt (PRO-AUDIO 17/20)', () => {
  const video = (volume: number, kf?: number[]): Project => {
    const p = createEmptyProject('v', '9:16');
    const clip = { id: 'v1', kind: 'video', volume, keyframes: kf ? { volume: kf.map((value, i) => ({ time: i, value, easing: 'linear' })) } : undefined } as unknown as Clip;
    return { ...p, tracks: p.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [clip] } : t)) };
  };
  const vclip = (p: Project | null) => p?.tracks.find((t) => t.type === 'video')?.clips[0] as unknown as { volume: number; keyframes?: { volume: { value: number }[] } };

  it('a csak videóklip-hangos projekt nem „néma”', () => {
    expect(mixForExport(video(1), () => true, 1)).not.toBeNull();
  });

  it('a néma videóklip és a némított videósáv nem ad hangot', () => {
    expect(mixForExport(video(0), () => true, 1)).toBeNull();
    expect(mixForExport(video(1), (t) => t !== 'video', 1)).toBeNull();
  });

  it('a master a videóklip hangerejére és automációjára is hat (mint az élő lejátszóban)', () => {
    const out = vclip(mixForExport(video(0.8, [0.5, 1]), () => true, 0.5));
    expect(out.volume).toBeCloseTo(0.4, 5);
    expect(out.keyframes?.volume.map((k) => k.value)).toEqual([0.25, 0.5]);
  });
});

