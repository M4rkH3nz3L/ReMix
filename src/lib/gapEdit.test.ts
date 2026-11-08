import { applyCommand, type EditorCommand } from '@/lib/commands';
import { insertSilenceCommands, joinableNext, joinCommands } from '@/lib/gapEdit';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

let n = 0;
const makeId = (p: string) => `${p}_${++n}`;
const run = (p: Project, cmds: EditorCommand[]) => cmds.reduce((acc, c) => applyCommand(acc, c) ?? acc, p);
const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: 'file:///a.wav', label: 'a', start: 0, duration: 4, trimIn: 1, sourceDuration: 20, volume: 0.8, fadeIn: 0.3, fadeOut: 0.4, source: 'imported', ...over });
const proj = (): Project => {
  const p = createEmptyProject('g', '9:16', undefined, 'audio');
  return {
    ...p,
    markers: [{ id: 'm1', time: 1, label: 'a' }, { id: 'm2', time: 5, label: 'b' }],
    regions: [{ id: 'r1', start: 0.5, end: 3, label: 'x', color: '#fff' }, { id: 'r2', start: 6, end: 7, label: 'y', color: '#fff' }],
    tracks: p.tracks.map((t) =>
      t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', start: 0, duration: 4 }), ac({ id: 'v2', start: 6, duration: 1, uri: 'file:///b.wav' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'mu', start: 0, duration: 8, uri: 'file:///m.wav' })] } : t
    ),
  };
};
const clipsOf = (p: Project, type: string) => (p.tracks.find((t) => t.type === type)!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);

describe('csend beszúrása', () => {
  it('csak ez a sáv: az átnyúló klip kettéválik (a jobb fele a forrás folytatása, később), a későbbiek tolódnak; a többi sáv és a jelölők maradnak', () => {
    const p = run(proj(), insertSilenceCommands(proj(), 2.5, 1.5, 'track', 'voiceover', [], makeId));
    const v = clipsOf(p, 'voiceover');
    expect(v.map((c) => [c.start, c.duration, c.trimIn])).toEqual([[0, 2.5, 1], [4, 1.5, 3.5], [7.5, 1, 1]]);
    expect(v[0].fadeOut).toBe(0);
    expect(v[1].fadeIn).toBe(0);
    expect(v[1].fadeOut).toBe(0.4);
    expect(new Set(v.map((c) => c.id)).size).toBe(3);
    expect(clipsOf(p, 'music')).toEqual(clipsOf(proj(), 'music'));
    expect(p.markers).toEqual(proj().markers);
  });
  it('minden sáv: minden sáv tolódik, a jelölők és a régiók is (a beszúráson átnyúló régió hosszabb lesz)', () => {
    const p = run(proj(), insertSilenceCommands(proj(), 2.5, 1.5, 'all', 'voiceover', [], makeId));
    expect(clipsOf(p, 'music').map((c) => [c.start, c.duration])).toEqual([[0, 2.5], [4, 5.5]]);
    expect(p.markers!.map((m) => m.time)).toEqual([1, 6.5]);
    expect(p.regions!.map((g) => [g.start, g.end])).toEqual([[0.5, 4.5], [7.5, 8.5]]);
  });
  it('zárolt sáv kimarad; nulla hossz → nincs parancs', () => {
    const p = run(proj(), insertSilenceCommands(proj(), 2.5, 1, 'all', 'voiceover', ['music'], makeId));
    expect(clipsOf(p, 'music')).toEqual(clipsOf(proj(), 'music'));
    expect(insertSilenceCommands(proj(), 2, 0, 'all', 'voiceover', [], makeId)).toEqual([]);
  });
});

describe('összeillesztés', () => {
  it('a kettévágás pontos fordítottja: vágás → összeillesztés = az eredeti klip (azonosítóval együtt)', () => {
    const p0 = proj();
    const orig = clipsOf(p0, 'voiceover')[0];
    const split = run(p0, [{ type: 'SPLIT_CLIP', clipId: 'v', time: 1.7 }]);
    expect(joinableNext(split, 'v')).not.toBeNull();
    const joined = run(split, joinCommands(split, 'v'));
    const back = clipsOf(joined, 'voiceover')[0];
    expect({ ...back, keyframes: back.keyframes ?? undefined }).toEqual({ ...orig, keyframes: orig.keyframes ?? undefined });
    expect(clipsOf(joined, 'voiceover')).toHaveLength(2);
  });
  it('kulcskockás (automációs) klip vágása és összeillesztése: ugyanaz a görbe', () => {
    const p0 = proj();
    const withKf = run(p0, [{ type: 'UPDATE_CLIP', clipId: 'v', patch: { keyframes: { volume: [{ time: 0, value: 0.2, easing: 'linear' }, { time: 4, value: 1, easing: 'linear' }] } } as Partial<AudioClip> }]);
    const split = run(withKf, [{ type: 'SPLIT_CLIP', clipId: 'v', time: 1 }]);
    const joined = run(split, joinCommands(split, 'v'));
    const kf = (clipsOf(joined, 'voiceover')[0].keyframes as { volume: { time: number; value: number }[] }).volume;
    expect(kf[0]).toEqual(expect.objectContaining({ time: 0, value: 0.2 }));
    expect(kf[kf.length - 1]).toEqual(expect.objectContaining({ time: 4, value: 1 }));
    // a közbülső (vágáskori) pont a régi egyenesen fekszik
    for (const k of kf) expect(k.value).toBeCloseTo(0.2 + 0.2 * k.time, 9);
  });
  it('nem illeszthető: más forrás, rés a forrásban, eltérő hangerő', () => {
    const p0 = proj();
    const split = run(p0, [{ type: 'SPLIT_CLIP', clipId: 'v', time: 2 }]);
    const right = clipsOf(split, 'voiceover')[1];
    expect(joinableNext(run(split, [{ type: 'UPDATE_CLIP', clipId: right.id, patch: { volume: 0.5 } }]), 'v')).toBeNull();
    expect(joinableNext(run(split, [{ type: 'UPDATE_CLIP', clipId: right.id, patch: { trimIn: 9 } }]), 'v')).toBeNull();
    expect(joinableNext(p0, 'v')).toBeNull();
  });
});
