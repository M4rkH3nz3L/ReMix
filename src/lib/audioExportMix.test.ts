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
