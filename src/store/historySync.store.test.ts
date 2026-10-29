import { applyCommand, type EditorCommand } from '@/lib/commands';
import { undoSyncCommands } from '@/lib/historySync';
import { setLiveBroadcaster } from '@/store/broadcasters';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/** 💾/👥/↩️ PRO-VIDEO B6 (autosave-verseny), B7 (undo-broadcast), B8 (AI-visszavonás) */

function videoClip(id: string, start = 0): VideoClip {
  return {
    id, kind: 'video', start, duration: 5, uri: `file:///${id}.mp4`,
    trimIn: 0, sourceDuration: 5, speed: 1, volume: 1, filterId: 'none',
  };
}
function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}
function makeProject(): Project {
  return {
    id: 'p1', name: 'Teszt', aspectRatio: '9:16', fps: 30,
    tracks: [track('video', [videoClip('v1'), videoClip('v2', 5)]), track('text')], assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
const replay = (from: Project, cmds: EditorCommand[]) => cmds.reduce((p, c) => applyCommand(p, c) ?? p, from);
const content = (p: Project) => JSON.stringify({ ...p, updatedAt: 0 });

beforeEach(() => store().loadProject(makeProject()));
afterEach(() => {
  setLiveBroadcaster(null);
  store().closeProject();
});

describe('B6 — markSaved verzió-tudatos', () => {
  it('a mentés ALATT tett módosítás piszkos marad', () => {
    store().dispatch({ type: 'RENAME_PROJECT', name: 'A' });
    const snap = store().project!;
    store().dispatch({ type: 'RENAME_PROJECT', name: 'B' }); // mentés közben
    store().markSaved(snap);
    expect(store().dirty).toBe(true);
    store().markSaved(store().project!);
    expect(store().dirty).toBe(false);
  });
});

describe('B7 — undo/redo a társ-szerkesztőknek is', () => {
  it('az undo és a redo parancsai a társ állapotát ugyanoda viszik', () => {
    const sent: EditorCommand[][] = [];
    setLiveBroadcaster((c) => sent.push(c));
    store().dispatch({ type: 'UPDATE_CLIP', clipId: 'v2', patch: { start: 9 } });
    store().dispatch({ type: 'RENAME_PROJECT', name: 'Új' });
    let peer = replay(makeProject(), sent.flat());
    expect(content(peer)).toBe(content(store().project!));

    sent.length = 0;
    store().undo();
    store().undo();
    peer = replay(peer, sent.flat());
    expect(content(peer)).toBe(content(store().project!));
    expect(peer.name).toBe('Teszt');

    sent.length = 0;
    store().redo();
    peer = replay(peer, sent.flat());
    expect(content(peer)).toBe(content(store().project!));
  });

  it('célzott parancsokkal nem kifejezhető eltérés → egyetlen RESTORE_SNAPSHOT', () => {
    const from = makeProject();
    const to = { ...from, particles: { kind: 'snow' } } as unknown as Project;
    const cmds = undoSyncCommands(from, to);
    expect(cmds.map((c) => c.type)).toEqual(['RESTORE_SNAPSHOT']);
    expect(content(replay(from, cmds))).toBe(content(to));
  });
});

describe('B8 — visszaállítás pillanatképre teli history-nál is', () => {
  it('RESTORE_SNAPSHOT a mentett állapotra áll (a helyi mappa megmarad)', () => {
    const base = store().project!;
    for (let i = 0; i < 60; i++) store().dispatch({ type: 'RENAME_PROJECT', name: `n${i}` });
    expect(store().past.includes(base)).toBe(false); // kiesett a 50-es history-ból
    store().dispatch({ type: 'RESTORE_SNAPSHOT', project: base }, 'user');
    expect(store().project!.name).toBe('Teszt');
    // és ez maga is visszavonható
    store().undo();
    expect(store().project!.name).toBe('n59');
  });
});
