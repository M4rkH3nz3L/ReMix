import { describeCommand, type EditorCommand } from '@/lib/commands';
import { isHeavyCommand, slimForLog } from '@/lib/eventLog';
import type { Clip } from '@/types/project';

/** reális videóklip — a mezők a valódi projektekben is jelen vannak */
const clip = (i: number): Clip =>
  ({
    kind: 'video',
    id: `clip_${i}_k3n9x2p`,
    uri: `file:///var/mobile/Containers/Data/Application/1F2E-4A5B/Documents/media/IMG_${1000 + i}.mov`,
    start: i * 2.5,
    duration: 2.5,
    trimIn: 0,
    sourceDuration: 34.2,
    speed: 1,
    volume: 1,
    filterId: 'none',
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    adjust: { brightness: 0.05, contrast: 0.1, saturation: 0, temperature: 0 },
    transitionIn: { kind: 'fade', duration: 0.3 },
  }) as unknown as Clip;

const clips = (n: number) => Array.from({ length: n }, (_, i) => clip(i));
const size = (v: unknown) => JSON.stringify(v).length;

describe('eventLog — a napló ne hordozzon teljes klip-tömböket', () => {
  const heavy: EditorCommand = {
    type: 'REPLACE_TRACKS',
    tracks: [{ trackType: 'video', clips: clips(100) }],
    label: 'Tartomány törlése (3,0 mp)',
  };

  it('100 klipes REPLACE_TRACKS ~10× kisebb lesz (mérve: 39,9 KB → 4,0 KB)', () => {
    const before = size(heavy);
    const after = size(slimForLog(heavy));
    expect(before).toBeGreaterThan(30_000); // a mért ~40 KB
    // a maradék szinte teljes egészében a megtartott azonosító — szándékosan,
    // mert az mondja meg, MELYIK klipeket érintette a művelet
    expect(after * 9).toBeLessThan(before);
  });

  it('a DARABSZÁM megmarad — különben a napló hazudna', () => {
    const slim = slimForLog(heavy) as Extract<EditorCommand, { type: 'REPLACE_TRACKS' }>;
    expect(slim.tracks).toHaveLength(1);
    expect(slim.tracks[0].clips).toHaveLength(100);
  });

  it('az AZONOSÍTÓK megmaradnak (melyik klipet érintette)', () => {
    const slim = slimForLog(heavy) as Extract<EditorCommand, { type: 'REPLACE_TRACKS' }>;
    expect(slim.tracks[0].clips[0].id).toBe('clip_0_k3n9x2p');
    expect(slim.tracks[0].clips[99].id).toBe('clip_99_k3n9x2p');
  });

  it('a SÚLYOS mezők viszont eltűnnek', () => {
    const slim = slimForLog(heavy) as Extract<EditorCommand, { type: 'REPLACE_TRACKS' }>;
    const first = slim.tracks[0].clips[0] as unknown as Record<string, unknown>;
    expect(first.uri).toBeUndefined();
    expect(first.transform).toBeUndefined();
    expect(first.adjust).toBeUndefined();
    expect(Object.keys(first).sort()).toEqual(['id', 'kind']);
  });

  it('a LEÍRÁS betűre azonos marad (ez a napló egyetlen fogyasztója)', () => {
    expect(describeCommand(slimForLog(heavy))).toBe(describeCommand(heavy));
  });

  it('a leírás az összes nehéz command-fajtára azonos marad', () => {
    const cases: EditorCommand[] = [
      { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video', clips: clips(7) }] },
      { type: 'REPLACE_TRACK_CLIPS', trackType: 'text', clips: clips(3) },
      { type: 'ADD_CLIP', trackType: 'video', clip: clip(1) } as EditorCommand,
      { type: 'ADD_CLIPS', trackType: 'video', clips: clips(5) } as EditorCommand,
    ];
    for (const cmd of cases) {
      expect(describeCommand(slimForLog(cmd))).toBe(describeCommand(cmd));
    }
  });

  it('a label túléli a csonkolást (a range-törlés mp-értéke a naplóban marad)', () => {
    const slim = slimForLog(heavy) as Extract<EditorCommand, { type: 'REPLACE_TRACKS' }>;
    expect(slim.label).toBe('Tartomány törlése (3,0 mp)');
  });

  it('a KÖNNYŰ commandot érintetlenül, UGYANAZZAL a referenciával adja vissza', () => {
    const light: EditorCommand = { type: 'SPLIT_CLIP', clipId: 'a', time: 1.5 } as EditorCommand;
    expect(slimForLog(light)).toBe(light); // nincs fölösleges másolás a forró úton
    expect(isHeavyCommand(light)).toBe(false);
  });

  it('nem mutálja az EREDETI commandot (az megy a projektbe!)', () => {
    const before = size(heavy);
    slimForLog(heavy);
    expect(size(heavy)).toBe(before);
  });

  it('300 bejegyzéses napló az Android 2 MB/kulcs limit alá kerül', () => {
    const log = Array.from({ length: 300 }, (_, i) => ({
      id: `evt_${i}`,
      at: '2026-09-17T10:23:45.123Z',
      actor: 'user',
      command: slimForLog(heavy),
      slim: true,
    }));
    expect(size(log)).toBeLessThan(2 * 1024 * 1024);
  });
});
