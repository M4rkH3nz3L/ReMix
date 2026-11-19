import { applyCommand, describeCommand, type EditorCommand } from '@/lib/commands';
import type { AlbumDoc, Asset, AudioBus, ImageDoc, InstrumentDoc, Project, Track, TrackType, VideoClip } from '@/types/project';
import type { LiveDoc } from '@/types/live';
import type { Model3DDoc } from '@/types/model3d';
import type { WorkflowRun } from '@/lib/workflowTemplate';

/**
 * 🧱 A reducer azon parancsai, amiket a commands.test.ts nem érint: projekt-beállítások, dokumentumok,
 * hang-keverő, album, snapshot, relink — mindegyiknél a változás ÉS a no-op (`null`) ág, a szorítások,
 * valamint a describeCommand minden parancsra. A bemenet minden esetben mélyen fagyasztva (immutabilitás).
 */

const TRACK_TYPES: TrackType[] = ['video', 'text', 'music', 'voiceover', 'sfx', 'aux1'];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return deepFreeze({
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: TRACK_TYPES.map((type): Track => ({ id: `trk-${type}`, type, name: type, clips: [] })),
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...overrides,
  });
}

const apply = (p: Project, cmd: EditorCommand) => applyCommand(p, cmd);
const image = (id: string): Asset => ({ id, kind: 'image', uri: `file:///${id}.png`, name: id }) as Asset;
const video = (id: string, uri = `file:///${id}.mp4`): VideoClip =>
  ({ id, kind: 'video', start: 0, duration: 2, uri, trimIn: 0, sourceDuration: 2, speed: 1, volume: 1, filterId: 'none' });
const imageDoc = (id: string) => ({ id, name: id, aspectRatio: '1:1', width: 10, height: 10, layers: [] }) as unknown as ImageDoc;

describe('projekt-beállítások', () => {
  test('SET_PROJECT_SYNC: csak valódi váltás', () => {
    expect(apply(makeProject(), { type: 'SET_PROJECT_SYNC', enabled: false })).toBeNull();
    const on = apply(makeProject(), { type: 'SET_PROJECT_SYNC', enabled: true })!;
    expect(on.syncToRemix).toBe(true);
    expect(apply(deepFreeze(on), { type: 'SET_PROJECT_SYNC', enabled: true })).toBeNull();
  });

  test('SET_PROJECT_SEO: mindig beírja', () => {
    const seo = { title: 'T' } as Project['seo'];
    expect(apply(makeProject(), { type: 'SET_PROJECT_SEO', seo: seo! })!.seo).toEqual(seo);
  });

  test('SET_PROJECT_COVER: csak kép; a régi borító-asset kikerül; törlés', () => {
    const p = makeProject();
    expect(apply(p, { type: 'SET_PROJECT_COVER', asset: null })).toBeNull();
    expect(apply(p, { type: 'SET_PROJECT_COVER', asset: { ...image('v'), kind: 'video' } as Asset })).toBeNull();
    const a = deepFreeze(apply(p, { type: 'SET_PROJECT_COVER', asset: image('c1') })!);
    expect(a.coverAssetId).toBe('c1');
    expect(a.assets.map((x) => x.id)).toEqual(['c1']);
    expect(apply(a, { type: 'SET_PROJECT_COVER', asset: image('c1') })).toBeNull();
    const b = deepFreeze(apply(a, { type: 'SET_PROJECT_COVER', asset: image('c2') })!);
    expect(b.assets.map((x) => x.id)).toEqual(['c2']);
    const cleared = apply(b, { type: 'SET_PROJECT_COVER', asset: null })!;
    expect('coverAssetId' in cleared).toBe(false);
    expect(cleared.assets).toEqual([]);
  });

  test('SET_PROJECT_FONTS: azonos lista no-op, üres lista törli a mezőt', () => {
    const fonts = [{ family: 'Inter', uri: 'file:///i.ttf' }] as unknown as NonNullable<Project['fonts']>;
    expect(apply(makeProject(), { type: 'SET_PROJECT_FONTS', fonts: [] })).toBeNull();
    const withFonts = deepFreeze(apply(makeProject(), { type: 'SET_PROJECT_FONTS', fonts })!);
    expect(withFonts.fonts).toEqual(fonts);
    expect(apply(withFonts, { type: 'SET_PROJECT_FONTS', fonts })).toBeNull();
    expect('fonts' in apply(withFonts, { type: 'SET_PROJECT_FONTS', fonts: [] })!).toBe(false);
  });

  test('SET_THUMBNAIL_DOC: csak létező lapra; null törli', () => {
    const p = makeProject({ imageDocs: [imageDoc('d1')] });
    expect(apply(p, { type: 'SET_THUMBNAIL_DOC', docId: 'nincs' })).toBeNull();
    expect(apply(p, { type: 'SET_THUMBNAIL_DOC', docId: null })).toBeNull();
    const set = deepFreeze(apply(p, { type: 'SET_THUMBNAIL_DOC', docId: 'd1' })!);
    expect(set.thumbnailDocId).toBe('d1');
    expect(apply(set, { type: 'SET_THUMBNAIL_DOC', docId: 'd1' })).toBeNull();
    expect('thumbnailDocId' in apply(set, { type: 'SET_THUMBNAIL_DOC', docId: null })!).toBe(false);
  });

  test('SET_PARTICLES: azonos konfig no-op, null kikapcsol', () => {
    const cfg = { preset: 'snow', density: 0.5 } as unknown as NonNullable<Project['particles']>;
    expect(apply(makeProject(), { type: 'SET_PARTICLES', particles: null })).toBeNull();
    const on = deepFreeze(apply(makeProject(), { type: 'SET_PARTICLES', particles: cfg })!);
    expect(apply(on, { type: 'SET_PARTICLES', particles: { ...cfg } })).toBeNull();
    expect(apply(on, { type: 'SET_PARTICLES', particles: null })!.particles).toBeUndefined();
  });

  test('SET_TIME_SIGNATURE: 1–16 közé szorít, a beatUnit csak 4 vagy 8', () => {
    expect(apply(makeProject(), { type: 'SET_TIME_SIGNATURE', timeSignature: { beatsPerBar: 4, beatUnit: 4 } })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_TIME_SIGNATURE', timeSignature: { beatsPerBar: 40, beatUnit: 8 } })!.timeSignature).toEqual({ beatsPerBar: 16, beatUnit: 8 });
    expect(apply(makeProject(), { type: 'SET_TIME_SIGNATURE', timeSignature: { beatsPerBar: 0, beatUnit: 4 } })!.timeSignature).toEqual({ beatsPerBar: 1, beatUnit: 4 });
    expect(apply(makeProject(), { type: 'SET_TIME_SIGNATURE', timeSignature: { beatsPerBar: 2.6, beatUnit: 5 as 4 } })!.timeSignature).toEqual({ beatsPerBar: 3, beatUnit: 4 });
  });

  test('SET_BPM: 20–300 közé szorít, kerekít; az alap 120', () => {
    expect(apply(makeProject(), { type: 'SET_BPM', bpm: 120 })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_BPM', bpm: 119.6 })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_BPM', bpm: 5 })!.bpm).toBe(20);
    expect(apply(makeProject(), { type: 'SET_BPM', bpm: 999 })!.bpm).toBe(300);
  });

  test('SET_WORKFLOW_RUN: azonos no-op, null törli', () => {
    const run = { templateId: 't', step: 1 } as unknown as WorkflowRun;
    expect(apply(makeProject(), { type: 'SET_WORKFLOW_RUN', run: null })).toBeNull();
    const on = deepFreeze(apply(makeProject(), { type: 'SET_WORKFLOW_RUN', run })!);
    expect(apply(on, { type: 'SET_WORKFLOW_RUN', run: { ...run } })).toBeNull();
    expect('workflowRun' in apply(on, { type: 'SET_WORKFLOW_RUN', run: null })!).toBe(false);
  });

  test('SET_TEMPO_MAP: normalizál, üres törli', () => {
    expect(apply(makeProject(), { type: 'SET_TEMPO_MAP', tempoMap: [] })).toBeNull();
    const on = deepFreeze(apply(makeProject(), { type: 'SET_TEMPO_MAP', tempoMap: [{ atBeat: 8, bpm: 90 }] })!);
    expect(on.tempoMap).toEqual([{ atBeat: 8, bpm: 90 }]);
    expect(apply(on, { type: 'SET_TEMPO_MAP', tempoMap: [{ atBeat: 8, bpm: 90 }] })).toBeNull();
    expect('tempoMap' in apply(on, { type: 'SET_TEMPO_MAP', tempoMap: [] })!).toBe(false);
  });
});

describe('dokumentumok', () => {
  test('UPSERT_INSTRUMENT_DOC: új hozzáfűzve, azonos no-op, módosított cserélve', () => {
    const doc = { id: 'i1', kind: 'drums', steps: [] } as unknown as InstrumentDoc;
    const one = deepFreeze(apply(makeProject(), { type: 'UPSERT_INSTRUMENT_DOC', doc })!);
    expect(one.instrumentDocs).toEqual([doc]);
    expect(apply(one, { type: 'UPSERT_INSTRUMENT_DOC', doc: { ...doc } })).toBeNull();
    const changed = { ...doc, steps: [1] } as unknown as InstrumentDoc;
    expect(apply(one, { type: 'UPSERT_INSTRUMENT_DOC', doc: changed })!.instrumentDocs).toEqual([changed]);
  });

  test('REMOVE_IMAGE_DOC: ismeretlen no-op; az utolsó lap után a mező törlődik; a thumbnail-hivatkozás is', () => {
    const p = makeProject({ imageDocs: [imageDoc('a'), imageDoc('b')], thumbnailDocId: 'a' });
    expect(apply(p, { type: 'REMOVE_IMAGE_DOC', docId: 'x' })).toBeNull();
    const noA = deepFreeze(apply(p, { type: 'REMOVE_IMAGE_DOC', docId: 'a' })!);
    expect(noA.imageDocs!.map((d) => d.id)).toEqual(['b']);
    expect('thumbnailDocId' in noA).toBe(false);
    expect(apply(noA, { type: 'REMOVE_IMAGE_DOC', docId: 'b' })!.imageDocs).toBeUndefined();
    const keepThumb = apply(p, { type: 'REMOVE_IMAGE_DOC', docId: 'b' })!;
    expect(keepThumb.thumbnailDocId).toBe('a');
  });

  test('REORDER_IMAGE_DOCS: stabil rendezés, a nem említett lapok a végén; változatlan sorrend no-op', () => {
    const p = makeProject({ imageDocs: [imageDoc('a'), imageDoc('b'), imageDoc('c')] });
    expect(apply(makeProject({ imageDocs: [imageDoc('a')] }), { type: 'REORDER_IMAGE_DOCS', order: ['a'] })).toBeNull();
    expect(apply(p, { type: 'REORDER_IMAGE_DOCS', order: ['a', 'b'] })).toBeNull();
    expect(apply(p, { type: 'REORDER_IMAGE_DOCS', order: ['c'] })!.imageDocs!.map((d) => d.id)).toEqual(['c', 'a', 'b']);
  });

  test('SET_LIVE_DOC / SET_MODEL3D_DOC: azonos dokumentum no-op', () => {
    const live = { id: 'l', scenes: [] } as unknown as LiveDoc;
    const withLive = deepFreeze(apply(makeProject(), { type: 'SET_LIVE_DOC', doc: live })!);
    expect(withLive.live).toEqual(live);
    expect(apply(withLive, { type: 'SET_LIVE_DOC', doc: { ...live } })).toBeNull();
    const m3d = { id: 'm', nodes: [] } as unknown as Model3DDoc;
    const withModel = deepFreeze(apply(makeProject(), { type: 'SET_MODEL3D_DOC', doc: m3d })!);
    expect(withModel.model3d).toEqual(m3d);
    expect(apply(withModel, { type: 'SET_MODEL3D_DOC', doc: { ...m3d } })).toBeNull();
  });
});

describe('hang-keverő', () => {
  test('SET_TRACK_SIDECHAIN: önmagára nem; arány 2–20 közé, tizedre; a gain megmarad', () => {
    expect(apply(makeProject(), { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: null })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'music', ratio: 4 } })).toBeNull();
    const p = makeProject({ trackMix: { music: { gain: 0.5 } } });
    const on = deepFreeze(apply(p, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'voiceover', ratio: 99 } })!);
    expect(on.trackMix!.music).toEqual({ gain: 0.5, sidechain: { from: 'voiceover', ratio: 20 } });
    expect(apply(on, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: { from: 'voiceover', ratio: 20 } })).toBeNull();
    expect(apply(on, { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: null })!.trackMix!.music).toEqual({ gain: 0.5 });
    expect(apply(makeProject(), { type: 'SET_TRACK_SIDECHAIN', trackType: 'sfx', sidechain: { from: 'voiceover', ratio: 1.04 } })!.trackMix!.sfx).toEqual({ gain: 1, sidechain: { from: 'voiceover', ratio: 2 } });
  });

  test('SET_TRACK_GAIN: 0–1 közé szorít, az alap 1 no-op; a sidechain megmarad', () => {
    expect(apply(makeProject(), { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 1 })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 5 })).toBeNull();
    const sc = { from: 'voiceover', ratio: 4 } as const;
    const p = makeProject({ trackMix: { music: { gain: 1, sidechain: sc } } });
    expect(apply(p, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: -1 })!.trackMix!.music).toEqual({ gain: 0, sidechain: sc });
  });

  test('ADD_TRACK / REMOVE_TRACK / RENAME_TRACK', () => {
    const p = makeProject();
    expect(apply(p, { type: 'ADD_TRACK', track: { id: 'x', type: 'music', name: 'm', clips: [] } })).toBeNull();
    const added = deepFreeze(apply(p, { type: 'ADD_TRACK', track: { id: 'a2', type: 'aux2', name: 'Aux 2' } as Track })!);
    expect(added.tracks.at(-1)).toEqual({ id: 'a2', type: 'aux2', name: 'Aux 2', clips: [] });
    // csak az üres aux-sáv törölhető; a gain/küldés is eltűnik
    expect(apply(p, { type: 'REMOVE_TRACK', trackType: 'music' })).toBeNull();
    expect(apply(p, { type: 'REMOVE_TRACK', trackType: 'aux3' })).toBeNull();
    const withClip = makeProject({ tracks: p.tracks.map((t) => (t.type === 'aux1' ? { ...t, clips: [video('v')] } : t)) as Track[] });
    expect(apply(withClip, { type: 'REMOVE_TRACK', trackType: 'aux1' })).toBeNull();
    const mixed = makeProject({ trackMix: { aux1: { gain: 0.3 }, music: { gain: 0.9 } }, audioSends: { aux1: { b: 0.5 } } });
    const removed = apply(mixed, { type: 'REMOVE_TRACK', trackType: 'aux1' })!;
    expect(removed.tracks.some((t) => t.type === 'aux1')).toBe(false);
    expect(removed.trackMix).toEqual({ music: { gain: 0.9 } });
    expect(removed.audioSends).toEqual({});
    expect(apply(makeProject(), { type: 'REMOVE_TRACK', trackType: 'aux1' })!.trackMix).toEqual({});
    // átnevezés: trimmel, üres / azonos / ismeretlen no-op
    expect(apply(p, { type: 'RENAME_TRACK', trackType: 'music', name: '  Zene ' })!.tracks.find((t) => t.type === 'music')!.name).toBe('Zene');
    expect(apply(p, { type: 'RENAME_TRACK', trackType: 'music', name: '   ' })).toBeNull();
    expect(apply(p, { type: 'RENAME_TRACK', trackType: 'music', name: 'music' })).toBeNull();
    expect(apply(p, { type: 'RENAME_TRACK', trackType: 'pip', name: 'x' })).toBeNull();
  });

  test('SET_AUDIO_BUSES: a törölt buszra szóló küldés is eltűnik', () => {
    const buses = [{ id: 'b1', name: 'Rev' }] as unknown as AudioBus[];
    const p = makeProject({ audioSends: { music: { b1: 0.4, b2: 0.7 }, sfx: undefined as unknown as Record<string, number> } });
    const next = apply(p, { type: 'SET_AUDIO_BUSES', buses })!;
    expect(next.audioBuses).toEqual(buses);
    expect(next.audioSends).toEqual({ music: { b1: 0.4 }, sfx: {} });
    expect(apply(makeProject(), { type: 'SET_AUDIO_BUSES', buses: [] })!.audioSends).toEqual({});
  });

  test('SET_TRACK_SEND: csak létező buszra; 0–1 közé szorít; azonos no-op', () => {
    const p = makeProject({ audioBuses: [{ id: 'b1', name: 'Rev' }] as unknown as AudioBus[] });
    expect(apply(p, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'nincs', amount: 0.5 })).toBeNull();
    expect(apply(p, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b1', amount: 0 })).toBeNull();
    expect(apply(makeProject(), { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b1', amount: 0.5 })).toBeNull();
    const on = deepFreeze(apply(p, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b1', amount: 3 })!);
    expect(on.audioSends).toEqual({ music: { b1: 1 } });
    expect(apply(on, { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b1', amount: 1 })).toBeNull();
  });

  test('SET_AUDIO_MASTER: azonos no-op, null törli', () => {
    const m = { preset: 'loud' } as unknown as NonNullable<Project['audioMaster']>;
    expect(apply(makeProject(), { type: 'SET_AUDIO_MASTER', audioMaster: null })).toBeNull();
    const on = deepFreeze(apply(makeProject(), { type: 'SET_AUDIO_MASTER', audioMaster: m })!);
    expect(apply(on, { type: 'SET_AUDIO_MASTER', audioMaster: { ...m } })).toBeNull();
    expect(apply(on, { type: 'SET_AUDIO_MASTER', audioMaster: null })!.audioMaster).toBeUndefined();
  });
});

describe('idővonal-listák', () => {
  test('SET_CHAPTERS / SET_REGIONS: rendez, azonos no-op, üres törli', () => {
    const ch = [{ id: 'b', start: 5, title: 'B' }, { id: 'a', start: 1, title: 'A' }] as unknown as NonNullable<Project['chapters']>;
    const p = deepFreeze(apply(makeProject(), { type: 'SET_CHAPTERS', chapters: ch })!);
    expect(p.chapters!.map((c) => c.start)).toEqual([1, 5]);
    expect(apply(p, { type: 'SET_CHAPTERS', chapters: [...ch].reverse() })).toBeNull();
    expect(apply(p, { type: 'SET_CHAPTERS', chapters: [] })!.chapters).toBeUndefined();
    expect(apply(makeProject(), { type: 'SET_CHAPTERS', chapters: [] })).toBeNull();
    const rg = [{ id: 'r2', start: 3, end: 4 }, { id: 'r1', start: 0, end: 1 }] as unknown as NonNullable<Project['regions']>;
    const r = deepFreeze(apply(makeProject(), { type: 'SET_REGIONS', regions: rg })!);
    expect(r.regions!.map((x) => x.start)).toEqual([0, 3]);
    expect(apply(r, { type: 'SET_REGIONS', regions: rg })).toBeNull();
    expect(apply(r, { type: 'SET_REGIONS', regions: [] })!.regions).toBeUndefined();
  });

  test('SET_LOCKED_TRACKS: egyedi + rendezett, üres törli', () => {
    const p = deepFreeze(apply(makeProject(), { type: 'SET_LOCKED_TRACKS', lockedTracks: ['music', 'text', 'music'] })!);
    expect(p.lockedTracks).toEqual(['music', 'text']);
    expect(apply(p, { type: 'SET_LOCKED_TRACKS', lockedTracks: ['text', 'music'] })).toBeNull();
    expect(apply(p, { type: 'SET_LOCKED_TRACKS', lockedTracks: [] })!.lockedTracks).toBeUndefined();
  });

  test('SET_LINKS: csak a 2+ elemű csoportok, rendezve; üres törli', () => {
    const p = deepFreeze(apply(makeProject(), { type: 'SET_LINKS', links: [['b', 'a'], ['solo']] })!);
    expect(p.links).toEqual([['a', 'b']]);
    expect(apply(p, { type: 'SET_LINKS', links: [['a', 'b']] })).toBeNull();
    expect(apply(p, { type: 'SET_LINKS', links: [['x']] })!.links).toBeUndefined();
  });
});

describe('album', () => {
  const song = (id: string, clipId: string) => ({ id, name: id, tracks: [{ id: 't', type: 'music', name: 'm', clips: [{ ...video(clipId) }] }], assets: [] });

  test('APPLY_ALBUM: a jelenlegi idővonal az előző aktív számba mentődik, az új aktív szám töltődik be', () => {
    const p = makeProject();
    const album = { activeSongId: 's1', songs: [song('s1', 'c1'), song('s2', 'c2')] } as unknown as AlbumDoc;
    const one = deepFreeze(apply(p, { type: 'APPLY_ALBUM', album })!);
    expect(one.tracks).toEqual(album.songs[0].tracks);
    // váltás s2-re: s1 a jelenlegi (s1) sávokat kapja, a projektbe s2 kerül
    const two = apply(one, { type: 'APPLY_ALBUM', album: { ...one.album!, activeSongId: 's2' } })!;
    expect(two.tracks).toEqual(album.songs[1].tracks);
    expect(two.album!.songs[0].tracks).toBe(one.tracks);
  });

  test('APPLY_ALBUM: változatlan album no-op; ismeretlen aktív szám a jelenlegi sávokat hagyja', () => {
    const album = { activeSongId: 's1', songs: [song('s1', 'c1')] } as unknown as AlbumDoc;
    const one = deepFreeze(apply(makeProject(), { type: 'APPLY_ALBUM', album })!);
    expect(apply(one, { type: 'APPLY_ALBUM', album: one.album! })).toBeNull();
    const p = makeProject();
    const orphan = apply(p, { type: 'APPLY_ALBUM', album: { activeSongId: 'nincs', songs: [] } as unknown as AlbumDoc })!;
    expect(orphan.tracks).toBe(p.tracks);
    expect(apply(deepFreeze(orphan), { type: 'APPLY_ALBUM', album: orphan.album! })).toBeNull();
  });
});

describe('snapshot, sávcsere, relink', () => {
  test('RESTORE_SNAPSHOT: csak ugyanarra a projektre; az eszköz-szintű mezők helyiek maradnak', () => {
    const p = makeProject({ folder: 'Projektek/teszt', syncToRemix: true });
    expect(apply(p, { type: 'RESTORE_SNAPSHOT', project: { ...p, id: 'más' } })).toBeNull();
    const snap = { ...makeProject({ name: 'Régi' }), folder: 'idegen', syncToRemix: false };
    const r = apply(p, { type: 'RESTORE_SNAPSHOT', project: snap })!;
    expect(r.name).toBe('Régi');
    expect(r.folder).toBe('Projektek/teszt');
    expect(r.syncToRemix).toBe(true);
  });

  test('REPLACE_TRACKS: üres lista no-op; csak az új assetek kerülnek be', () => {
    const p = makeProject({ assets: [image('a1')] });
    expect(apply(p, { type: 'REPLACE_TRACKS', tracks: [] })).toBeNull();
    const r = apply(p, { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video', clips: [video('v1')] }], assets: [image('a1'), image('a2')] })!;
    expect(r.assets.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(r.tracks.find((t) => t.type === 'video')!.clips.map((c) => c.id)).toEqual(['v1']);
    expect(r.tracks.find((t) => t.type === 'music')).toBe(p.tracks.find((t) => t.type === 'music'));
    expect(apply(p, { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video', clips: [] }] })!.assets).toEqual(p.assets);
  });

  test('RELINK_URI: azonos / nem hivatkozott uri no-op; klipen és asseten is cserél', () => {
    const p = makeProject({ assets: [{ ...image('a1'), uri: 'file:///old.png' }], tracks: makeProject().tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video('v', 'file:///old.mp4')] } : t)) as Track[] });
    expect(apply(p, { type: 'RELINK_URI', oldUri: 'file:///x', newUri: 'file:///x' })).toBeNull();
    expect(apply(p, { type: 'RELINK_URI', oldUri: 'file:///nincs', newUri: 'file:///y' })).toBeNull();
    const clipRelinked = apply(p, { type: 'RELINK_URI', oldUri: 'file:///old.mp4', newUri: 'file:///new.mp4' })!;
    expect((clipRelinked.tracks.find((t) => t.type === 'video')!.clips[0] as VideoClip).uri).toBe('file:///new.mp4');
    expect(apply(p, { type: 'RELINK_URI', oldUri: 'file:///old.png', newUri: 'file:///new.png' })!.assets[0].uri).toBe('file:///new.png');
  });

  test('RELINK_ASSET: forrás-verzió és hossz az assetre; ismeretlen asset no-op', () => {
    const p = makeProject({ assets: [{ ...image('a1'), uri: 'file:///a.png' }] });
    expect(apply(p, { type: 'RELINK_ASSET', assetId: 'nincs', newUri: 'file:///b.png' })).toBeNull();
    expect(apply(p, { type: 'RELINK_ASSET', assetId: 'a1', newUri: 'file:///a.png' })).toBeNull();
    expect(apply(p, { type: 'RELINK_ASSET', assetId: 'nincs', newUri: 'file:///b.png', duration: 3 })).toBeNull();
    const withDur = apply(p, { type: 'RELINK_ASSET', assetId: 'a1', newUri: 'file:///a.png', duration: 3 })!;
    expect(withDur.assets[0]).toMatchObject({ uri: 'file:///a.png', duration: 3 });
    const source = { kind: 'linked', version: 2 } as unknown as NonNullable<Asset['source']>;
    const withSource = apply(p, { type: 'RELINK_ASSET', assetId: 'a1', newUri: 'file:///c.png', source })!;
    expect(withSource.assets[0]).toMatchObject({ uri: 'file:///c.png', source });
    expect(apply(deepFreeze(withDur), { type: 'RELINK_ASSET', assetId: 'a1', newUri: 'file:///a.png', duration: 3 })).toBeNull();
  });
});

describe('describeCommand — minden parancsnak van címkéje', () => {
  const p = makeProject();
  const cmds: EditorCommand[] = [
    { type: 'ADD_CLIP', trackType: 'video', clip: video('v') },
    { type: 'ADD_CLIPS', trackType: 'video', clips: [video('v')] },
    { type: 'UPDATE_CLIP', clipId: 'v', patch: { volume: 1 } },
    { type: 'REMOVE_CLIP', clipId: 'v' },
    { type: 'MOVE_CLIP', clipId: 'v', toTrackType: 'video', start: 1 },
    { type: 'SPLIT_CLIP', clipId: 'v', time: 1 },
    { type: 'SET_ASPECT', aspectRatio: '1:1' },
    { type: 'SET_FPS', fps: 25 },
    { type: 'RENAME_PROJECT', name: 'X' },
    { type: 'SET_PROJECT_SYNC', enabled: true },
    { type: 'SET_PROJECT_SYNC', enabled: false },
    { type: 'SET_PROJECT_COVER', asset: image('c') },
    { type: 'SET_PROJECT_COVER', asset: null },
    { type: 'SET_PROJECT_SEO', seo: {} as NonNullable<Project['seo']> },
    { type: 'SET_THUMBNAIL_DOC', docId: 'd' },
    { type: 'SET_THUMBNAIL_DOC', docId: null },
    { type: 'SET_PROJECT_FONTS', fonts: [] },
    { type: 'SET_PARTICLES', particles: { preset: 'snow' } as unknown as NonNullable<Project['particles']> },
    { type: 'SET_PARTICLES', particles: null },
    { type: 'RELINK_ASSET', assetId: 'a', newUri: 'u' },
    { type: 'ADD_ASSET', asset: image('a') },
    { type: 'ADD_ASSET', asset: { id: 'n', kind: 'image', uri: 'u' } as Asset },
    { type: 'UPDATE_ASSET', assetId: 'a', patch: { name: 'x' } },
    { type: 'REMOVE_ASSET', assetId: 'a' },
    { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: [] },
    { type: 'SET_MARKERS', markers: [] },
    { type: 'SET_CHAPTERS', chapters: [] },
    { type: 'SET_AUDIO_MASTER', audioMaster: null },
    { type: 'SET_AUDIO_MASTER', audioMaster: { preset: 'loud' } as unknown as NonNullable<Project['audioMaster']> },
    { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 },
    { type: 'ADD_TRACK', track: { id: 'a', type: 'aux2', name: 'Aux', clips: [] } },
    { type: 'REMOVE_TRACK', trackType: 'aux1' },
    { type: 'RENAME_TRACK', trackType: 'music', name: 'Zene' },
    { type: 'SET_AUDIO_BUSES', buses: [] },
    { type: 'SET_TRACK_SEND', trackType: 'music', busId: 'b', amount: 1 },
    { type: 'SET_REGIONS', regions: [] },
    { type: 'SET_LOCKED_TRACKS', lockedTracks: [] },
    { type: 'SET_LINKS', links: [['a', 'b'], ['c']] },
    { type: 'UPSERT_IMAGE_DOC', doc: imageDoc('d') },
    { type: 'UPSERT_IMAGE_DOC', doc: imageDoc('d'), label: 'Címke' },
    { type: 'REMOVE_IMAGE_DOC', docId: 'd' },
    { type: 'UPSERT_INSTRUMENT_DOC', doc: { id: 'i', kind: 'drums' } as unknown as InstrumentDoc },
    { type: 'UPSERT_INSTRUMENT_DOC', doc: { id: 'i', kind: 'sampler' } as unknown as InstrumentDoc },
    { type: 'UPSERT_INSTRUMENT_DOC', doc: { id: 'i', kind: 'melody' } as unknown as InstrumentDoc },
    { type: 'REORDER_IMAGE_DOCS', order: ['a', 'b'] },
    { type: 'SET_MODEL3D_DOC', doc: { id: 'm', nodes: [] } as unknown as Model3DDoc },
    { type: 'SET_MODEL3D_DOC', doc: { id: 'm', nodes: [] } as unknown as Model3DDoc, label: 'Címke' },
    { type: 'SET_LIVE_DOC', doc: { id: 'l', scenes: [] } as unknown as LiveDoc },
    { type: 'SET_LIVE_DOC', doc: { id: 'l', scenes: [] } as unknown as LiveDoc, label: 'Címke' },
    { type: 'SET_TIME_SIGNATURE', timeSignature: { beatsPerBar: 3, beatUnit: 4 } },
    { type: 'SET_TRACK_SIDECHAIN', trackType: 'music', sidechain: null },
    { type: 'SET_BPM', bpm: 90 },
    { type: 'SET_WORKFLOW_RUN', run: null },
    { type: 'SET_TEMPO_MAP', tempoMap: [] },
    { type: 'APPLY_ALBUM', album: { activeSongId: 's', songs: [] } as unknown as AlbumDoc },
    { type: 'APPLY_ALBUM', album: { activeSongId: 's', songs: [] } as unknown as AlbumDoc, label: 'Címke' },
    { type: 'REPLACE_TRACKS', tracks: [] },
    { type: 'REPLACE_TRACKS', tracks: [], label: 'AI vágás' },
    { type: 'RESTORE_SNAPSHOT', project: p },
    { type: 'RESTORE_SNAPSHOT', project: p, label: 'Verzió' },
    { type: 'RELINK_URI', oldUri: 'a', newUri: 'b' },
  ];

  test.each(cmds.map((c) => [c.type, c] as const))('%s', (_type, cmd) => {
    const label = describeCommand(cmd);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });

  test('a címkés parancsoknál a saját címke számít', () => {
    expect(describeCommand({ type: 'UPSERT_IMAGE_DOC', doc: imageDoc('d'), label: 'Kép-címke' })).toContain('Kép-címke');
    expect(describeCommand({ type: 'REPLACE_TRACKS', tracks: [], label: 'AI vágás' })).toContain('AI vágás');
  });
});
