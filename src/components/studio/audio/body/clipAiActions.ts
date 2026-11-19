import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { aiDenoiseFile } from '@/lib/aiDenoiseClient';
import { drumModel, ensureAudioModel } from '@/lib/audioModels';
import { addedClipIds, aiDenoiseCommands, aiDenoiseSource, clipIdSet, findAudioClip, freeLaneAt, resetAiDenoisePatch, resetTunePatch, tuneCommands } from '@/lib/audioStudioOps';
import type { EditorCommand } from '@/lib/commands';
import { aiDrumGrid, DRUM_AI_MAX_BARS, DRUM_AI_TEMPS, type DrumAiTemp } from '@/lib/drumAi';
import { seededRandom } from '@/lib/drumRnn';
import { emptyPattern, patternHits } from '@/lib/drums';
import { renderDrumsToClip } from '@/lib/drumsClient';
import { melodyBars } from '@/lib/humToMelody';
import { humClipToNotes } from '@/lib/humToMelodyClient';
import { makeId } from '@/lib/id';
import { drumsDoc, synthDoc } from '@/lib/instrumentDoc';
import type { MusicKey } from '@/lib/pitch';
import { ensureStemModel, separateOnDevice } from '@/lib/stemSeparationClient';
import { onDeviceStemCommands } from '@/lib/stemClips';
import { renderSynthToClip } from '@/lib/synthClient';
import { tuneVocal } from '@/lib/vocalTuneClient';
import { useEditorStore } from '@/store/editorStore';
import { withProgress } from '@/store/progressStore';
import type { AudioClip } from '@/types/project';

import type { PlaceInstrument } from './useInstrumentStudio';

/**
 * 🤖 A klipekre futó, a telefonon dolgozó AI-műveletek (ének-hangolás, dúdolásból dallam, stem-szétválasztás,
 * AI-zajszűrés, AI-dob) és visszavonó párjaik. Mind egy kötegben (egy undo) a command buson; a `bpm` a hívó
 * renderjéből jön.
 */
export function clipAiActions({
  t,
  bpm,
  setEditing,
  placeInstrument,
}: {
  t: TFunction;
  bpm: number;
  setEditing: (v: boolean) => void;
  placeInstrument: PlaceInstrument;
}) {
  /**
   * 🎤 V3.2: ének-hangolás hangonként — a telefon a klip EREDETI forrásából dolgozik (újrahangolásnál is), az
   * eredmény új fájl; a klip erre mutat (a beállítások és az eredeti a klipen), a harmónia külön sávra. Egy undo.
   */
  const applyTune = async (clipId: string, s: { root: number; minor: boolean; strength: number; harmonySteps?: number }): Promise<{ notes: number; shifted: number; harmonyClipId: string | null; timings: Record<string, number> } | null> => {
    const st0 = useEditorStore.getState();
    const clip = st0.project?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) as AudioClip | undefined;
    if (!clip || clip.kind !== 'audio') return null;
    const sourceUri = clip.tune?.sourceUri ?? clip.uri;
    const key: MusicKey = { root: s.root, scale: s.minor ? 'naturalMinor' : 'major' };
    const res = await withProgress(t('studio.audio.tune.working'), (report) =>
      tuneVocal(sourceUri, { key, strength: s.strength, harmonySteps: s.harmonySteps }, (r) => report({ phase: t('studio.audio.tune.working'), ratio: r }))
    );
    if (!res) {
      Alert.alert(t('studio.audio.tune.title'), t('studio.audio.tune.failed'));
      return null;
    }
    const { cmds, harmonyClipId } = tuneCommands(st0.project, clip, res, s, sourceUri, { harmonyLane: t('studio.audio.tune.harmonyLane') }, makeId);
    if (cmds.length > 0) useEditorStore.getState().applyBatch(cmds, 'user');
    return { notes: res.notes, shifted: res.shifted, harmonyClipId, timings: res.timings };
  };

  /**
   * 🎵 V8: dúdolásból dallam — a klip hangjai (YIN, a telefonon) a választott hangnemre húzva szinti-mintába, a
   * dúdolás kezdetéhez, az első szabad hang-sávra (ahol a tartományban nincs klip); szerkeszthető, egy undo.
   */
  const humMelody = async (clipId: string, k: { root: number; minor: boolean }): Promise<string | null> => {
    const clip = findAudioClip(useEditorStore.getState().project, clipId);
    if (!clip) return null;
    const key: MusicKey = { root: k.root, scale: k.minor ? 'naturalMinor' : 'major' };
    const notes = await withProgress(t('studio.audio.tune.working'), () => humClipToNotes(clip, { bpm, key }));
    if (!notes || notes.length === 0) {
      Alert.alert(t('studio.audio.tune.humMelody'), t('studio.audio.tune.humNone'));
      return null;
    }
    const res = await renderSynthToClip(notes, { bpm, wave: 'triangle' });
    if (!res) return null;
    const before = clipIdSet(useEditorStore.getState().project);
    placeInstrument(synthDoc(makeId('inst'), bpm, melodyBars(notes), 'triangle', notes), res, t('studio.audio.tune.humMelody'), freeLaneAt(useEditorStore.getState().project, clip.start, res.durationSec, t('studio.audio.tune.humMelody')));
    setEditing(false);
    return addedClipIds(useEditorStore.getState().project, before)[0] ?? null;
  };

  /**
   * 🎚️ V5: ének + kíséret a telefonon (ingyenes) — a modell egyszer letöltve, a szétválasztás a telefonon, a két stem
   * két új sávra a klip vágásával, az eredeti elnémítva; egy undo. Visszaadja az új klipek azonosítóit.
   */
  const stemsOnDevice = async (clipId: string): Promise<string[] | null> => {
    const clip = findAudioClip(useEditorStore.getState().project, clipId);
    if (!clip) return null;
    const res = await withProgress(t('studio.audio.stemsWorking'), async (report) => {
      report({ phase: t('studio.audio.stemsModel'), ratio: 0 });
      if (!(await ensureStemModel())) return null;
      return separateOnDevice(clip.uri, (r) => report({ phase: t('studio.audio.stemsWorking'), ratio: r }));
    });
    if (!res) {
      Alert.alert(t('studio.audio.stemsOnDevice'), t('studio.audio.stemsFailed'));
      return null;
    }
    const st = useEditorStore.getState();
    const cmds = st.project ? onDeviceStemCommands(st.project, clip, res, { vocals: t('studio.audio.stemsVocals'), accompaniment: t('studio.audio.stemsAccomp') }, makeId) : null;
    if (!cmds) {
      Alert.alert(t('studio.audio.stemsOnDevice'), t('studio.audio.stemsNoLanes'));
      return null;
    }
    const before = clipIdSet(st.project);
    st.applyBatch(cmds, 'user');
    setEditing(false);
    return useEditorStore.getState().project ? addedClipIds(useEditorStore.getState().project, before) : null;
  };

  /**
   * 🔇 V8: AI-zajszűrés (RNNoise a telefonon, ingyenes) — az eredetiből (ha már szűrt: annak forrásából) új fájl,
   * a klip arra mutat, az eredeti megmarad; egy undo. Visszaadja a feldolgozás adatait (mérés).
   */
  const applyAiDenoise = async (clipId: string, strength: number): Promise<{ vad: number; ms: number } | null> => {
    const clip = findAudioClip(useEditorStore.getState().project, clipId);
    if (!clip) return null;
    const { sourceUri } = aiDenoiseSource(clip);
    const res = await withProgress(t('studio.audio.aiDenoise.working'), (report) =>
      aiDenoiseFile(sourceUri, strength, (r) => report({ phase: t('studio.audio.aiDenoise.working'), ratio: r }))
    );
    if (!res) {
      Alert.alert(t('studio.audio.aiDenoise.title'), t('studio.audio.aiDenoise.failed'));
      return null;
    }
    useEditorStore.getState().applyBatch(aiDenoiseCommands(clip, res, strength, makeId('ast')), 'user');
    return { vad: res.vad, ms: res.ms };
  };

  /** 🔇 V8: AI-zajszűrés több klipre (az asszisztens) — egymás után a telefonon, a végén EGY undo */
  const aiDenoiseClips = async (clipIds: string[], strength = 1): Promise<number> => {
    const cmds: EditorCommand[] = [];
    for (const clipId of clipIds) {
      const clip = findAudioClip(useEditorStore.getState().project, clipId);
      if (!clip) continue;
      const { sourceUri } = aiDenoiseSource(clip);
      const res = await withProgress(t('studio.audio.aiDenoise.working'), (report) =>
        aiDenoiseFile(sourceUri, strength, (r) => report({ phase: t('studio.audio.aiDenoise.working'), ratio: r }))
      );
      if (!res) continue;
      cmds.push(...aiDenoiseCommands(clip, res, strength, makeId('ast')));
    }
    if (cmds.length === 0) {
      if (clipIds.length > 0) Alert.alert(t('studio.audio.aiDenoise.title'), t('studio.audio.aiDenoise.failed'));
      return 0;
    }
    useEditorStore.getState().applyBatch(cmds, 'user');
    return cmds.length / 2;
  };

  /**
   * 🥁 V8: AI-dob a lejátszófejnél (az asszisztens) — új groove a modellből, a telefonon sütve, szerkeszthető
   * dob-mintaként egy szabad sávon; egy undo. Visszaadja az új klip azonosítóját.
   */
  const aiDrumsAt = async (bars: number, temp: DrumAiTemp = 'creative', seed?: number): Promise<string | null> => {
    if (!(await withProgress(t('studio.drums.ai.title'), () => ensureAudioModel('magenta-drums'))) || !drumModel()) {
      Alert.alert(t('studio.drums.ai.title'), t('studio.drums.ai.failed'));
      return null;
    }
    const n = Math.max(1, Math.min(DRUM_AI_MAX_BARS, bars));
    const g = aiDrumGrid(drumModel()!, { bars: n, pattern: emptyPattern(n), velocity: {} }, 'groove', DRUM_AI_TEMPS[temp], seededRandom(seed ?? Date.now()));
    const res = await renderDrumsToClip(patternHits(g.pattern, g.velocity), { bpm, bars: g.bars });
    if (!res) return null;
    const start = useEditorStore.getState().playhead;
    const before = clipIdSet(useEditorStore.getState().project);
    placeInstrument(drumsDoc(makeId('inst'), bpm, g.bars, g.pattern, g.velocity), res, t('studio.drums.ai.title'), freeLaneAt(useEditorStore.getState().project, start, res.durationSec, t('studio.drums.ai.title')));
    return addedClipIds(useEditorStore.getState().project, before)[0] ?? null;
  };

  const resetAiDenoise = (clipId: string) => {
    const clip = useEditorStore.getState().project?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) as AudioClip | undefined;
    const patch = resetAiDenoisePatch(clip);
    if (!patch) return;
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId, patch }, 'user');
  };
  /** 🎤 az eredeti forrás vissza (a hangolás nélkül), egy undo */
  const resetTune = (clipId: string) => {
    const clip = useEditorStore.getState().project?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clipId) as AudioClip | undefined;
    const patch = resetTunePatch(clip);
    if (!patch) return;
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId, patch }, 'user');
  };

  return { applyTune, humMelody, stemsOnDevice, applyAiDenoise, aiDenoiseClips, aiDrumsAt, resetAiDenoise, resetTune };
}
