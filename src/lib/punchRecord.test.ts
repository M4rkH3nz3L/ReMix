import { applyCommand, type EditorCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';
import { beatSeconds, countInClicks, countInSeconds, punchCommands, punchWindow, recordingStartFrom, selectTakeCommand, takeSlot, PUNCH_LEAD } from '@/lib/punchRecord';
import type { AudioClip, Project } from '@/types/project';

let n = 0;
const makeId = (p: string) => `${p}_${++n}`;

describe('count-in', () => {
  it('120 BPM 4/4: 1 ütem = 2,0 s, 4 kattanás, az első hangsúlyos', () => {
    expect(countInSeconds(1, 120)).toBeCloseTo(2.0, 9);
    expect(countInClicks(1, 120).map((c) => [c.t, c.accent])).toEqual([[0, true], [0.5, false], [1, false], [1.5, false]]);
  });
  it('3/4 @ 90, 2 ütem; 6/8-nál a beat a nyolcad', () => {
    expect(countInSeconds(2, 90, { beatsPerBar: 3, beatUnit: 4 })).toBeCloseTo(4.0, 9);
    expect(beatSeconds(120, { beatsPerBar: 6, beatUnit: 8 })).toBeCloseTo(0.25, 9);
    expect(countInClicks(1, 120, { beatsPerBar: 6, beatUnit: 8 }).filter((c) => c.accent)).toHaveLength(1);
  });
  it('0 ütem = nincs előszámlálás', () => {
    expect(countInSeconds(0, 120)).toBe(0);
    expect(countInClicks(0, 120)).toEqual([]);
  });
});

describe('punchWindow', () => {
  it('preroll előtte, a felvevő In előtt indul, Out után áll le', () => {
    const w = punchWindow(4, 6)!;
    expect(w.playFrom).toBe(2);
    expect(w.recordAt).toBeCloseTo(4 - PUNCH_LEAD, 9);
    expect(w.stopAt).toBeGreaterThan(6);
  });
  it('a lejátszás nem indul 0 előtt; hiányzó / túl rövid tartomány → null', () => {
    expect(punchWindow(1, 3)!.playFrom).toBe(0);
    expect(punchWindow(null, 3)).toBeNull();
    expect(punchWindow(2, 2.1)).toBeNull();
  });
});

describe('recordingStartFrom', () => {
  it('a felvétel kezdete = medián(lejátszófej − felvett idő); a 0 ms-os minták kimaradnak, a kiugró nem húz el', () => {
    const start = 3.73;
    const s = [0.1, 0.2, 0.35, 0.5, 0.8].map((d, i) => ({ playhead: start + d + (i === 2 ? 0.2 : 0.004 * (i - 2)), recordedMs: d * 1000 }));
    expect(recordingStartFrom([{ playhead: 3.7, recordedMs: 0 }, ...s])).toBeCloseTo(start, 2);
    expect(recordingStartFrom([])).toBeNull();
  });
});

describe('punchCommands', () => {
  const base = (): Project => {
    const p = createEmptyProject('p', '9:16', undefined, 'audio');
    const c: AudioClip = { kind: 'audio', id: 'old', uri: 'file:///old.wav', label: 'old', start: 0, duration: 10, trimIn: 1, sourceDuration: 20, volume: 0.8, fadeIn: 0.5, fadeOut: 0.5, source: 'voiceover' };
    return { ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
  };
  const run = (p: Project, cmds: EditorCommand[]) => cmds.reduce((acc, c) => applyCommand(acc, c) ?? acc, p);

  it('a régi klip In–Out között kivágva (a két széle marad, a forrás-pozíció helyes), az új klip pontosan In-től Out-ig', () => {
    const p = run(base(), punchCommands(base(), 'voiceover', { uri: 'file:///take.m4a', seconds: 2.6, startAt: 3.72, label: 'take' }, { in: 4, out: 6 }, makeId));
    const clips = p.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[];
    expect(clips.map((c) => [c.uri.split('/').pop(), +c.start.toFixed(6), +c.duration.toFixed(6)])).toEqual([
      ['old.wav', 0, 4],
      ['take.m4a', 4, 2],
      ['old.wav', 6, 4],
    ]);
    expect(clips[0].trimIn).toBe(1);
    expect(clips[2].trimIn).toBeCloseTo(7, 9); // 1 + 6
    expect(clips[1].trimIn).toBeCloseTo(0.28, 9); // In − a felvétel kezdete
    expect(clips[0].fadeOut).toBe(0);
    expect(clips[2].fadeIn).toBe(0);
    expect(new Set(clips.map((c) => c.id)).size).toBe(3);
    expect(p.assets.some((a) => a.uri === 'file:///take.m4a')).toBe(true);
  });
  it('késve induló felvevő: a klip a tényleges kezdettől szól (nincs kitalált hang)', () => {
    const p = run(base(), punchCommands(base(), 'voiceover', { uri: 'file:///late.m4a', seconds: 1.9, startAt: 4.1, label: 'late' }, { in: 4, out: 6 }, makeId));
    const take = (p.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).find((c) => c.uri.endsWith('late.m4a'))!;
    expect(take.start).toBeCloseTo(4.1, 9);
    expect(take.trimIn).toBe(0);
    expect(take.duration).toBeCloseTo(1.9, 9);
  });
  it('a tartományon teljesen belüli klip eltűnik, a kívüliek érintetlenek; üres sávra is megy', () => {
    const p0 = base();
    const inner: AudioClip = { ...(p0.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip), id: 'inner', start: 12, duration: 1 };
    const p1 = { ...p0, tracks: p0.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [...t.clips, inner] } : t)) };
    const p = run(p1, punchCommands(p1, 'voiceover', { uri: 'file:///t.m4a', seconds: 3, startAt: 11.5, label: 't' }, { in: 11.8, out: 13.5 }, makeId));
    const ids = p.tracks.find((t) => t.type === 'voiceover')!.clips.map((c) => c.id);
    expect(ids).toContain('old');
    expect(ids).not.toContain('inner');
    const empty = createEmptyProject('e', '9:16', undefined, 'audio');
    expect(run(empty, punchCommands(empty, 'voiceover', { uri: 'file:///t.m4a', seconds: 3, startAt: 0.7, label: 't' }, { in: 1, out: 3 }, makeId)).tracks.find((t) => t.type === 'voiceover')!.clips).toHaveLength(1);
  });
});

describe('take-ek (T4)', () => {
  const empty = () => createEmptyProject('t', '9:16', undefined, 'audio');
  const run = (p: Project, cmds: EditorCommand[]) => cmds.reduce((acc, c) => applyCommand(acc, c) ?? acc, p);
  const vo = (p: Project) => p.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[];
  const win = { in: 2, out: 4 };
  const rec = (name: string, startAt: number) => ({ uri: `file:///${name}.m4a`, seconds: 2.5, startAt, label: name });

  it('ugyanarra a helyre ismételt punch: nem vág, hanem új take — a régiek megmaradnak, az új szól', () => {
    let p = run(empty(), punchCommands(empty(), 'voiceover', rec('t1', 1.7), win, makeId));
    expect(takeSlot(p, 'voiceover', win)?.uri).toBe('file:///t1.m4a');
    p = run(p, punchCommands(p, 'voiceover', rec('t2', 1.75), win, makeId));
    p = run(p, punchCommands(p, 'voiceover', rec('t3', 1.72), win, makeId));
    const clips = vo(p);
    expect(clips).toHaveLength(1);
    const c = clips[0];
    expect(c.takes!.map((t) => t.uri.split('/').pop())).toEqual(['t1.m4a', 't2.m4a', 't3.m4a']);
    expect(c.uri).toBe('file:///t3.m4a');
    expect(c.activeTake).toBe(c.takes![2].id);
    expect(c.start).toBe(2);
    expect(c.duration).toBeCloseTo(2, 9);
    expect(c.trimIn).toBeCloseTo(0.28, 9);
    expect(c.takes![1].trimIn).toBeCloseTo(0.25, 9);
  });
  it('take választása: a klip a választott take hangja és helye (egy parancs); a már aktív újraválasztása nem lépés', () => {
    let p = run(empty(), punchCommands(empty(), 'voiceover', rec('a', 1.7), win, makeId));
    p = run(p, punchCommands(p, 'voiceover', rec('b', 1.8), win, makeId));
    const c = vo(p)[0];
    const first = c.takes![0];
    const cmd = selectTakeCommand(c, first.id)!;
    const q = run(p, [cmd]);
    expect(vo(q)[0].uri).toBe('file:///a.m4a');
    expect(vo(q)[0].trimIn).toBeCloseTo(0.3, 9);
    expect(vo(q)[0].activeTake).toBe(first.id);
    expect(vo(q)[0].takes).toHaveLength(2);
    expect(selectTakeCommand(vo(q)[0], first.id)).toBeNull();
    expect(selectTakeCommand(vo(q)[0], 'nincs')).toBeNull();
  });
  it('a take-es klip kettévágva: a darabok a mostani take hangjai, választó nélkül', () => {
    let p = run(empty(), punchCommands(empty(), 'voiceover', rec('a', 1.7), win, makeId));
    p = run(p, punchCommands(p, 'voiceover', rec('b', 1.8), win, makeId));
    const q = run(p, [{ type: 'SPLIT_CLIP', clipId: vo(p)[0].id, time: 3 }]);
    expect(vo(q)).toHaveLength(2);
    expect(vo(q).every((c) => c.uri === 'file:///b.m4a' && !c.takes && !c.activeTake)).toBe(true);
  });
  it('más tartomány (nem ugyanaz a hely) → nem take, hanem vágás', () => {
    let p = run(empty(), punchCommands(empty(), 'voiceover', rec('a', 1.7), win, makeId));
    p = run(p, punchCommands(p, 'voiceover', rec('b', 2.7), { in: 3, out: 5 }, makeId));
    expect(vo(p)).toHaveLength(2);
    expect(vo(p).every((c) => !c.takes)).toBe(true);
  });
});
