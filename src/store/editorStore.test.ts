import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Clip, Project, TextClip, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🧱 CORE §2.1 — a command-bus STORE-invariánsainak regressziós pajzsa: a
 * `dispatch` igaz/hamis + dirty/events/past frissülés, az `applyBatch` = EGY
 * undo-lépés, az undo/redo szimmetria + kijelölés-elévülés, a HISTORY/EVENT
 * limitek nyírása, az `updateClip` több-kijelölés stílus-fanoutja, és a
 * `nudgeClipsBy` csoport-clampje (0 alá nem).
 */

function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}

function videoClip(id: string, start = 0, duration = 5): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}

function textClip(id: string, start = 0, duration = 5): TextClip {
  return {
    id, kind: 'text', start, duration,
    text: 'Hello', color: '#fff', backgroundColor: null, fontSize: 7,
    fontWeight: 'normal', position: { x: 0.5, y: 0.5 }, animation: 'none',
  };
}

function audioClip(id: string, start = 0, duration = 5): AudioClip {
  return {
    id, kind: 'audio', start, duration,
    uri: `file:///audio-${id}.m4a`, label: id, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported',
  };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
function load(tracks: Track[]): void {
  store().loadProject(makeProject(tracks));
}
function clipsOf(type: TrackType): Clip[] {
  return store().project!.tracks.find((t) => t.type === type)!.clips;
}

// a dev-warn (no-op parancs) elnyomása + a §2.2 assertje ugyanezen a spy-on
let warnSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  store().closeProject();
  warnSpy.mockRestore();
});

describe('dispatch', () => {
  it('érvényes command: igaz + dirty + event + past', () => {
    load([track('video')]);
    const ok = store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') });
    expect(ok).toBe(true);
    expect(store().dirty).toBe(true);
    expect(store().events).toHaveLength(1);
    expect(store().events[0].actor).toBe('user');
    expect(store().past).toHaveLength(1);
    expect(clipsOf('video').map((c) => c.id)).toEqual(['a']);
  });

  it('no-op command: hamis, nincs event/past', () => {
    load([track('video')]);
    const ok = store().dispatch({ type: 'SET_ASPECT', aspectRatio: '9:16' }); // azonos
    expect(ok).toBe(false);
    expect(store().events).toHaveLength(0);
    expect(store().past).toHaveLength(0);
    expect(store().dirty).toBe(false);
  });

  it('actor az eventbe kerül (AI)', () => {
    load([track('video')]);
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }, 'ai');
    expect(store().events[0].actor).toBe('ai');
  });
});

describe('applyBatch = EGY undo-lépés', () => {
  it('N parancs → 1 past-bejegyzés + N event; undo az egészet visszavonja', () => {
    load([track('video')]);
    const n = store().applyBatch(
      [
        { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') },
        { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('b', 5) },
      ],
      'ai'
    );
    expect(n).toBe(2);
    expect(store().past).toHaveLength(1); // EGY undo-lépés
    expect(store().events).toHaveLength(2);
    expect(clipsOf('video')).toHaveLength(2);
    store().undo();
    expect(clipsOf('video')).toHaveLength(0); // mindkettő egyszerre visszavonva
  });

  it('csupa no-op köteg → 0, nincs past', () => {
    load([track('video')]);
    const n = store().applyBatch([{ type: 'SET_ASPECT', aspectRatio: '9:16' }]);
    expect(n).toBe(0);
    expect(store().past).toHaveLength(0);
  });
});

describe('undo / redo', () => {
  it('szimmetrikus + a kijelölés (és köteg) elévül', () => {
    load([track('video')]);
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') });
    store().selectClip('a');
    expect(store().selectedClipId).toBe('a');

    store().undo();
    expect(clipsOf('video')).toHaveLength(0);
    expect(store().selectedClipId).toBeNull(); // kijelölés elévült
    expect(store().future).toHaveLength(1);

    store().redo();
    expect(clipsOf('video').map((c) => c.id)).toEqual(['a']);
    expect(store().future).toHaveLength(0);
  });

  it('üres history: undo/redo no-op (nem dob)', () => {
    load([track('video')]);
    expect(() => store().undo()).not.toThrow();
    expect(() => store().redo()).not.toThrow();
    expect(store().project).not.toBeNull();
  });
});

describe('HISTORY_LIMIT (50) + EVENT_LIMIT (300) nyírás', () => {
  it('305 változás után a past 50-nél, az events 300-nál vágva', () => {
    load([track('video')]);
    for (let i = 0; i < 305; i++) {
      store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip(`c${i}`, i) });
    }
    expect(store().past).toHaveLength(50);
    expect(store().events).toHaveLength(300);
    expect(clipsOf('video')).toHaveLength(305); // a projekt maga teljes
  });
});

describe('updateClip — több-kijelölés stílus-fanout', () => {
  it('kötegelhető mező (color) a többi kijelöltre is megy, EGY undo-lépésben', () => {
    load([track('text', [textClip('t1'), textClip('t2', 5)])]);
    store().selectClips(['t1', 't2']); // t1 elsődleges, t2 köteg
    expect(store().multiSelectIds).toEqual(['t2']);

    store().updateClip('t1', { color: '#ff0000' });
    const texts = clipsOf('text') as TextClip[];
    expect(texts.find((c) => c.id === 't1')!.color).toBe('#ff0000');
    expect(texts.find((c) => c.id === 't2')!.color).toBe('#ff0000'); // fanout
    expect(store().past).toHaveLength(1); // egyetlen undo-lépés (REPLACE_TRACKS)
  });

  it('NEM kötegelhető mező (start) csak az elsődlegesre megy', () => {
    load([track('text', [textClip('t1'), textClip('t2', 5)])]);
    store().selectClips(['t1', 't2']);
    store().updateClip('t1', { start: 2 });
    const texts = clipsOf('text') as TextClip[];
    expect(texts.find((c) => c.id === 't1')!.start).toBe(2);
    expect(texts.find((c) => c.id === 't2')!.start).toBe(5); // változatlan
  });
});

describe('nudgeClipsBy — csoport-clamp', () => {
  it('a legkorábbi klip se csúszik 0 alá, a relatív rend marad', () => {
    load([track('video', [videoClip('a', 1, 5), videoClip('b', 10, 5)])]);
    store().nudgeClipsBy(['a', 'b'], -5); // a=1 → -4 akarna; clamp delta = -1
    const clips = clipsOf('video');
    expect(clips.find((c) => c.id === 'a')!.start).toBeCloseTo(0);
    expect(clips.find((c) => c.id === 'b')!.start).toBeCloseTo(9);
  });

  it('pozitív eltolás nincs clampelve', () => {
    load([track('video', [videoClip('a', 1, 5)])]);
    store().nudgeClipsBy(['a'], 3);
    expect(clipsOf('video')[0].start).toBeCloseTo(4);
  });
});

describe('core-guard — zárolt sáv a magban is no-op (§2.2)', () => {
  it('user: zárolt sávra ADD_CLIP → false, nincs változás', () => {
    load([track('video', [videoClip('a')])]);
    store().toggleTrackFlag('video', 'lock');
    expect(store().lockedTracks).toContain('video');
    const ok = store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('b', 5) });
    expect(ok).toBe(false);
    expect(clipsOf('video').map((c) => c.id)).toEqual(['a']);
  });

  it('AI-köteg: a zárolt sávot érintő parancs kimarad, a többi fut', () => {
    load([track('video', [videoClip('a')]), track('music')]);
    store().toggleTrackFlag('video', 'lock');
    const n = store().applyBatch(
      [
        { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('b', 5) }, // zárolt → kimarad
        { type: 'ADD_CLIP', trackType: 'music', clip: audioClip('m') }, // engedett
      ],
      'ai'
    );
    expect(n).toBe(1);
    expect(clipsOf('video')).toHaveLength(1);
    expect(clipsOf('music')).toHaveLength(1);
  });

  it("remote: a lokális sáv-zár NEM blokkol (collab authoritatív)", () => {
    load([track('video', [videoClip('a')])]);
    store().toggleTrackFlag('video', 'lock');
    const ok = store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('b', 5) }, 'remote');
    expect(ok).toBe(true);
    expect(clipsOf('video')).toHaveLength(2);
  });

  it('UPDATE_CLIP a zárolt sáv klipjén is no-op (a klip sávját nézi)', () => {
    load([track('text', [textClip('t1')])]);
    store().toggleTrackFlag('text', 'lock');
    expect(store().dispatch({ type: 'UPDATE_CLIP', clipId: 't1', patch: { color: '#000' } })).toBe(false);
  });
});

describe('dev-warn a néma no-op parancsnál (§2.2)', () => {
  it('a no-op parancs dev-warnt ad (a debugoláshoz)', () => {
    load([track('video')]);
    warnSpy.mockClear();
    store().dispatch({ type: 'SET_ASPECT', aspectRatio: '9:16' }); // azonos → no-op
    expect(warnSpy).toHaveBeenCalled();
  });
});
