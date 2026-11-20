import { revertProjectTo } from '@/components/editor/panels/assistant/useAiReply';
import { useEditorStore } from '@/store/editorStore';
import type { Project, Track, VideoClip } from '@/types/project';

// a hook-modul a design-réteg haptikáját húzza be (Reanimated) — a visszaállításhoz nem kell
jest.mock('@/design', () => ({ haptics: { selection: jest.fn(), success: jest.fn() } }));

/**
 * ↩️ Az AI before/after preview visszagöngyölítése (B8): undo-val, amíg a
 * pillanatkép a history-ban van; különben EGY `RESTORE_SNAPSHOT` (actor: 'user').
 */

function videoClip(id: string, start = 0): VideoClip {
  return {
    id, kind: 'video', start, duration: 5,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: 5,
    speed: 1, volume: 1, filterId: 'none',
  };
}

function makeProject(id = 'p1'): Project {
  const tracks: Track[] = [{ id: 'trk-video', type: 'video', name: 'video', clips: [] }];
  return {
    id, name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks, assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();

let warnSpy: ReturnType<typeof jest.spyOn>;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  store().closeProject();
  warnSpy.mockRestore();
});

describe('revertProjectTo', () => {
  it('null alapra nem csinál semmit', () => {
    store().loadProject(makeProject());
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }, 'ai');
    const before = store().project;
    revertProjectTo(null);
    expect(store().project).toBe(before);
  });

  it('a history-ban lévő alapra undo-val göngyölít vissza — a köteget ÉS a közben tett szerkesztést is', () => {
    store().loadProject(makeProject());
    const base = store().project!;
    store().applyBatch(
      [
        { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') },
        { type: 'ADD_CLIP', trackType: 'video', clip: videoClip('b', 5) },
      ],
      'ai'
    );
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('c', 10) }, 'user');
    const eventsBefore = store().events.length;
    revertProjectTo(base);
    // a referencia pontosan visszaáll, és nem került be új parancs
    expect(store().project).toBe(base);
    expect(store().events.length).toBeLessThanOrEqual(eventsBefore);
    expect(store().events.some((e) => e.command.type === 'RESTORE_SNAPSHOT')).toBe(false);
  });

  it('ha az alap már kiesett a history-ból: EGY RESTORE_SNAPSHOT, actor = user', () => {
    const base = makeProject();
    store().loadProject(makeProject());
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }, 'ai');
    expect(store().past.includes(base)).toBe(false);
    revertProjectTo(base);
    const last = store().events[store().events.length - 1];
    expect(last.command.type).toBe('RESTORE_SNAPSHOT');
    expect(last.actor).toBe('user');
    expect(store().project!.tracks[0].clips).toEqual([]);
  });

  it('másik projekt pillanatképét nem állítja vissza', () => {
    store().loadProject(makeProject('p1'));
    store().dispatch({ type: 'ADD_CLIP', trackType: 'video', clip: videoClip('a') }, 'ai');
    const before = store().project;
    const eventsBefore = store().events.length;
    revertProjectTo(makeProject('p2'));
    expect(store().project).toBe(before);
    expect(store().events.length).toBe(eventsBefore);
  });

  it('a már aktuális alapra no-op', () => {
    store().loadProject(makeProject());
    const base = store().project!;
    const eventsBefore = store().events.length;
    revertProjectTo(base);
    expect(store().project).toBe(base);
    expect(store().events.length).toBe(eventsBefore);
  });
});
