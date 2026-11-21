import { applyCommand, type EditorCommand } from '@/lib/commands';
import { applyCommand as applyFromBus } from '@/lib/commandBus/applyCommand';
import { describeCommand as describeFromBus } from '@/lib/commandBus/describeCommand';
import { describeCommand } from '@/lib/commands';
import { reduceAddClip, reduceRemoveClip, reduceSplitClip } from '@/lib/commandBus/trackReducers';
import { reduceRelinkAsset } from '@/lib/commandBus/assetReducers';
import { reduceSetMarkers } from '@/lib/commandBus/timelineMetaReducers';
import { reduceSetBpm } from '@/lib/commandBus/audioReducers';
import { reduceSetFps } from '@/lib/commandBus/projectMetaReducers';
import { reduceUpsertImageDoc } from '@/lib/commandBus/docReducers';
import { deepFreeze } from '@/test-utils/projectFixtures';
import type { Asset, AudioClip, ImageDoc, Project, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🚌 A command-bus modulcsalád (REFACTOR): a barrel ugyanazt adja, mint a modulok; a diszpécser a
 * felelős reducerhez irányít; és a referenciális megosztás (===) — amire a React és az undo épít —
 * pontosan a mostani: mely ágak maradnak érintetlenek és melyek épülnek újra.
 */

const TRACK_TYPES: TrackType[] = ['video', 'pip', 'music', 'aux1'];

const video = (id: string, start = 0): VideoClip =>
  ({ id, kind: 'video', start, duration: 2, uri: `file:///${id}.mp4`, trimIn: 0, sourceDuration: 2, speed: 1, volume: 1, filterId: 'none' });
const audio = (id: string, start = 0): AudioClip =>
  ({ id, kind: 'audio', start, duration: 2, uri: `file:///${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });

function makeProject(overrides: Partial<Project> = {}): Project {
  return deepFreeze({
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: TRACK_TYPES.map((type): Track => ({
      id: `trk-${type}`,
      type,
      name: type,
      clips: type === 'video' ? [video('v1'), video('v2', 2)] : type === 'music' ? [audio('a1')] : [],
    })),
    assets: [{ id: 'as1', kind: 'video', uri: 'file:///v1.mp4' } as Asset],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...overrides,
  });
}

describe('barrel és modulok', () => {
  test('a barrel a modulcsalád függvényeit adja tovább (ugyanaz a referencia)', () => {
    expect(applyCommand).toBe(applyFromBus);
    expect(describeCommand).toBe(describeFromBus);
  });

  test('ismeretlen parancs-típus: undefined (nem null) — a switch-nek nincs default ága', () => {
    const p = makeProject();
    expect(applyCommand(p, { type: 'NOPE' } as unknown as EditorCommand)).toBeUndefined();
    expect(describeCommand({ type: 'NOPE' } as unknown as EditorCommand)).toBeUndefined();
  });

  test('hiányzó payload: a reducer TypeError-t dob (nincs védőág)', () => {
    expect(() => applyCommand(makeProject(), { type: 'RENAME_PROJECT' } as unknown as EditorCommand)).toThrow(TypeError);
  });
});

describe('diszpécser → reducer', () => {
  test('a diszpécser a reducer eredményét adja, ha nincs tempóhoz kötött delay', () => {
    const p = makeProject();
    const cases: [EditorCommand, (pr: Project, c: never) => Project | null][] = [
      [{ type: 'ADD_CLIP', trackType: 'video', clip: video('n1', 4) }, reduceAddClip as never],
      [{ type: 'REMOVE_CLIP', clipId: 'v1' }, reduceRemoveClip as never],
      [{ type: 'SET_MARKERS', markers: [{ id: 'm', time: 1 }] as Project['markers'] & object }, reduceSetMarkers as never],
      [{ type: 'SET_FPS', fps: 24 }, reduceSetFps as never],
      [{ type: 'SET_BPM', bpm: 90 }, reduceSetBpm as never],
    ];
    for (const [cmd, reducer] of cases) {
      expect(applyCommand(p, cmd)).toEqual(reducer(p, cmd as never));
    }
  });

  test('a tempóhoz kötött delay ms-e ugyanabban a lépésben frissül (retimeTempoDelays a reducer után)', () => {
    const delayed = { ...audio('d1'), audioFx: { delayBeats: 1, delayMs: 500 } } as AudioClip;
    const p = makeProject({
      tracks: [{ id: 'trk-music', type: 'music', name: 'music', clips: [delayed] }],
    });
    const raw = reduceSetBpm(p, { type: 'SET_BPM', bpm: 60 })!;
    expect((raw.tracks[0].clips[0] as AudioClip).audioFx?.delayMs).toBe(500);
    const next = applyCommand(p, { type: 'SET_BPM', bpm: 60 })!;
    expect((next.tracks[0].clips[0] as AudioClip).audioFx?.delayMs).toBe(1000);
  });
});

describe('referenciális megosztás (===)', () => {
  test('ADD_CLIP: csak a cél-sáv új; a többi sáv és az assets-tömb ugyanaz', () => {
    const p = makeProject();
    const next = applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: video('n1', 4) })!;
    expect(next.tracks[0]).not.toBe(p.tracks[0]);
    expect(next.tracks[0].clips[0]).toBe(p.tracks[0].clips[0]);
    expect(next.tracks.slice(1)).toEqual(p.tracks.slice(1));
    next.tracks.slice(1).forEach((t, i) => expect(t).toBe(p.tracks[i + 1]));
    expect(next.assets).toBe(p.assets);
  });

  test('ADD_CLIP azonos uri-jú assettel: a meglévő assetre mutat, az assets-tömb nem változik', () => {
    const p = makeProject();
    const next = applyCommand(p, {
      type: 'ADD_CLIP',
      trackType: 'video',
      clip: video('n1', 4),
      asset: { id: 'dup', kind: 'video', uri: 'file:///v1.mp4' } as Asset,
    })!;
    expect(next.assets).toBe(p.assets);
    expect((next.tracks[0].clips[2] as VideoClip).assetId).toBe('as1');
  });

  test('REMOVE_CLIP: MINDEN sáv új objektum (az érintetlenek is), de a megmaradt klipek ugyanazok', () => {
    const p = makeProject();
    const next = applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'v1' })!;
    next.tracks.forEach((t, i) => expect(t).not.toBe(p.tracks[i]));
    expect(next.tracks[0].clips).toEqual([p.tracks[0].clips[1]]);
    expect(next.tracks[0].clips[0]).toBe(p.tracks[0].clips[1]);
    expect(next.tracks[2].clips[0]).toBe(p.tracks[2].clips[0]);
  });

  test('SPLIT_CLIP: csak a klip sávja új; a többi sáv ugyanaz', () => {
    const p = makeProject();
    const next = reduceSplitClip(p, { type: 'SPLIT_CLIP', clipId: 'v2', time: 3 })!;
    expect(next.tracks[0].clips).toHaveLength(3);
    expect(next.tracks[0].clips[0]).toBe(p.tracks[0].clips[0]);
    next.tracks.slice(1).forEach((t, i) => expect(t).toBe(p.tracks[i + 1]));
  });

  test('MOVE_CLIP másik sávra: a forrás- és a cél-sáv új, a harmadik ugyanaz', () => {
    const p = makeProject();
    const next = applyCommand(p, { type: 'MOVE_CLIP', clipId: 'v1', toTrackType: 'pip', start: 1 })!;
    expect(next.tracks[0]).not.toBe(p.tracks[0]);
    expect(next.tracks[1].clips.map((c) => c.id)).toEqual(['v1']);
    expect(next.tracks[2]).toBe(p.tracks[2]);
    expect(next.tracks[3]).toBe(p.tracks[3]);
  });

  test('REPLACE_TRACK_CLIPS: a parancs klip-tömbje kerül be (nincs másolás)', () => {
    const p = makeProject();
    const clips = [video('r1')];
    const next = applyCommand(p, { type: 'REPLACE_TRACK_CLIPS', trackType: 'pip', clips })!;
    expect(next.tracks[1].clips).toBe(clips);
    expect(next.tracks[0]).toBe(p.tracks[0]);
  });

  test('UPSERT_IMAGE_DOC: a parancs doc-ja kerül be; azonos tartalom → null', () => {
    const doc = { id: 'd1', name: 'd', aspectRatio: '1:1', width: 1, height: 1, layers: [] } as unknown as ImageDoc;
    const p = makeProject();
    const next = reduceUpsertImageDoc(p, { type: 'UPSERT_IMAGE_DOC', doc })!;
    expect(next.imageDocs![0]).toBe(doc);
    expect(next.tracks).toBe(p.tracks);
    expect(applyCommand(deepFreeze(next), { type: 'UPSERT_IMAGE_DOC', doc: { ...doc } })).toBeNull();
  });

  test('RELINK_ASSET: azonos uri, extra mező nélkül → null; csak hosszal → új asset, változatlan sávok', () => {
    const p = makeProject();
    expect(reduceRelinkAsset(p, { type: 'RELINK_ASSET', assetId: 'as1', newUri: 'file:///v1.mp4' })).toBeNull();
    const next = applyCommand(p, { type: 'RELINK_ASSET', assetId: 'as1', newUri: 'file:///v1.mp4', duration: 9 })!;
    expect(next.assets[0]).toEqual({ id: 'as1', kind: 'video', uri: 'file:///v1.mp4', duration: 9 });
    expect(next.tracks).toBe(p.tracks);
  });

  test('a lista-cserék üres listánál undefined-értékű kulcsot hagynak (nem törlik a kulcsot)', () => {
    const p = makeProject({ markers: [{ id: 'm', time: 1 }] as Project['markers'] });
    const next = applyCommand(p, { type: 'SET_MARKERS', markers: [] })!;
    expect('markers' in next).toBe(true);
    expect(next.markers).toBeUndefined();
  });
});
