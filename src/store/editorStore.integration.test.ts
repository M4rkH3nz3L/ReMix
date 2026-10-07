import AsyncStorage from '@react-native-async-storage/async-storage';

import * as storage from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, Project, Track, TrackType, VideoClip } from '@/types/project';

/**
 * 🧱 CORE §2.9 — a mag „arany-út" integrációs smoke-tesztje (headless, RN-render
 * nélkül): a TELJES szerkesztő-hurok EGY tesztben — betöltés → klip-hozzáadás →
 * vágás → sávok közti mozgatás → (ripple) trim → undo×N → redo×N →
 * (szerializálás → mentés → újratöltés) → az állapot bitre AZONOS.
 *
 * Ez a mag regressziós PAJZSA: ha egy jövőbeli változás eltöri az alap-hurkot
 * (reducer, store-invariáns, undo/redo, atomi mentés), ez a teszt elbukik.
 */

function track(type: TrackType, clips: Clip[] = []): Track {
  return { id: `trk-${type}`, type, name: type, clips };
}
function videoClip(id: string, start = 0, duration = 10): VideoClip {
  return {
    id, kind: 'video', start, duration,
    uri: `file:///clip-${id}.mp4`, trimIn: 0, sourceDuration: duration,
    speed: 1, volume: 1, filterId: 'none',
  };
}
function makeProject(): Project {
  return {
    id: 'golden', name: 'Arany-út', aspectRatio: '9:16', fps: 30,
    tracks: [track('video'), track('pip'), track('music')],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 6,
  };
}

const store = () => useEditorStore.getState();
const videoClips = () => store().project!.tracks.find((t) => t.type === 'video')!.clips;
const pipClips = () => store().project!.tracks.find((t) => t.type === 'pip')!.clips;
/** a projekt tartalmi ujjlenyomata (az updatedAt-mentes rész — azt a mentés újra-bélyegzi) */
const fingerprint = (p: Project) => JSON.stringify({ tracks: p.tracks, assets: p.assets, fps: p.fps });

beforeEach(async () => {
  await AsyncStorage.clear();
  store().loadProject(makeProject());
});
afterEach(() => store().closeProject());

describe('CORE §2.9 — arany-út: a teljes mag-hurok egy tesztben', () => {
  it('load → add → split → move → ripple-trim → undo×N → redo×N → save → reload (bitre azonos)', async () => {
    // 1) ADD_CLIP a video-sávra
    store().addClip('video', videoClip('a', 0, 10));
    expect(videoClips().map((c) => c.id)).toEqual(['a']);

    // 2) SPLIT a 4s-nél → a(0-4) + új klip(4-10)
    expect(store().splitClipAt('a', 4)).toBe(true);
    expect(videoClips()).toHaveLength(2);
    const b = videoClips()[1].id; // az új (második) klip id-je

    // 3) MOVE_CLIP: az 'a' a pip-sávra (kompatibilis: pip ↔ video)
    expect(store().moveClip('a', 'pip', 0)).toBe(true);
    expect(videoClips().map((c) => c.id)).toEqual([b]);
    expect(pipClips().map((c) => c.id)).toEqual(['a']);

    // 4) ripple-trim: a 'b' klip hossza rövidül (a mögötte lévők csúsznának)
    expect(store().rippleResize(b, 3)).toBe(true);
    expect(videoClips().find((c) => c.id === b)!.duration).toBeCloseTo(3);

    // az edit-ek után rögzítjük az „arany" állapotot + a lépésszámot
    const edited = fingerprint(store().project!);
    const steps = store().past.length; // ennyi undo-zható lépés történt
    expect(steps).toBe(4); // add + split + move + ripple-trim

    // 5) UNDO ×N → vissza a kiindulásig (üres video + pip)
    for (let i = 0; i < steps; i++) store().undo();
    expect(videoClips()).toHaveLength(0);
    expect(pipClips()).toHaveLength(0);

    // 6) REDO ×N → pontosan vissza az „arany" állapotba (undo/redo determinizmus)
    for (let i = 0; i < steps; i++) store().redo();
    expect(fingerprint(store().project!)).toBe(edited);

    // 7) szerializálás → ATOMI mentés → újratöltés → bitre azonos tartalom
    await storage.saveProjectAndEvents(store().project!, store().events);
    const reloaded = await storage.loadProject('golden');
    expect(reloaded).not.toBeNull();
    expect(fingerprint(reloaded!)).toBe(edited);

    // az eseménynapló is túléli a mentés→újratöltést (4 esemény)
    const reloadedEvents = await storage.loadEvents('golden');
    expect(reloadedEvents).toHaveLength(4);
  });

  it('a mentett projekt listázható + a tartalom megőrződik', async () => {
    store().addClip('video', videoClip('a', 0, 5));
    await storage.saveProjectAndEvents(store().project!, store().events);
    const metas = await storage.listProjects();
    expect(metas.map((m) => m.id)).toContain('golden');
    expect(metas.find((m) => m.id === 'golden')!.clipCount).toBe(1);
  });
});
