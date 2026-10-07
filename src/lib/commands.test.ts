import { applyCommand, describeCommand, type EditorCommand } from '@/lib/commands';
import { canHostClip } from '@/lib/projectUtils';
import { masterPreset } from '@/lib/audioMaster';
import { createImageDoc } from '@/lib/imageDoc';
import { createLiveDoc } from '@/lib/liveDoc';
import type {
  Asset,
  AudioClip,
  Clip,
  Project,
  Track,
  TrackType,
  VideoClip,
} from '@/types/project';

/**
 * 🧱 CORE §2.1 — a command-bus magjának (applyCommand reducer) regressziós pajzsa.
 * Minden parancs happy-path + `null` (no-op/érvénytelen) ág + immutabilitás (a
 * bemeneti projekt referenciája nem változik), valamint a `describeCommand` címke.
 * A mag expo-mentes → a jest közvetlenül importálja (mint a contract.test.ts).
 */

// ── fixture-ök (determinisztikus id-k, i18n/ makeId nélkül) ──────────────────
const TRACK_TYPES: TrackType[] = [
  'video', 'pip', 'adjust', 'text', 'captions', 'overlay', 'interactive', 'music', 'voiceover', 'sfx',
];

function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Teszt',
    aspectRatio: '9:16',
    fps: 30,
    tracks: TRACK_TYPES.map((t) => track(t)),
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
    ...overrides,
  };
}

function videoClip(id: string, start = 0, duration = 10): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}

function audioClip(id: string, start = 0, duration = 10): AudioClip {
  return {
    id, kind: 'audio', start, duration,
    uri: `file:///audio-${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  };
}

function asset(id: string, uri: string): Asset {
  return { id, kind: 'video', uri, provider: 'local' };
}

function clipsOf(project: Project, type: TrackType): Clip[] {
  return project.tracks.find((t) => t.type === type)!.clips;
}

/** A reducer tényleg változtatott-e, új objektummal (a bemenet érintetlen). */
function expectChanged(before: Project, after: Project | null): Project {
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  return after as Project;
}

describe('applyCommand — ADD_CLIP', () => {
  it('a klipet a megadott sávra teszi', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a']);
    // immutabilitás: a bemenet sávja érintetlen
    expect(clipsOf(p, 'video')).toHaveLength(0);
  });

  it('asset-tel: új assetet ad + assetId-t állít', () => {
    const p = makeProject();
    const next = expectChanged(
      p,
      applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a'), asset: asset('ast1', 'file:///x.mp4') })
    );
    expect(next.assets.map((a) => a.id)).toEqual(['ast1']);
    expect((clipsOf(next, 'video')[0] as VideoClip & { assetId?: string }).assetId).toBe('ast1');
  });

  it('asset azonos uri-val: a meglévőre mutat, nem duplikál', () => {
    const p = makeProject({ assets: [asset('astOld', 'file:///x.mp4')] });
    const next = expectChanged(
      p,
      applyCommand(p, { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a'), asset: asset('astNew', 'file:///x.mp4') })
    );
    expect(next.assets.map((a) => a.id)).toEqual(['astOld']);
    expect((clipsOf(next, 'video')[0] as VideoClip & { assetId?: string }).assetId).toBe('astOld');
  });

  it('null, ha a sáv-típus nem létezik', () => {
    const p = makeProject({ tracks: [track('video')] });
    expect(applyCommand(p, { type: 'ADD_CLIP', trackType: 'music', clip: audioClip('a') })).toBeNull();
  });
});

describe('applyCommand — ADD_CLIPS', () => {
  it('több klipet ad egyszerre', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'ADD_CLIPS', trackType: 'video', clips: [videoClip('a'), videoClip('b', 10)] }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('null, ha üres a lista', () => {
    const p = makeProject();
    expect(applyCommand(p, { type: 'ADD_CLIPS', trackType: 'video', clips: [] })).toBeNull();
  });
});

describe('applyCommand — UPDATE_CLIP', () => {
  it('a patch-et alkalmazza a klipre', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'UPDATE_CLIP', clipId: 'a', patch: { duration: 4 } }));
    expect(clipsOf(next, 'video')[0].duration).toBe(4);
    expect(clipsOf(p, 'video')[0].duration).toBe(10); // bemenet érintetlen
  });
  it('null, ha a klip ismeretlen', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')])] });
    expect(applyCommand(p, { type: 'UPDATE_CLIP', clipId: 'nincs', patch: { duration: 4 } })).toBeNull();
  });
});

describe('applyCommand — REMOVE_CLIP', () => {
  it('eltávolítja a klipet', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a'), videoClip('b', 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'a' }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['b']);
  });
  it('null, ha a klip nem létezik', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')])] });
    expect(applyCommand(p, { type: 'REMOVE_CLIP', clipId: 'nincs' })).toBeNull();
  });
});

describe('applyCommand — SPLIT_CLIP', () => {
  it('kettévágja a klipet a megadott időpontban', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'a', time: 4 }));
    const parts = clipsOf(next, 'video');
    expect(parts).toHaveLength(2);
    expect(parts[0].duration).toBeCloseTo(4);
    expect(parts[1].start).toBeCloseTo(4);
  });
  it('null, ha a klip ismeretlen', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    expect(applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'nincs', time: 4 })).toBeNull();
  });
  it('null, ha a vágás a klip szélére esik (túl rövid rész)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    expect(applyCommand(p, { type: 'SPLIT_CLIP', clipId: 'a', time: 0 })).toBeNull();
  });
});

describe('applyCommand — MOVE_CLIP', () => {
  it('kompatibilis sávra mozgat (music → voiceover) új kezdettel', () => {
    const p = makeProject({ tracks: [track('music', [audioClip('a', 0, 10)]), track('voiceover')] });
    const next = expectChanged(p, applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'voiceover', start: 3 }));
    expect(clipsOf(next, 'music')).toHaveLength(0);
    expect(clipsOf(next, 'voiceover').map((c) => c.id)).toEqual(['a']);
    expect(clipsOf(next, 'voiceover')[0].start).toBe(3);
  });
  it('ugyanazon a sávon új kezdet', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 0, 10)])] });
    const next = expectChanged(p, applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'video', start: 5 }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['a']);
    expect(clipsOf(next, 'video')[0].start).toBe(5);
  });
  it('null: inkompatibilis cél (videó klip → text sáv)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a')]), track('text')] });
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'text', start: 0 })).toBeNull();
  });
  it('null: ismeretlen klip', () => {
    const p = makeProject();
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'nincs', toTrackType: 'video', start: 0 })).toBeNull();
  });
  it('null: ugyanott (azonos sáv + azonos kezdet)', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('a', 2, 10)])] });
    expect(applyCommand(p, { type: 'MOVE_CLIP', clipId: 'a', toTrackType: 'video', start: 2 })).toBeNull();
  });
});

describe('canHostClip — sáv ↔ klip-fajta kompatibilitás', () => {
  it('a kanonikus párosítás', () => {
    expect(canHostClip('video', 'video')).toBe(true);
    expect(canHostClip('video', 'image')).toBe(true);
    expect(canHostClip('pip', 'video')).toBe(true);
    expect(canHostClip('voiceover', 'audio')).toBe(true);
    expect(canHostClip('text', 'text')).toBe(true);
    expect(canHostClip('overlay', 'shape')).toBe(true);
    // inkompatibilis
    expect(canHostClip('video', 'audio')).toBe(false);
    expect(canHostClip('text', 'video')).toBe(false);
    expect(canHostClip('music', 'text')).toBe(false);
  });
});

describe('applyCommand — skalár projekt-mezők', () => {
  it('SET_ASPECT: vált + null ha azonos', () => {
    const p = makeProject({ aspectRatio: '9:16' });
    expect(expectChanged(p, applyCommand(p, { type: 'SET_ASPECT', aspectRatio: '16:9' })).aspectRatio).toBe('16:9');
    expect(applyCommand(p, { type: 'SET_ASPECT', aspectRatio: '9:16' })).toBeNull();
  });
  it('SET_FPS: kerekít + null ha azonos vagy <=0', () => {
    const p = makeProject({ fps: 30 });
    expect(expectChanged(p, applyCommand(p, { type: 'SET_FPS', fps: 24 })).fps).toBe(24);
    expect(applyCommand(p, { type: 'SET_FPS', fps: 30 })).toBeNull();
    expect(applyCommand(p, { type: 'SET_FPS', fps: 0 })).toBeNull();
  });
  it('RENAME_PROJECT: trimmel + null ha üres/azonos', () => {
    const p = makeProject({ name: 'Teszt' });
    expect(expectChanged(p, applyCommand(p, { type: 'RENAME_PROJECT', name: '  Új  ' })).name).toBe('Új');
    expect(applyCommand(p, { type: 'RENAME_PROJECT', name: '   ' })).toBeNull();
    expect(applyCommand(p, { type: 'RENAME_PROJECT', name: 'Teszt' })).toBeNull();
  });
  it('SET_PARTICLES: beállít + null ha ugyanaz', () => {
    const p = makeProject();
    const withP = expectChanged(p, applyCommand(p, { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: false } }));
    expect(withP.particles?.preset).toBe('confetti');
    expect(applyCommand(withP, { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: false } })).toBeNull();
  });
});

describe('applyCommand — assetek', () => {
  it('ADD_ASSET: hozzáad + null ha dup id/uri', () => {
    const p = makeProject();
    const withA = expectChanged(p, applyCommand(p, { type: 'ADD_ASSET', asset: asset('a1', 'file:///a.mp4') }));
    expect(withA.assets).toHaveLength(1);
    expect(applyCommand(withA, { type: 'ADD_ASSET', asset: asset('a1', 'file:///other.mp4') })).toBeNull();
    expect(applyCommand(withA, { type: 'ADD_ASSET', asset: asset('a2', 'file:///a.mp4') })).toBeNull();
  });
  it('UPDATE_ASSET: csak engedett mezők + null ha nincs engedett/ismeretlen', () => {
    const p = makeProject({ assets: [asset('a1', 'file:///a.mp4')] });
    const next = expectChanged(p, applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'a1', patch: { favorite: true, rating: 4 } }));
    expect(next.assets[0].favorite).toBe(true);
    expect(next.assets[0].rating).toBe(4);
    // nem engedett mező (uri) → null
    expect(applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'a1', patch: { uri: 'hack' } as Partial<Asset> })).toBeNull();
    expect(applyCommand(p, { type: 'UPDATE_ASSET', assetId: 'nincs', patch: { favorite: true } })).toBeNull();
  });
  it('REMOVE_ASSET: elvesz + null ha ismeretlen', () => {
    const p = makeProject({ assets: [asset('a1', 'file:///a.mp4')] });
    expect(expectChanged(p, applyCommand(p, { type: 'REMOVE_ASSET', assetId: 'a1' })).assets).toHaveLength(0);
    expect(applyCommand(p, { type: 'REMOVE_ASSET', assetId: 'nincs' })).toBeNull();
  });
});

describe('applyCommand — sáv-újraépítés', () => {
  it('REPLACE_TRACK_CLIPS: cseréli a sáv klipjeit + null ha a sáv hiányzik', () => {
    const p = makeProject({ tracks: [track('video', [videoClip('old')])] });
    const next = expectChanged(p, applyCommand(p, { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: [videoClip('new')] }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['new']);
    expect(applyCommand(p, { type: 'REPLACE_TRACK_CLIPS', trackType: 'music', clips: [] })).toBeNull();
  });
  it('REPLACE_TRACKS: több sáv + új assetek egy lépésben, null ha üres', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, {
      type: 'REPLACE_TRACKS',
      tracks: [{ trackType: 'video', clips: [videoClip('v')] }, { trackType: 'music', clips: [audioClip('m')] }],
      assets: [asset('a1', 'file:///a.mp4')],
    }));
    expect(clipsOf(next, 'video').map((c) => c.id)).toEqual(['v']);
    expect(clipsOf(next, 'music').map((c) => c.id)).toEqual(['m']);
    expect(next.assets).toHaveLength(1);
    expect(applyCommand(p, { type: 'REPLACE_TRACKS', tracks: [] })).toBeNull();
  });
});

describe('applyCommand — kép/live dokumentum', () => {
  it('UPSERT_IMAGE_DOC: hozzáad, frissít, null ha változatlan', () => {
    const p = makeProject();
    const doc = createImageDoc('Kép', '9:16', () => 'lyr1');
    const added = expectChanged(p, applyCommand(p, { type: 'UPSERT_IMAGE_DOC', doc }));
    expect(added.imageDocs).toHaveLength(1);
    expect(applyCommand(added, { type: 'UPSERT_IMAGE_DOC', doc })).toBeNull();
    const updated = expectChanged(added, applyCommand(added, { type: 'UPSERT_IMAGE_DOC', doc: { ...doc, name: 'Új név' } }));
    expect(updated.imageDocs![0].name).toBe('Új név');
  });
  it('REMOVE_IMAGE_DOC: töröl + null ha nincs ilyen', () => {
    const doc = createImageDoc('Kép', '9:16', () => 'lyr1');
    const p = makeProject({ imageDocs: [doc] });
    expect(expectChanged(p, applyCommand(p, { type: 'REMOVE_IMAGE_DOC', docId: doc.id })).imageDocs).toBeUndefined();
    expect(applyCommand(p, { type: 'REMOVE_IMAGE_DOC', docId: 'nincs' })).toBeNull();
  });
  it('SET_LIVE_DOC: beállít + null ha változatlan', () => {
    const p = makeProject();
    const live = createLiveDoc('Live', () => 'live1');
    const next = expectChanged(p, applyCommand(p, { type: 'SET_LIVE_DOC', doc: live }));
    expect(next.live).toEqual(live);
    expect(applyCommand(next, { type: 'SET_LIVE_DOC', doc: live })).toBeNull();
  });
});

describe('applyCommand — idővonal-meta (rendezve + no-op kiszűrve)', () => {
  it('SET_MARKERS: idő szerint rendez + null ha ugyanaz', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_MARKERS', markers: [
      { id: 'm2', time: 5, label: 'B' }, { id: 'm1', time: 1, label: 'A' },
    ] }));
    expect(next.markers!.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(applyCommand(next, { type: 'SET_MARKERS', markers: [
      { id: 'm1', time: 1, label: 'A' }, { id: 'm2', time: 5, label: 'B' },
    ] })).toBeNull();
  });
  it('SET_CHAPTERS: start szerint rendez', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_CHAPTERS', chapters: [
      { id: 'c2', start: 10, kind: 'cta' }, { id: 'c1', start: 0, kind: 'hook' },
    ] }));
    expect(next.chapters!.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
  it('SET_REGIONS: start szerint rendez', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_REGIONS', regions: [
      { id: 'r2', start: 10, end: 12, label: 'B', color: '#f00' },
      { id: 'r1', start: 0, end: 2, label: 'A', color: '#0f0' },
    ] }));
    expect(next.regions!.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
  it('SET_LINKS: 1-elemű csoportokat kiszűr + null ha ugyanaz', () => {
    const p = makeProject();
    const next = expectChanged(p, applyCommand(p, { type: 'SET_LINKS', links: [['a', 'b'], ['x']] }));
    expect(next.links).toEqual([['a', 'b']]);
    expect(applyCommand(next, { type: 'SET_LINKS', links: [['b', 'a']] })).toBeNull();
  });
});

describe('applyCommand — audio-mix', () => {
  it('SET_AUDIO_MASTER: beállít + null ha változatlan', () => {
    const p = makeProject();
    const master = masterPreset('podcast');
    const next = expectChanged(p, applyCommand(p, { type: 'SET_AUDIO_MASTER', audioMaster: master }));
    expect(next.audioMaster).toEqual(master);
    expect(applyCommand(next, { type: 'SET_AUDIO_MASTER', audioMaster: master })).toBeNull();
  });
  it('SET_TRACK_GAIN: 0..1-re vág + null ha azonos', () => {
    const p = makeProject();
    // -0.5 → 0 (eltér az alap 1-től → változás)
    const down = expectChanged(p, applyCommand(p, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: -0.5 }));
    expect(down.trackMix!.music!.gain).toBe(0);
    // 2 → 1 (eltér a 0-tól → változás)
    const up = expectChanged(down, applyCommand(down, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 2 }));
    expect(up.trackMix!.music!.gain).toBe(1);
    // 1.5 → 1 (azonos a jelenlegi 1-gyel) → null
    expect(applyCommand(up, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 1.5 })).toBeNull();
  });
});

describe('applyCommand — RELINK_URI', () => {
  it('lecseréli az uri-t az assetekben + klipeken, null ha azonos vagy nem érint', () => {
    const p = makeProject({
      tracks: [track('video', [videoClip('a')])],
      assets: [asset('ast', 'file:///clip-a.mp4')],
    });
    // a videoClip('a').uri = file:///clip-a.mp4 → az asset is erre mutat
    const next = expectChanged(p, applyCommand(p, { type: 'RELINK_URI', oldUri: 'file:///clip-a.mp4', newUri: 'file:///new.mp4' }));
    expect(next.assets[0].uri).toBe('file:///new.mp4');
    expect((clipsOf(next, 'video')[0] as VideoClip).uri).toBe('file:///new.mp4');
    expect(applyCommand(p, { type: 'RELINK_URI', oldUri: 'x', newUri: 'x' })).toBeNull();
    expect(applyCommand(p, { type: 'RELINK_URI', oldUri: 'file:///sehol.mp4', newUri: 'file:///y.mp4' })).toBeNull();
  });
});

describe('describeCommand — minden parancs ad nem-üres címkét', () => {
  const samples: EditorCommand[] = [
    { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') },
    { type: 'ADD_CLIPS', trackType: 'video', clips: [videoClip('a')] },
    { type: 'UPDATE_CLIP', clipId: 'a', patch: { duration: 2 } },
    { type: 'REMOVE_CLIP', clipId: 'a' },
    { type: 'SPLIT_CLIP', clipId: 'a', time: 2 },
    { type: 'SET_ASPECT', aspectRatio: '1:1' },
    { type: 'SET_FPS', fps: 24 },
    { type: 'RENAME_PROJECT', name: 'X' },
    { type: 'ADD_ASSET', asset: asset('a1', 'file:///a.mp4') },
    { type: 'UPDATE_ASSET', assetId: 'a1', patch: { favorite: true } },
    { type: 'REMOVE_ASSET', assetId: 'a1' },
    { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: [] },
    { type: 'REPLACE_TRACKS', tracks: [{ trackType: 'video', clips: [] }] },
    { type: 'RELINK_URI', oldUri: 'a', newUri: 'b' },
    { type: 'SET_PARTICLES', particles: { preset: 'confetti', beatSync: true } },
    { type: 'SET_PARTICLES', particles: null },
    { type: 'SET_MARKERS', markers: [] },
    { type: 'SET_CHAPTERS', chapters: [] },
    { type: 'SET_AUDIO_MASTER', audioMaster: masterPreset('podcast') },
    { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 },
    { type: 'SET_REGIONS', regions: [] },
    { type: 'SET_LINKS', links: [['a', 'b']] },
    { type: 'UPSERT_IMAGE_DOC', doc: createImageDoc('K', '9:16', () => 'l1') },
    { type: 'REMOVE_IMAGE_DOC', docId: 'd1' },
    { type: 'SET_LIVE_DOC', doc: createLiveDoc('L', () => 'lv1') },
  ];
  it.each(samples.map((c) => [c.type, c] as const))('%s', (_type, cmd) => {
    const label = describeCommand(cmd);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});
