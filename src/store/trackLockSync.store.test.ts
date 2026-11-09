/** 🔒 R2: a sáv-zár a projekt része (parancs-buszon) — a társ zárolása a helyi kaput is zárja, visszavonható, betöltéskor visszaáll. */
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';

const clip = (id: string): AudioClip => ({ kind: 'audio', id, uri: 'file:///a.wav', label: id, start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
const project = (): Project => {
  const p = createEmptyProject('l', '9:16', undefined, 'audio');
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip('m')] } : t.type === 'voiceover' ? { ...t, clips: [clip('v')] } : t)) };
};
const vol = (id: string) => (useEditorStore.getState().project!.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as AudioClip).volume;

describe('sáv-zár szinkron (R2)', () => {
  beforeEach(() => useEditorStore.getState().loadProject(project(), []));

  it('a saját zárolás a projektbe kerül, a zárolt sávra írás no-op, a többire nem; visszavonás feloldja', () => {
    const st = useEditorStore.getState;
    st().toggleTrackFlag('music', 'lock');
    expect(st().project!.lockedTracks).toEqual(['music']);
    expect(st().lockedTracks).toEqual(['music']);
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } });
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'v', patch: { volume: 0.3 } });
    expect(vol('m')).toBe(1);
    expect(vol('v')).toBe(0.3);
    st().undo(); // a beszéd-szerkesztés
    st().undo(); // a zárolás
    expect(st().lockedTracks).toEqual([]);
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } });
    expect(vol('m')).toBe(0.3);
  });

  it('a társ zárolása (távoli parancs) a helyi kaput is zárja; a feloldása nyitja', () => {
    const st = useEditorStore.getState;
    st().dispatch({ type: 'SET_LOCKED_TRACKS', lockedTracks: ['music'] }, 'remote');
    expect(st().lockedTracks).toEqual(['music']);
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.2 } });
    expect(vol('m')).toBe(1);
    // a társ (tulaj) saját szerkesztése a zárolt sávon átmegy (a távoli visszajátszás kivétel)
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.5 } }, 'remote');
    expect(vol('m')).toBe(0.5);
    st().dispatch({ type: 'SET_LOCKED_TRACKS', lockedTracks: [] }, 'remote');
    expect(st().lockedTracks).toEqual([]);
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.2 } });
    expect(vol('m')).toBe(0.2);
  });

  it('a mentett zár betöltéskor visszaáll; régi projekt (mező nélkül) nem zár', () => {
    useEditorStore.getState().loadProject({ ...project(), lockedTracks: ['voiceover'] }, []);
    expect(useEditorStore.getState().lockedTracks).toEqual(['voiceover']);
    useEditorStore.getState().loadProject(project(), []);
    expect(useEditorStore.getState().lockedTracks).toEqual([]);
  });
});
