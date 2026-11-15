import { applyCommand } from '@/lib/commands';
import { createEmptyProject } from '@/lib/projectUtils';
import { onDeviceStemCommands, stemClipsFrom } from '@/lib/stemClips';
import type { AudioClip } from '@/types/project';

const source: AudioClip = {
  kind: 'audio', id: 'c1', uri: 'file:///song.m4a', label: 'Dal', start: 4, duration: 6, trimIn: 10, sourceDuration: 60,
  volume: 0.7, fadeIn: 0.5, fadeOut: 1, pan: -0.3, source: 'imported', audioFx: { highpass: 80 }, assetId: 'a1',
};
const stems = [
  { name: 'vocals', url: 'https://w/vocals.wav' },
  { name: 'drums', url: 'https://w/drums.wav' },
];
let n = 0;
const build = () => stemClipsFrom(source, stems, () => `s${++n}`);

describe('stemClipsFrom (A3)', () => {
  it('a stem a teljes forrásból készül, így ugyanazt a szakaszt adja, mint a vágott klip', () => {
    const [{ clip }] = build();
    expect(clip).toMatchObject({ start: 4, duration: 6, trimIn: 10, sourceDuration: 60 });
  });

  it('a klip beállításai a stemekre is átkerülnek', () => {
    const [{ clip }] = build();
    expect(clip).toMatchObject({ volume: 0.7, fadeIn: 0.5, fadeOut: 1, pan: -0.3, audioFx: { highpass: 80 } });
  });

  it('új azonosítót és saját forrást kap, a régi asset nem tapad rá', () => {
    const [a, b] = build();
    expect(a.clip.id).not.toBe(b.clip.id);
    expect(a.clip.uri).toBe('https://w/vocals.wav');
    expect(a.clip.label).toBe('vocals');
    expect(a.clip.assetId).toBeUndefined();
  });

  it('az ének a voiceover sávra kerül, a többi az sfx-re', () => {
    const [a, b] = build();
    expect(a.trackType).toBe('voiceover');
    expect(a.clip.source).toBe('voiceover');
    expect(b.trackType).toBe('sfx');
    expect(b.clip.source).toBe('imported');
  });

  it('a hiányzó trimIn és sourceDuration a klipből adódik', () => {
    const plain: AudioClip = { ...source, trimIn: undefined, sourceDuration: undefined };
    const [{ clip }] = stemClipsFrom(plain, stems, () => 'x');
    expect(clip).toMatchObject({ trimIn: 0, sourceDuration: 6 });
  });
});

describe('onDeviceStemCommands — V5 telefonos ének + kíséret', () => {
  const src = {
    kind: 'audio' as const, id: 'c', uri: 'file:///song.wav', label: 'dal', start: 3, duration: 10, trimIn: 5, sourceDuration: 200, volume: 0.8, fadeIn: 0.5, fadeOut: 0, source: 'imported' as const,
    instrumentDocId: 'd1', tune: { sourceUri: 'file:///x.wav', root: 0, minor: false, strength: 1 }, assetId: 'ast1', audioFx: { reverb: 0.2 },
  };
  const project = () => {
    const b = createEmptyProject('p', '9:16', undefined, 'audio');
    return { ...b, tracks: b.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [src] } : t)) };
  };
  let n = 0;
  const ids = (p: string) => `${p}_${n++}`;

  test('két új aux sáv a klip vágásával, a forráshoz kötött mezők nélkül; az eredeti néma', () => {
    const cmds = onDeviceStemCommands(project(), src, { vocalsUri: 'file:///v.wav', accompanimentUri: 'file:///a.wav' }, { vocals: 'Ének', accompaniment: 'Kíséret' }, ids)!;
    let p = project();
    for (const c of cmds) p = applyCommand(p, c) ?? p;
    const aux = p.tracks.filter((t) => t.type === 'aux1' || t.type === 'aux2');
    expect(aux.map((t) => t.name)).toEqual(['Ének', 'Kíséret']);
    const v = aux[0].clips[0] as typeof src;
    expect([v.uri, v.start, v.trimIn, v.duration, v.sourceDuration, v.fadeIn]).toEqual(['file:///v.wav', 3, 5, 10, 200, 0.5]);
    expect(v.instrumentDocId).toBeUndefined();
    expect(v.tune).toBeUndefined();
    expect(v.audioFx).toEqual({ reverb: 0.2 });
    expect((p.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume).toBe(0);
  });

  test('ha nincs két szabad aux sáv: null', () => {
    const b = project();
    const full = { ...b, tracks: [...b.tracks, ...(['aux1', 'aux2', 'aux3', 'aux4'] as const).map((type) => ({ id: type, type, name: type, clips: [] }))] };
    expect(onDeviceStemCommands(full, src, { vocalsUri: 'v', accompanimentUri: 'a' }, { vocals: 'V', accompaniment: 'A' }, ids)).toBeNull();
  });
});
