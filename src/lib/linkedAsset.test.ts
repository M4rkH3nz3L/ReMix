import { createEmptyProject } from '@/lib/projectUtils';
import { linkedAssets, mixdownClipCommands, mixdownInsertAt, mixdownVersion, relinkPlan, staleLinks } from '@/lib/linkedAsset';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';

/** 🔗 C2 (ReMix.md 5.3): a videó a hang-projekt mixdownjára hivatkozik, a változás egy koppintással frissül. */
const audioClip = (over: Partial<AudioClip> = {}): AudioClip => ({
  kind: 'audio', id: 'a1', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri: 'file:///x.wav', label: 'x',
  volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over,
});

function audioProject(): Project {
  const p = createEmptyProject('dal', '9:16', undefined, 'audio');
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip()] } : t)) };
}

describe('🔗 linked asset: mixdown-verzió', () => {
  it('a tartalomból számol: a hang változása új verzió, a meta (név, idő, jelölők) nem', () => {
    const p = audioProject();
    const v0 = mixdownVersion(p);
    expect(mixdownVersion({ ...p, name: 'más', updatedAt: 'később', markers: [{ id: 'm', time: 1, label: 'x' } as never] } as Project)).toBe(v0);
    const louder = { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip({ volume: 0.5 })] } : t)) };
    expect(mixdownVersion(louder)).not.toBe(v0);
    expect(mixdownVersion({ ...p, audioMaster: { target: 'music', lufs: -14, truePeak: -1, dynamics: 'balanced' } as never })).not.toBe(v0);
    expect(mixdownVersion({ ...p, bpm: 90 })).not.toBe(v0);
  });

  it('a mentés/betöltés átírásai nem adnak új verziót: a fájl új útvonala (azonos névvel) és a pótolt assetId; más fájlnév igen', () => {
    const p = audioProject();
    const v0 = mixdownVersion(p);
    const moved = { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip({ uri: 'file:///Projektek/dal/x.wav', assetId: 'ast_backfilled' })] } : t)) };
    expect(mixdownVersion(moved)).toBe(v0);
    const encoded = { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip({ uri: 'file:///m%C3%A1sik/x.wav' })] } : t)) };
    expect(mixdownVersion(encoded)).toBe(v0);
    const other = { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [audioClip({ uri: 'file:///y.wav' })] } : t)) };
    expect(mixdownVersion(other)).not.toBe(v0);
  });
});

describe('🔗 linked asset: a mixdown a videóban', () => {
  const source = { projectId: 'prj_audio', name: 'dal', output: 'mixdown' as const, version: 'v1' };

  it('a mixdown hivatkozott klipként kerül a zene-sávra, az asset hordozza a forrást; üres sávon 0-nál, különben az utolsó klip után', () => {
    const video = createEmptyProject('klip', '9:16', undefined, 'video');
    useEditorStore.getState().loadProject(video);
    const st = useEditorStore.getState();
    expect(mixdownInsertAt(video)).toBe(0);
    const cmds = mixdownClipCommands({ source, file: { uri: 'file:///mix-v1.wav', durationSec: 12.5 }, at: mixdownInsertAt(video), fps: 30, label: 'dal', clipId: 'c-mix', assetId: 'ast-mix' });
    expect(st.applyBatch(cmds, 'user')).toBe(1);
    const cur = useEditorStore.getState().project!;
    const asset = linkedAssets(cur)[0];
    expect(asset).toMatchObject({ id: 'ast-mix', uri: 'file:///mix-v1.wav', duration: 12.5, source });
    const clip = cur.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
    expect(clip).toMatchObject({ id: 'c-mix', assetId: 'ast-mix', start: 0, duration: 12.5, sourceDuration: 12.5 });
    expect(mixdownInsertAt(cur)).toBe(12.5);
  });

  it('„Frissítés elérhető”: csak az eltérő forrás-verziónál; ismeretlen forrásnál (nincs meg) nem jelez', () => {
    const video = createEmptyProject('klip', '9:16', undefined, 'video');
    useEditorStore.getState().loadProject(video);
    useEditorStore.getState().applyBatch(mixdownClipCommands({ source, file: { uri: 'file:///mix-v1.wav', durationSec: 12.5 }, at: 0, fps: 30, label: 'dal', clipId: 'c-mix', assetId: 'ast-mix' }), 'user');
    const cur = useEditorStore.getState().project!;
    expect(staleLinks(cur, () => 'v1')).toEqual([]);
    expect(staleLinks(cur, () => null)).toEqual([]);
    expect(staleLinks(cur, () => 'v2').map((s) => [s.asset.id, s.currentVersion])).toEqual([['ast-mix', 'v2']]);
  });

  it('frissítés: új fájl + verzió egy kötegben; rövidebb kimenet → a klip vége a forrás végére vágva és jelezve; egy visszavonás', () => {
    const video = createEmptyProject('klip', '9:16', undefined, 'video');
    useEditorStore.getState().loadProject(video);
    useEditorStore.getState().applyBatch(mixdownClipCommands({ source, file: { uri: 'file:///mix-v1.wav', durationSec: 12.5 }, at: 0, fps: 30, label: 'dal', clipId: 'c-mix', assetId: 'ast-mix' }), 'user');
    // a felhasználó megvágta: 2 s-tól 10 s hosszan (a forrás 2…12 s)
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: 'c-mix', patch: { trimIn: 2, duration: 10 } });
    const before = useEditorStore.getState().project!;
    const plan = relinkPlan(before, 'ast-mix', { uri: 'file:///mix-v2.wav', durationSec: 8, version: 'v2' });
    expect(plan.shortened).toEqual(['c-mix']);
    expect(useEditorStore.getState().applyBatch(plan.commands, 'user')).toBe(2);
    const after = useEditorStore.getState().project!;
    expect(after.assets.find((a) => a.id === 'ast-mix')).toMatchObject({ uri: 'file:///mix-v2.wav', duration: 8, source: { ...source, version: 'v2' } });
    const clip = after.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
    expect(clip).toMatchObject({ uri: 'file:///mix-v2.wav', trimIn: 2, duration: 6, sourceDuration: 8 });
    expect(staleLinks(after, () => 'v2')).toEqual([]);
    useEditorStore.getState().undo();
    const undone = useEditorStore.getState().project!;
    expect(undone.assets.find((a) => a.id === 'ast-mix')).toMatchObject({ uri: 'file:///mix-v1.wav', source: { version: 'v1' } });
    expect((undone.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip)).toMatchObject({ uri: 'file:///mix-v1.wav', duration: 10, sourceDuration: 12.5 });
  });

  it('hosszabb kimenet → a klip hossza változatlan, csak a forrás-hossz nő; a hurok-klip a hurok-ablakot tartja; a kívül eső ablak a forrás végére kerül', () => {
    const video = createEmptyProject('klip', '9:16', undefined, 'video');
    useEditorStore.getState().loadProject(video);
    useEditorStore.getState().applyBatch(mixdownClipCommands({ source, file: { uri: 'file:///mix-v1.wav', durationSec: 12.5 }, at: 0, fps: 30, label: 'dal', clipId: 'c-mix', assetId: 'ast-mix' }), 'user');
    const p = useEditorStore.getState().project!;
    const longer = relinkPlan(p, 'ast-mix', { uri: 'file:///mix-v2.wav', durationSec: 20, version: 'v2' });
    expect(longer.shortened).toEqual([]);
    expect(longer.commands[1]).toEqual({ type: 'UPDATE_CLIP', clipId: 'c-mix', patch: { sourceDuration: 20 } });
    // hurok-klip: 1 s-os hurok 11 s-tól → az új 11,5 s-os forrásban csak 0,5 s marad a hurokból
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: 'c-mix', patch: { trimIn: 11, loopLength: 1, duration: 30 } });
    const loop = relinkPlan(useEditorStore.getState().project!, 'ast-mix', { uri: 'file:///mix-v3.wav', durationSec: 11.5, version: 'v3' });
    expect(loop.shortened).toEqual(['c-mix']);
    expect(loop.commands[1]).toMatchObject({ patch: { loopLength: 0.5, sourceDuration: 11.5 } });
    // az ablak teljesen kívül: a forrás utolsó pillanata
    const out = relinkPlan(useEditorStore.getState().project!, 'ast-mix', { uri: 'file:///mix-v4.wav', durationSec: 5, version: 'v4' });
    expect(out.commands[1]).toMatchObject({ patch: { trimIn: 4.99, duration: 0.01, loopLength: 0.01, sourceDuration: 5 } });
    // ismeretlen / nem linkelt asset → üres terv
    expect(relinkPlan(p, 'nincs', { uri: 'x', durationSec: 1, version: 'v' })).toEqual({ commands: [], shortened: [] });
  });
});
