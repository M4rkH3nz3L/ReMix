import { emptyPattern, toggleStep } from '@/lib/drums';
import { bakeNewCommands, clipsOfDoc, drumsDoc, instrumentDocOf, rebakeCommands, rebakedDuration, samplerDoc, synthDoc } from '@/lib/instrumentDoc';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, Project } from '@/types/project';

/** 🎹🥁 MU1: a sütött hangszer-klip mintája a projektben marad és újraszerkeszthető. */
const asset = (id: string, uri: string, d: number): Asset => ({ id, kind: 'audio', uri, provider: 'local', name: id, duration: d });
const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  kind: 'audio', id: 'c1', start: 1, duration: 2, trimIn: 0, sourceDuration: 2, uri: 'file:///a.wav', label: 'Dob',
  volume: 0.7, fadeIn: 0.1, fadeOut: 0, source: 'imported', audioFx: { reverb: 0.3 }, ...over,
});

describe('🎹🥁 hangszer-minta', () => {
  let p: Project;
  beforeEach(() => {
    p = createEmptyProject('m', '9:16', undefined, 'audio');
    useEditorStore.getState().loadProject(p);
  });

  it('új sütés: a minta és a klip egy kötegben, egy undo; a klip hivatkozik a mintára', () => {
    let pat = emptyPattern(1);
    pat = toggleStep(pat, 'kick', 0);
    const doc = drumsDoc('inst1', 120, 1, pat, { kick: [127] }, 0.2);
    const st = useEditorStore.getState();
    expect(st.applyBatch(bakeNewCommands(doc, 'music', clip(), asset('a1', 'file:///a.wav', 2)), 'user')).toBe(2);
    const cur = useEditorStore.getState().project!;
    expect(instrumentDocOf(cur, 'inst1')?.drums?.swing).toBe(0.2);
    expect(clipsOfDoc(cur, 'inst1').map((c) => c.id)).toEqual(['c1']);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project!.instrumentDocs ?? []).toEqual([]);
    expect(clipsOfDoc(useEditorStore.getState().project!, 'inst1')).toEqual([]);
  });

  it('újrasütés: a minta + minden hivatkozó klip új hangja; hely, hangerő, effekt marad; egy undo', () => {
    const doc = synthDoc('inst2', 120, 1, 'sine', [{ id: 'n', midi: 60, startBeat: 0, lengthBeats: 1 }]);
    const st = useEditorStore.getState();
    st.applyBatch(bakeNewCommands(doc, 'music', clip({ id: 'c1' }), asset('a1', 'file:///a.wav', 2)), 'user');
    st.applyBatch([{ type: 'ADD_CLIP', trackType: 'music', clip: { ...clip({ id: 'c2', start: 5, duration: 1, trimIn: 0.5 }), instrumentDocId: 'inst2' } }], 'user');
    const before = useEditorStore.getState().project!;
    const doc2 = synthDoc('inst2', 120, 2, 'square', [{ id: 'n', midi: 64, startBeat: 0, lengthBeats: 4 }]);
    const cmds = rebakeCommands(before, doc2, { uri: 'file:///b.wav', durationSec: 4 }, asset('a2', 'file:///b.wav', 4));
    expect(useEditorStore.getState().applyBatch(cmds, 'user')).toBe(4);
    const after = useEditorStore.getState().project!;
    const [c1, c2] = clipsOfDoc(after, 'inst2');
    expect(instrumentDocOf(after, 'inst2')?.synth?.wave).toBe('square');
    expect(c1).toMatchObject({ uri: 'file:///b.wav', assetId: 'a2', start: 1, duration: 4, sourceDuration: 4, volume: 0.7, audioFx: { reverb: 0.3 } });
    // a megvágott klip a hosszát tartja
    expect(c2).toMatchObject({ uri: 'file:///b.wav', start: 5, duration: 1, trimIn: 0.5 });
    expect(after.assets.some((a) => a.id === 'a2')).toBe(true);
    useEditorStore.getState().undo();
    const undone = useEditorStore.getState().project!;
    expect(clipsOfDoc(undone, 'inst2').map((c) => c.uri)).toEqual(['file:///a.wav', 'file:///a.wav']);
    expect(instrumentDocOf(undone, 'inst2')?.synth?.wave).toBe('sine');
  });

  it('a hossz-szabály: vágatlan → az új hossz; megvágott → tartja, de a forráson belül; hurok → tartja', () => {
    expect(rebakedDuration(clip(), 4)).toBe(4);
    expect(rebakedDuration(clip(), 1)).toBe(1);
    expect(rebakedDuration(clip({ trimIn: 0.5, duration: 1.5 }), 1.2)).toBeCloseTo(0.7, 6);
    expect(rebakedDuration(clip({ speed: 2, duration: 1, sourceDuration: 2 }), 4)).toBe(2);
    expect(rebakedDuration(clip({ loopLength: 0.5, duration: 6 }), 1)).toBe(6);
  });

  it('🎛️ sampler-minta (S1): a saját hangfájl + a rács a projektben; újrasütés ugyanarra a klipre; a minta nem osztja a tömböt', () => {
    const pattern = [true, false, false, false, true, false, false, false];
    const doc = samplerDoc('inst4', 100, 1, 'file:///Projektek/x/minta.wav', pattern, 'minta.wav');
    pattern[0] = false; // a hívó tömbje nem érinti a mintát
    expect(doc).toEqual({ id: 'inst4', kind: 'sampler', bpm: 100, bars: 1, sampler: { sampleUri: 'file:///Projektek/x/minta.wav', sampleName: 'minta.wav', pattern: [true, false, false, false, true, false, false, false] } });
    const st = useEditorStore.getState();
    expect(st.applyBatch(bakeNewCommands(doc, 'music', clip({ id: 'c1', label: 'Sampler' }), asset('a1', 'file:///a.wav', 2)), 'user')).toBe(2);
    const cur = useEditorStore.getState().project!;
    expect(instrumentDocOf(cur, 'inst4')?.sampler?.sampleUri).toBe('file:///Projektek/x/minta.wav');
    // a projekt JSON-ja tartalmazza a minta uri-ját → a mappába vétel, a média-GC és az .rp látja
    expect(JSON.stringify(cur)).toContain('file:///Projektek/x/minta.wav');
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: 'c1', patch: { start: 3, volume: 0.5 } });
    const doc2 = samplerDoc('inst4', 100, 2, 'file:///Projektek/x/minta.wav', [true, true], 'minta.wav');
    const before = useEditorStore.getState().project!;
    expect(useEditorStore.getState().applyBatch(rebakeCommands(before, doc2, { uri: 'file:///b.wav', durationSec: 4.8 }, asset('a2', 'file:///b.wav', 4.8)), 'user')).toBe(3);
    const after = useEditorStore.getState().project!;
    const [c1] = clipsOfDoc(after, 'inst4');
    expect(c1).toMatchObject({ id: 'c1', uri: 'file:///b.wav', start: 3, volume: 0.5, duration: 4.8, sourceDuration: 4.8, instrumentDocId: 'inst4' });
    expect(instrumentDocOf(after, 'inst4')?.bars).toBe(2);
    useEditorStore.getState().undo();
    const undone = useEditorStore.getState().project!;
    expect(clipsOfDoc(undone, 'inst4')[0].uri).toBe('file:///a.wav');
    expect(instrumentDocOf(undone, 'inst4')?.sampler?.pattern).toEqual([true, false, false, false, true, false, false, false]);
  });

  it('a minta-parancs nem módosít, ha a minta azonos (nincs üres history-lépés)', () => {
    const doc = drumsDoc('inst3', 120, 1, emptyPattern(1));
    const st = useEditorStore.getState();
    expect(st.dispatch({ type: 'UPSERT_INSTRUMENT_DOC', doc })).toBe(true);
    expect(useEditorStore.getState().dispatch({ type: 'UPSERT_INSTRUMENT_DOC', doc: { ...doc } })).toBe(false);
  });
});
