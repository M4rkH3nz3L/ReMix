import { COALESCE_WINDOW_MS } from '@/lib/historyCoalesce';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/** 🔗 egy csúszka-húzás = EGY undo-lépés (élő iPhone-teszt P1) — vezérelt órával */

function videoClip(id: string): VideoClip {
  return {
    id, kind: 'video', start: 0, duration: 5, uri: `file:///${id}.mp4`,
    trimIn: 0, sourceDuration: 5, speed: 1, volume: 1, filterId: 'none',
  };
}
function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}
function makeProject(): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks: [track('video', [videoClip('v1'), videoClip('v2')])], assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
let now = 1_000_000;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  store().loadProject(makeProject());
});
afterEach(() => {
  jest.restoreAllMocks();
  store().closeProject();
});

const volumeOf = (id: string) =>
  (store().project?.tracks[0].clips.find((c) => c.id === id) as VideoClip).volume;
const tick = (ms: number) => {
  now += ms;
};

describe('undo-összevonás (store)', () => {
  it('egy húzás (sok gyors frissítés) = egy undo-lépés', () => {
    for (const v of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      store().updateClip('v1', { volume: v });
      tick(16);
    }
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(volumeOf('v1')).toBe(1);
  });

  it('az ablakon túli szerkesztés külön lépés', () => {
    store().updateClip('v1', { volume: 0.5 });
    tick(COALESCE_WINDOW_MS + 1);
    store().updateClip('v1', { volume: 0.2 });
    expect(store().past).toHaveLength(2);
  });

  it('más klip / más mező nem olvad össze', () => {
    store().updateClip('v1', { volume: 0.5 });
    store().updateClip('v2', { volume: 0.5 });
    store().updateClip('v2', { speed: 2 });
    expect(store().past).toHaveLength(3);
  });

  it('undo után új lánc indul (nem olvad a visszavont lépésbe)', () => {
    store().updateClip('v1', { volume: 0.5 });
    store().undo();
    store().updateClip('v1', { volume: 0.3 });
    expect(store().past).toHaveLength(1);
    store().undo();
    expect(volumeOf('v1')).toBe(1);
  });

  it('undo után a kijelölés MEGMARAD, ha a klip létezik (élő teszt U1)', () => {
    store().selectClip('v1');
    store().updateClip('v1', { volume: 0.4 });
    store().undo();
    expect(store().selectedClipId).toBe('v1');
    store().redo();
    expect(store().selectedClipId).toBe('v1');
  });

  it('ha a visszavonás eltünteti a kijelölt klipet, a kijelölés kiesik', () => {
    store().addClip('video', { ...videoClip('v3'), start: 10 });
    store().selectClip('v3');
    store().undo();
    expect(store().selectedClipId).toBeNull();
    expect(store().multiSelectIds).toEqual([]);
  });
});
