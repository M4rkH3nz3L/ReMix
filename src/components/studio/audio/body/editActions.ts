import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { markerActions } from '@/components/studio/audio/AudioMarkerFlags';
import { laneLabel, type AudioLane } from '@/components/studio/audio/audioLanes';
import { startAudioSync } from '@/components/studio/audio/audioSyncAction';
import { selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { startSpeechEdit } from '@/components/studio/audio/SpeechEditBar';
import type { AudioAction } from '@/lib/audioIntent';
import { addMarker, nearestMarker } from '@/lib/audioMarkers';
import { assistantDenoiseIds, beatSplitCommands, duplicateCommands, newMarker, pasteTargetOf, trackTypeOfClip } from '@/lib/audioStudioOps';
import { AUDIO_TRACKS, nextExtraTrack } from '@/lib/audioTracks';
import { meterLabel, projectTiming, type Meter } from '@/lib/audioTransport';
import { insertSilenceCommands, joinableNext, joinCommands, type GapScope } from '@/lib/gapEdit';
import { makeId } from '@/lib/id';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import { useMixAssist } from '@/store/mixAssistStore';
import type { AudioClip, TrackType } from '@/types/project';

/**
 * ✂️📋 A hang-stúdió szerkesztő-műveletei (vágólap, duplikálás, ütemre vágás, csend beszúrása, összeillesztés,
 * sávok, markerek) és a hang-asszisztens folyamat-műveletei. Minden a command buson megy (egy undo-lépés); a
 * render-kori értékeket (rács, tempó, nagyítás, sávok) a hívó adja.
 */
export function audioEditActions({
  t,
  grid,
  bpm,
  meter,
  pxPerSec,
  laneTypes,
  onRequestCheck,
  onSendToVideo,
  aiDrums,
  aiDenoiseMany,
}: {
  t: TFunction;
  grid: number;
  bpm: number;
  meter: Meter;
  pxPerSec: number;
  laneTypes: TrackType[];
  onRequestCheck?: () => void;
  onSendToVideo?: (target: 'new' | 'latest' | 'pick') => void;
  aiDrums: (bars: number) => Promise<unknown>;
  aiDenoiseMany: (ids: string[]) => Promise<unknown>;
}) {
  /** 📋 a kijelölt klip sávja (beillesztés célja), ennek hiányában az első sáv */
  const pasteTarget = (): TrackType => pasteTargetOf(useEditorStore.getState(), laneTypes[0]);
  const copySelection = () => {
    useEditorStore.getState().copyClips();
  };
  const pasteAtPlayhead = () => {
    const st = useEditorStore.getState();
    st.pasteClipsAt(pasteTarget(), st.playhead);
  };
  /** 📑 duplikálás: a kijelölés másolata közvetlenül utána, sávonként (a vágólapot nem írja felül) */
  const duplicateSelection = () => {
    const st = useEditorStore.getState();
    const cmds = duplicateCommands(st.project, st.allSelectedIds(), grid, () => makeId('clip'));
    if (cmds.length > 0) st.applyBatch(cmds, 'user');
  };

  /** ✂️🥁 a kijelölt klip szétvágása az ütemrácson — egy undo-lépés; hátulról előre, mert a bal
   *  darab tartja meg az azonosítót. @returns a vágások száma */
  const beatSplitSelection = (every: 'bar' | 'beat'): number => {
    const st = useEditorStore.getState();
    const clip = st.allSelectedIds().length <= 1 ? selectedAudioClip(st.project, st.selectedClipId) : null;
    if (!clip || !st.project) return 0;
    const cmds = beatSplitCommands(clip, projectTiming(st.project), every);
    return cmds.length > 0 ? st.applyBatch(cmds, 'user') : 0;
  };
  // ⏸️➕ csend beszúrása a lejátszófejnél (egy undo); ✂️↩️ összeillesztés a következő darabbal
  const insertSilenceAt = (len: number, scope: GapScope) => {
    const st = useEditorStore.getState();
    if (!st.project) return 0;
    const sel = selectedAudioClip(st.project, st.selectedClipId);
    const trackType = st.project.tracks.find((tr) => tr.clips.some((c) => c.id === sel?.id))?.type ?? 'voiceover';
    const cmds = insertSilenceCommands(st.project, st.playhead, len, scope, trackType, st.lockedTracks, makeId);
    return cmds.length > 0 ? st.applyBatch(cmds, 'user') : 0;
  };
  const joinSelected = () => {
    const st = useEditorStore.getState();
    const cmds = st.project && st.selectedClipId ? joinCommands(st.project, st.selectedClipId) : [];
    return cmds.length > 0 ? st.applyBatch(cmds, 'user') : 0;
  };
  const askInsertSilence = () => {
    const pickScope = (len: number) => {
      const hasSel = !!selectedAudioClip(useEditorStore.getState().project, useEditorStore.getState().selectedClipId);
      Alert.alert(t('studio.audioTools.silenceInsert'), t('studio.audioTools.silenceInsertAt', { sec: len, at: formatTime(useEditorStore.getState().playhead) }), [
        ...(hasSel ? [{ text: t('studio.audioTools.scopeTrack'), onPress: () => insertSilenceAt(len, 'track') }] : []),
        { text: t('studio.audioTools.scopeAll'), onPress: () => insertSilenceAt(len, 'all') },
        { text: t('common.cancel'), style: 'cancel' as const },
      ]);
    };
    Alert.alert(t('studio.audioTools.silenceInsert'), undefined, [
      { text: '0,5 s', onPress: () => pickScope(0.5) },
      { text: '1 s', onPress: () => pickScope(1) },
      { text: '2 s', onPress: () => pickScope(2) },
    ]);
  };
  const askBeatSplit = () => {
    const run = (every: 'bar' | 'beat') => {
      if (beatSplitSelection(every) === 0) Alert.alert(t('studio.audioTools.beatSplitTitle'), t('studio.audioTools.beatSplitNone'));
    };
    Alert.alert(t('studio.audioTools.beatSplitTitle'), `${bpm} BPM · ${meterLabel(meter)}`, [
      { text: t('studio.audioTools.beatSplitBars'), onPress: () => run('bar') },
      { text: t('studio.audioTools.beatSplitBeats'), onPress: () => run('beat') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };
  // ✂️ hosszú nyomás a Vágáson: ütemrács, csend beszúrása, összeillesztés (ha a kijelölt klip illeszthető)
  const askCutMenu = () => {
    const st = useEditorStore.getState();
    const canJoin = !!st.project && !!st.selectedClipId && !!joinableNext(st.project, st.selectedClipId);
    Alert.alert(t('studio.audioTools.cutMenu'), undefined, [
      { text: t('studio.audioTools.beatSplitTitle'), onPress: askBeatSplit },
      { text: t('studio.audioTools.silenceInsert'), onPress: askInsertSilence },
      canJoin ? { text: t('studio.audioTools.join'), onPress: () => void joinSelected() } : { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  /** 🎙️🤖 az asszisztens folyamat-műveletei (a meglévő eszközök) */
  const runAssistantActions = (actions: AudioAction[]) => {
    const st = useEditorStore.getState();
    const sel = selectedAudioClip(st.project, st.selectedClipId);
    const trackOf = (id?: string) => trackTypeOfClip(st.project, id);
    const voice = st.project?.tracks.find((tr) => tr.type === 'voiceover')?.clips.find((c): c is AudioClip => c.kind === 'audio');
    for (const a of actions) {
      if (a.kind === 'mute' || a.kind === 'unmute') {
        if (st.isTrackAudible(a.track) === (a.kind === 'mute')) st.toggleTrackFlag(a.track, 'mute');
      } else if (a.kind === 'solo') st.toggleTrackFlag(a.track, 'solo');
      else if (a.kind === 'silence') {
        const c = sel ?? voice;
        const tt = trackOf(c?.id);
        if (c && tt) void startSilenceSearch(c, tt, grid, t);
      } else if (a.kind === 'beatSplitBars' || a.kind === 'beatSplitBeats') beatSplitSelection(a.kind === 'beatSplitBars' ? 'bar' : 'beat');
      else if (a.kind === 'check') onRequestCheck?.();
      else if (a.kind === 'toVideo') onSendToVideo?.(a.target);
      else if (a.kind === 'mixSuggest') useMixAssist.getState().show('mix');
      else if (a.kind === 'masterAssist') useMixAssist.getState().show('master');
      else if (a.kind === 'sync') sel && startAudioSync(sel, grid, t);
      else if (a.kind === 'aiDrums') void aiDrums(a.bars);
      else if (a.kind === 'aiDenoise') void aiDenoiseMany(assistantDenoiseIds(st.project, a.tracks, sel));
      else if (a.kind === 'transcript') {
        const tt = trackOf((sel ?? voice)?.id);
        if (tt) void startSpeechEdit(tt, t);
      }
    }
  };

  /** ➕ új hangsáv a következő szabad helyre (undo-zható) */
  const addLane = () => {
    const type = nextExtraTrack(laneTypes);
    if (!type) {
      return;
    }
    const number = AUDIO_TRACKS.indexOf(type) + 1;
    useEditorStore.getState().dispatch({ type: 'ADD_TRACK', track: { id: makeId('trk'), type, name: t('studio.audio.lanes.defaultName', { number }), clips: [] } });
  };

  /** a hozzáadott sáv műveletei (hosszan nyomva): átnevezés, törlés (csak üresen) */
  const laneActions = (lane: AudioLane) => {
    const st = useEditorStore.getState();
    const track = st.project?.tracks.find((tr) => tr.type === lane.type);
    const rename = () => {
      if (typeof Alert.prompt !== 'function') return;
      Alert.prompt(t('studio.audio.lanes.rename'), undefined, (text) => {
        if (text?.trim()) st.dispatch({ type: 'RENAME_TRACK', trackType: lane.type, name: text });
      }, 'plain-text', laneLabel(lane, t));
    };
    Alert.alert(laneLabel(lane, t), undefined, [
      { text: t('studio.audio.lanes.rename'), onPress: rename },
      ...(track && track.clips.length === 0
        ? [{ text: t('common.delete'), style: 'destructive' as const, onPress: () => st.dispatch({ type: 'REMOVE_TRACK', trackType: lane.type }) }]
        : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  /** 🔖 marker a lejátszófejnél (a közeli markerre a műveletei nyílnak) */
  const markerAtPlayhead = () => {
    const st = useEditorStore.getState();
    const markers = st.project?.markers ?? [];
    const near = nearestMarker(markers, st.playhead, 12 / pxPerSec);
    if (near) {
      markerActions(near, t);
      return;
    }
    st.dispatch({
      type: 'SET_MARKERS',
      markers: addMarker(markers, newMarker(markers, makeId('mk'), st.playhead, t('studio.audio.markers.defaultLabel', { number: markers.length + 1 }))),
    });
  };

  return {
    copySelection,
    pasteAtPlayhead,
    duplicateSelection,
    beatSplitSelection,
    insertSilenceAt,
    joinSelected,
    askCutMenu,
    runAssistantActions,
    addLane,
    laneActions,
    markerAtPlayhead,
  };
}
