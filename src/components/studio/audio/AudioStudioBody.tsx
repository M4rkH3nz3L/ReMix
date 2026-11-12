import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { LANE_HEIGHTS, useAudioEditMode } from '@/store/audioEditModeStore';
import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { VideoReference } from '@/components/studio/audio/VideoReference';
import { MixAssistSheet } from '@/components/studio/audio/MixAssistSheet';
import { useMixAssist } from '@/store/mixAssistStore';
import { UndoGestureArea } from '@/components/UndoGestureArea';
import { useShuttleHold } from '@/hooks/useShuttleHold';
import { AudioTimelineClip } from '@/components/studio/audio/AudioTimelineClip';
import { AudioMarkerFlags, markerActions } from '@/components/studio/audio/AudioMarkerFlags';
import { audioLanes, laneLabel, type AudioLane } from '@/components/studio/audio/audioLanes';
import { AUDIO_TRACKS, nextExtraTrack } from '@/lib/audioTracks';
import { duplicateAfter } from '@/lib/clipDuplicate';
import type { EditorCommand } from '@/lib/commands';
import { CrossfadeMarks } from '@/components/studio/audio/CrossfadeMarks';
import { applySilenceReview, SilenceMarks, SilenceReviewBar, startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { applySpeechCut, selectSpeechFillers, SpeechCutMarks, SpeechEditBar, startSpeechEdit, upgradeSpeechModel } from '@/components/studio/audio/SpeechEditBar';
import { useSpeechEdit } from '@/store/speechEditStore';
import { AudioAssistantBar } from '@/components/studio/audio/AudioAssistantBar';
import type { AudioAction } from '@/lib/audioIntent';
import { runAudioSync, startAudioSync, syncCandidates } from '@/components/studio/audio/audioSyncAction';
import { addMarker, nearestMarker, SECTION_KINDS, snapToMarkers } from '@/lib/audioMarkers';
import { ClipMarkers, LaneMeter, LoudnessReadout, MasterMeter } from '@/components/studio/audio/LaneMeter';
import { selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { AudioStudioSheets } from '@/components/studio/audio/body/AudioStudioSheets';
import { AudioStudioToolbar } from '@/components/studio/audio/body/AudioStudioToolbar';
import { RecordingStrip } from '@/components/studio/audio/body/RecordingStrip';
import { CollabPresence } from '@/components/editor/CollabPresence';
import { MIN_CLIP_DURATION, palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { layoutBudget, type Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';
import { setActiveSong, setSongRender, songCount, songNeedsRender, songRenderKey } from '@/lib/albumDoc';
import { buildAlbumVideoProject } from '@/lib/albumShare';
import {
  barsBeatsLabel,
  beatGridForView,
  beatSplitTimes,
  DEFAULT_BPM,
  DEFAULT_METER,
  meterLabel,
  nextMeter,
  DEFAULT_ZOOM_INDEX,
  nextBeatSec,
  prevBeatSec,
  fitPxPerSec,
  followScrollX,
  nearestZoomIndex,
  pxPerSecAt,
  scrubTime,
  rulerTicks,
  snapSec,
  type Meter,
  type SnapMode,
  zoomIn,
  zoomOut,
  ZOOM_LEVELS,
} from '@/lib/audioTransport';
import { zoomIndexForPinch } from '@/lib/audioTimelineGestures';
import { publishRenderedProject } from '@/lib/feed';
import type { ProgressUpdate } from '@/lib/progress';
import type { PostVisibility } from '@/types/social';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { exportAudioFile, isRenderCancelledError } from '@/lib/render';
import { mixForExport } from '@/lib/audioExportMix';
import { guardPro } from '@/store/paywallStore';
import { withCancellableProgress } from '@/store/progressStore';
import { renderSynthToClip } from '@/lib/synthClient';
import type { SynthNote, SynthWave } from '@/lib/synth';
import { renderDrumsToClip } from '@/lib/drumsClient';
import type { DrumHit } from '@/lib/drums';
import { renderSamplerToClip } from '@/lib/samplerClient';
import type { SamplerPattern } from '@/lib/sampler';
import { detectBeats } from '@/lib/beats';
import { beatLinesForClips } from '@/lib/beatMarkers';
import { registerDevAction } from '@/lib/devActions';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, InstrumentDoc, TrackType } from '@/types/project';
import { bakeNewCommands, clipsOfDoc, drumsDoc, instrumentDocOf, rebakeCommands, synthDoc } from '@/lib/instrumentDoc';
import type { DrumSource } from '@/components/studio/audio/DrumMachineSheet';
import { downloadToCache, probeAudioDuration } from '@/lib/media';
import { pauseVoiceRecording, prepareVoiceRecording, resumeVoiceRecording, startVoiceRecording, stopVoiceRecording, VOICE_RECORDING_OPTIONS, voiceoverClip } from '@/lib/voiceRecording';
import { nextHot } from '@/lib/recordingMeter';
import { metronomeWindow, openTakePlacement, punchCommands, punchWindow } from '@/lib/punchRecord';
import { insertSilenceCommands, joinableNext, joinCommands, type GapScope } from '@/lib/gapEdit';
import { alignCountInTake, alignPunchTake, PunchSession, runCountIn } from '@/lib/recordTakeClient';
import { METRONOME_LEVELS, useRecordPrefs } from '@/store/recordPrefsStore';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { recordingPhase } from '@/lib/interruption';
import { logCaught } from '@/lib/logCaught';

/** a sávmagasság alapértéke (a „nagy sávok” kapcsolóval 120) */
const LANE_H = LANE_HEIGHTS.normal;
const RULER_H = 24;
const HEADER_W = 62;

/* a sávok: `audioLanes(project)` (az alap három + a „+ Sáv”-val hozzáadottak) */

/** 📋 a beillesztés cél-sávja a store-állapotból (a kijelölt klip sávja, különben a zene) */
function pasteTargetOf(s: { selectedClipId: string | null; project: { tracks: { type: TrackType; clips: { id: string }[] }[] } | null }): TrackType {
  const id = s.selectedClipId;
  return (id && s.project?.tracks.find((tr) => tr.clips.some((c) => c.id === id))?.type) || 'music';
}

/**
 * 🎧 A hang-stúdió TÖRZSE — store-vezérelt, UI-only. A projektet a hívó tölti a
 * `useEditorStore`-ba (route-mód) VAGY már betöltve van (scoped, a videó-editorból),
 * és a hívó gondoskodik a rAF-óráról (`usePlaybackClock`) + a `<AudioLayer />`-ről
 * (scoped módban a videó-editor előnézete adja — NE duplázzuk). Így ugyanez a UI és
 * logika fut a `/studio/audio/[id]` képernyőn és a videóból nyíló Modalban.
 */
export function AudioStudioBody({
  mode,
  title,
  onExit,
  onExport,
  onRequestCheck,
}: {
  mode: 'project' | 'scoped';
  title: string;
  onExit: () => void;
  onExport?: () => void;
  /** 🩺 a hangellenőrzés (a képernyő futtatja; az asszisztens is kérheti) */
  onRequestCheck?: () => void;
}) {
  const { t } = useTranslation();
  const fxBypass = useEditorStore((s) => s.fxBypass);
  const canPaste = useEditorStore((s) => (s.clipClipboard ? s.canPasteTo(pasteTargetOf(s)) : false));
  const projectTracks = useEditorStore((s) => s.project?.tracks);
  const LANES = useMemo(() => audioLanes(projectTracks ? { tracks: projectTracks } : null), [projectTracks]);
  const LANE_TYPES = useMemo(() => LANES.map((l) => l.type), [LANES]);
  const project = useEditorStore((s) => s.project);
  // 🔇 a talált csendek a keresés pillanatának projektjére érvényesek: bármely szerkesztés után elavulnak
  useEffect(() => {
    const review = useSilenceReview.getState().review;
    if (review && review.project !== project) useSilenceReview.getState().clear();
  }, [project]);
  useEffect(() => () => {
    useSilenceReview.getState().clear();
    useSpeechEdit.getState().close();
  }, []);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const holdBack = useShuttleHold(-1);
  const holdForward = useShuttleHold(1);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const loop = useEditorStore((s) => s.loop);
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const [editing, setEditing] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tts, setTts] = useState(false);
  const [pianoRoll, setPianoRoll] = useState(false);
  const autoBpmRef = useRef<() => Promise<void>>(async () => {});
  const metronomeOn = useRecordPrefs((s) => s.metronome);
  /** 🎹🥁 az újraszerkesztett hangszer-minta (null = új minta) */
  const [editDocId, setEditDocId] = useState<string | null>(null);
  const [pianoBusy, setPianoBusy] = useState(false);
  const [drumMachine, setDrumMachine] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const editMode = useAudioEditMode((s) => s.mode);
  const largeLanes = useAudioEditMode((s) => s.large);
  const laneH = largeLanes ? LANE_HEIGHTS.large : LANE_H;
  const [drumBusy, setDrumBusy] = useState(false);
  const [sampler, setSampler] = useState(false);
  const [samplerBusy, setSamplerBusy] = useState(false);
  const [bpmBusy, setBpmBusy] = useState(false);
  const [detectedBeats, setDetectedBeats] = useState<{ uri: string; beats: number[] } | null>(null);
  const [source, setSource] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  // 📐 MOBILE-UI §6.7: a nyitott inline lap (keverő/master/klip-szerk.) detentje laponként;
  // a munkaterület (sávok) mért magassága a detentek alapja
  const [detentById, setDetentById] = useState<Partial<Record<AudioSheetId, Detent>>>({});
  const [rootH, setRootH] = useState(0);
  const [topBarH, setTopBarH] = useState(0);
  const [transportH, setTransportH] = useState<number | undefined>(undefined);
  // 🖥️ iPad fekvő: a keverő/master/klip-szerk. a sávok MELLETT, dokkolt oszlopban (MOBILE-UI §7)
  const L = useLayout();
  const docked = L.isExpanded;
  const [albumSharing, setAlbumSharing] = useState(false);
  const [tlH, setTlH] = useState(0); // az idővonal-terület magassága (rács/playhead a teljes magasságot tölti)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [snapMode, setSnapMode] = useState<SnapMode>('frame');
  // 📏 A42: a vonalzó és a rács csak a látható ablakra (± egy képernyő) rajzolódik
  const [view, setView] = useState({ x: 0, w: 0 });
  const viewXRef = useRef(0);
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  // ⏸️ a felhasználói szünet (a felvevő ilyenkor nem „isRecording”, de a take él és folytatható)
  const [recPaused, setRecPaused] = useState(false);
  const recPausedRef = useRef(false);
  recPausedRef.current = recPaused;
  // ⏱️🎯 count-in / punch-in: élesítve (a punch preroll-ja alatt a felvevő még nem fut), és a módok állapota
  const [recArmed, setRecArmed] = useState(false);
  const [recCountingIn, setRecCountingIn] = useState(false);
  const punchRef = useRef<PunchSession | null>(null);
  const countInRef = useRef<{ trim: number | null; alive: boolean; bars: number; bpm: number | undefined; meter: Meter } | null>(null);
  const recActive = recorderState.isRecording || recPaused || recArmed;
  // 🧪 füstteszt: felvétel indítása/leállítása, szünet/folytatás, a felvételi sáv állapota (csak __DEV__)
  const gapDevRef = useRef<{ insert: (len: number, scope: 'track' | 'all') => number; join: () => number }>({ insert: () => 0, join: () => 0 });
  const recDevRef = useRef<{ toggle: () => Promise<void>; pause: () => void; state: () => Record<string, unknown> }>({ toggle: async () => {}, pause: () => {}, state: () => ({}) });
  useEffect(() => {
    const offs = [
      registerDevAction('audio.recordToggle', () => recDevRef.current.toggle()),
      registerDevAction('audio.recordPause', () => recDevRef.current.pause()),
      registerDevAction('audio.recordState', () => recDevRef.current.state()),
      registerDevAction('audio.master', () => setMastering(true)),
      registerDevAction('audio.insertSilence1Track', () => gapDevRef.current.insert(1, 'track')),
      registerDevAction('audio.insertSilence1All', () => gapDevRef.current.insert(1, 'all')),
      registerDevAction('audio.join', () => gapDevRef.current.join()),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  // 🔴 „túl hangos”: egyszer bekapcsol, a take végéig marad
  const recHotRef = useRef(false);
  if (recorderState.isRecording) recHotRef.current = nextHot(recHotRef.current, recorderState.metering);
  const recHot = recHotRef.current;
  const recordStartPlayhead = useRef(0);
  // 🔍 pinch-zoom: a mindig friss zoom-index + a csippentés kezdő-indexe (ref, hogy a
  // gesztus-callback ne stale state-et lásson)
  const zoomIndexRef = useRef(DEFAULT_ZOOM_INDEX);
  zoomIndexRef.current = zoomIndex;
  const pinchStartRef = useRef(DEFAULT_ZOOM_INDEX);

  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});
  useFinishRecordingOnLeave(
    recorder,
    finishRecordingRef,
    () => Alert.alert(t('panels.audio.noSpaceTitle'), t('panels.audio.lowSpaceStopped')),
    recPausedRef
  );

  // 🔍 „illeszd” nagyítás: folytonos px/mp (null = a lépcsős nagyítás él)
  const [fitPps, setFitPps] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);
  // a követéshez a friss méretek (a hook a korai return előtt fut, ezért ref-ből olvas)
  const followRef = useRef({ pps: 56, viewW: 0, contentW: 0 });
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const { pps, viewW, contentW } = followRef.current;
    const x = followScrollX(playhead * pps, scrollXRef.current, viewW, contentW);
    if (x !== null) {
      scrollRef.current?.scrollTo({ x, animated: false });
    }
  }, [playhead, isPlaying]);

  // 🧪 a füstteszt a gombok mögötti függvényeket hívja (csak __DEV__)
  const devRef = useRef<{ fit: () => void; zoomIn: () => void; marker: () => void; addLane: () => void; mixer: () => void; copy: () => void; paste: () => void; duplicate: () => void; meter: () => void; beatSplit: (every: 'bar' | 'beat') => number; silenceFind: () => Promise<number | null>; speechStart: () => Promise<number | null>; speechUpgrade: () => Promise<number | null>; syncSelected: () => Promise<unknown>; openDrums: () => void; editClip: () => void; closeDrums: () => void; assistant: () => void; pianoRoll: (open: boolean) => void; autoBpm: () => Promise<void> }>({ fit: () => {}, zoomIn: () => {}, marker: () => {}, addLane: () => {}, mixer: () => {}, copy: () => {}, paste: () => {}, duplicate: () => {}, meter: () => {}, beatSplit: () => 0, silenceFind: async () => null, speechStart: async () => null, speechUpgrade: async () => null, syncSelected: async () => null, openDrums: () => {}, editClip: () => {}, closeDrums: () => {}, assistant: () => {}, pianoRoll: () => {}, autoBpm: async () => {} });
  useEffect(() => {
    const offs = [
      registerDevAction('audio.fit', () => devRef.current.fit()),
      registerDevAction('audio.zoomIn', () => devRef.current.zoomIn()),
      registerDevAction('audio.marker', () => devRef.current.marker()),
      registerDevAction('audio.addLane', () => devRef.current.addLane()),
      registerDevAction('audio.mixer', () => devRef.current.mixer()),
      registerDevAction('audio.copy', () => devRef.current.copy()),
      registerDevAction('audio.paste', () => devRef.current.paste()),
      registerDevAction('audio.duplicate', () => devRef.current.duplicate()),
      registerDevAction('audio.meter', () => devRef.current.meter()),
      registerDevAction('audio.silenceFind', () => devRef.current.silenceFind()),
      registerDevAction('audio.silenceToggle1', () => useSilenceReview.getState().toggle(1)),
      registerDevAction('audio.silenceModeAll', () => useSilenceReview.getState().setMode('all')),
      registerDevAction('audio.silenceApply', () => applySilenceReview()),
      registerDevAction('audio.speechStart', () => devRef.current.speechStart()),
      registerDevAction('audio.speechFillers', () => selectSpeechFillers()),
      registerDevAction('audio.speechModeAll', () => useSpeechEdit.getState().setMode('all')),
      registerDevAction('audio.speechApply', () => applySpeechCut()),
      registerDevAction('audio.speechUpgrade', () => devRef.current.speechUpgrade()),
      registerDevAction('audio.syncSelected', () => devRef.current.syncSelected()),
      registerDevAction('audio.openDrums', () => devRef.current.openDrums()),
      registerDevAction('audio.editClip', () => devRef.current.editClip()),
      registerDevAction('audio.closeDrums', () => devRef.current.closeDrums()),
      registerDevAction('audio.autoBpm', () => devRef.current.autoBpm()),
      registerDevAction('audio.openTts', () => setTts(true)),
      registerDevAction('audio.openPianoRoll', () => devRef.current.pianoRoll(true)),
      registerDevAction('audio.closePianoRoll', () => devRef.current.pianoRoll(false)),
      registerDevAction('audio.assistant', () => devRef.current.assistant()),
      registerDevAction('audio.mixAssist', () => useMixAssist.getState().show('mix')),
      registerDevAction('audio.mixAssistClose', () => useMixAssist.getState().close()),
      registerDevAction('audio.beatSplitBars', () => devRef.current.beatSplit('bar')),
      registerDevAction('audio.beatSplitBeats', () => devRef.current.beatSplit('beat')),
      registerDevAction('audio.view', () => ({ scrollX: scrollXRef.current, ...followRef.current })),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (!project) {
    return null;
  }
  const fps = project.fps ?? 30;
  const bpm = project.bpm ?? DEFAULT_BPM;
  // 🎼 ütemjelzés (hiányzó = 4/4) — a rács, a snap és az ütem.ütemrész kijelzés is ezt követi
  const meter = project.timeSignature ?? DEFAULT_METER;
  const pxPerSec = fitPps ?? pxPerSecAt(zoomIndex);
  const duration = projectDuration(project);
  const timelineW = Math.max(320, duration * pxPerSec + 40);
  const laneAreaH = RULER_H + laneH * LANES.length;
  const contentH = Math.max(tlH, laneAreaH); // a rács/playhead a teljes területet tölti
  const viewW = view.w || 1200;
  const viewFrom = Math.max(0, (view.x - viewW) / pxPerSec);
  const viewTo = Math.min((timelineW - 40) / pxPerSec, (view.x + 2 * viewW) / pxPerSec);
  const ticks = rulerTicks(viewFrom, viewTo, pxPerSec);
  followRef.current = { pps: pxPerSec, viewW: view.w, contentW: timelineW };
  const selClip = selectedAudioClip(project, selectedClipId);
  // 🎵 beat-rács (ütem-vonalak) a BPM szerint — a látható tartományra + max 300 vonalra sapkázva
  const detectedLines = detectedBeats
    ? beatLinesForClips(
        detectedBeats.beats,
        project.tracks.flatMap((tr) => tr.clips).filter((c): c is AudioClip => c.kind === 'audio' && c.uri === detectedBeats.uri),
        fps
      )
    : [];
  const beatTimes = beatGridForView(bpm, meter.beatsPerBar, viewFrom, Math.min(duration + 2, viewTo), pxPerSec, meter.beatUnit);

  // 🔖 a markerek is snap-pontok (10 képpontnyi közelségben)
  const snapSecIn = (sec: number) => snapToMarkers(snapSec(sec, snapMode, fps, bpm, meter), project.markers ?? [], 10 / pxPerSec);

  /** 📋 a kijelölt klip sávja (beillesztés célja), ennek hiányában az első sáv */
  const pasteTarget = (): TrackType => {
    const st = useEditorStore.getState();
    const id = st.selectedClipId;
    return (id && st.project?.tracks.find((tr) => tr.clips.some((c) => c.id === id))?.type) || LANE_TYPES[0];
  };
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
    const ids = st.allSelectedIds();
    const cmds: EditorCommand[] = [];
    for (const tr of st.project?.tracks ?? []) {
      const picked = tr.clips.filter((c) => ids.includes(c.id));
      if (picked.length > 0) {
        cmds.push({ type: 'ADD_CLIPS', trackType: tr.type, clips: duplicateAfter(picked, fps, () => makeId('clip')) });
      }
    }
    if (cmds.length > 0) st.applyBatch(cmds, 'user');
  };

  /** ✂️🥁 a kijelölt klip szétvágása az ütemrácson — egy undo-lépés; hátulról előre, mert a bal
   *  darab tartja meg az azonosítót. @returns a vágások száma */
  const beatSplitSelection = (every: 'bar' | 'beat'): number => {
    const st = useEditorStore.getState();
    const clip = st.allSelectedIds().length <= 1 ? selectedAudioClip(st.project, st.selectedClipId) : null;
    if (!clip || !st.project) return 0;
    const times = beatSplitTimes(clip, st.project.bpm ?? DEFAULT_BPM, st.project.timeSignature ?? DEFAULT_METER, every);
    const cmds: EditorCommand[] = times.reverse().map((time) => ({ type: 'SPLIT_CLIP', clipId: clip.id, time }));
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

  /** 🎙️🤖 az asszisztens folyamat-műveletei (a meglévő eszközök) */
  const runAssistantActions = (actions: AudioAction[]) => {
    const st = useEditorStore.getState();
    const sel = selectedAudioClip(st.project, st.selectedClipId);
    const trackOf = (id?: string) => st.project?.tracks.find((tr) => tr.clips.some((c) => c.id === id))?.type;
    const voice = st.project?.tracks.find((tr) => tr.type === 'voiceover')?.clips.find((c): c is AudioClip => c.kind === 'audio');
    for (const a of actions) {
      if (a.kind === 'mute' || a.kind === 'unmute') {
        if (st.isTrackAudible(a.track) === (a.kind === 'mute')) st.toggleTrackFlag(a.track, 'mute');
      } else if (a.kind === 'solo') st.toggleTrackFlag(a.track, 'solo');
      else if (a.kind === 'silence') {
        const c = sel ?? voice;
        const tt = trackOf(c?.id);
        if (c && tt) void startSilenceSearch(c, tt, fps, t);
      } else if (a.kind === 'beatSplitBars' || a.kind === 'beatSplitBeats') beatSplitSelection(a.kind === 'beatSplitBars' ? 'bar' : 'beat');
      else if (a.kind === 'check') onRequestCheck?.();
      else if (a.kind === 'mixSuggest') useMixAssist.getState().show('mix');
      else if (a.kind === 'masterAssist') useMixAssist.getState().show('master');
      else if (a.kind === 'sync') sel && startAudioSync(sel, fps, t);
      else if (a.kind === 'transcript') {
        const tt = trackOf((sel ?? voice)?.id);
        if (tt) void startSpeechEdit(tt, t);
      }
    }
  };

  /** ➕ új hangsáv a következő szabad helyre (undo-zható) */
  const addLane = () => {
    const type = nextExtraTrack(LANE_TYPES);
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
      markers: addMarker(markers, {
        id: makeId('mk'),
        time: st.playhead,
        label: t('studio.audio.markers.defaultLabel', { number: markers.length + 1 }),
        color: SECTION_KINDS[markers.length % SECTION_KINDS.length].color,
      }),
    });
  };
  const seekAt = (e: GestureResponderEvent) =>
    useEditorStore.getState().setPlayhead(snapSecIn(Math.max(0, e.nativeEvent.locationX / pxPerSec)));

  // 🔍 kétujjas csippentés = idővonal-zoom (a 7 szint közt lépked). A pinch a
  // timelineWrap-en ül → a 2-ujjas zoom és az 1-ujjas vízszintes görgetés nem ütközik.
  const timelinePinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      // az „illeszd” állapotból a legközelebbi lépcsőről indul a csippentés
      pinchStartRef.current = fitPps !== null ? nearestZoomIndex(fitPps) : zoomIndexRef.current;
    })
    .onUpdate((e) => {
      const next = zoomIndexForPinch(pinchStartRef.current, e.scale, ZOOM_LEVELS.length);
      if (next !== zoomIndexRef.current || fitPps !== null) {
        setFitPps(null);
        setZoomIndex(next);
      }
    });

  // ↔️ scrub: a vonalzón húzva a lejátszófej követi az ujjat
  const rulerScrub = Gesture.Pan()
    .runOnJS(true)
    .withTestId('audio-ruler-scrub')
    .minDistance(0)
    .onBegin((e) => useEditorStore.getState().setPlayhead(scrubTime(e.x, pxPerSec, duration)))
    .onUpdate((e) => useEditorStore.getState().setPlayhead(scrubTime(e.x, pxPerSec, duration)));
  const zoomStep = (dir: 1 | -1) => {
    const from = fitPps !== null ? nearestZoomIndex(fitPps) : zoomIndex;
    setFitPps(null);
    setZoomIndex(dir > 0 ? zoomIn(from) : zoomOut(from));
  };
  const fitToView = () => {
    setFitPps(fitPxPerSec(view.w || 1200, duration));
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  };
  devRef.current = { fit: fitToView, zoomIn: () => zoomStep(1), marker: markerAtPlayhead, addLane, mixer: () => setMixerOpen(true), copy: copySelection, paste: pasteAtPlayhead, duplicate: duplicateSelection, meter: () => useEditorStore.getState().dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: nextMeter(meter) }), beatSplit: beatSplitSelection, silenceFind: async () => {
    const st = useEditorStore.getState();
    const c = selectedAudioClip(st.project, st.selectedClipId);
    const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === c?.id));
    return c && tr ? startSilenceSearch(c, tr.type, fps, t) : null;
  }, speechStart: async () => {
    const st = useEditorStore.getState();
    const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === st.selectedClipId));
    return tr ? startSpeechEdit(tr.type, t) : null;
  }, speechUpgrade: () => upgradeSpeechModel(t, false), syncSelected: async () => {
    const st = useEditorStore.getState();
    const c = selectedAudioClip(st.project, st.selectedClipId);
    const ref = c ? syncCandidates(c)[0] : undefined;
    return c && ref ? runAudioSync(c, ref, fps, t, true) : null;
  }, openDrums: () => setDrumMachine(true), editClip: () => setEditing(true), closeDrums: () => setDrumMachine(false), assistant: () => setAssistantOpen(true), pianoRoll: (open) => setPianoRoll(open), autoBpm: () => autoBpmRef.current() };

  // 🎙️ felvétel a voiceover sávra — a playheadnél kezd, a hosszt a felvevő adja
  // 🎙️ A10: a felvétel akkor is klip lesz, ha az app háttérbe megy vagy a képernyő bezárul
  const finishRecording = async () => {
    setRecPaused(false);
    recPausedRef.current = false;
    recHotRef.current = false;
    setRecArmed(false);
    setRecCountingIn(false);
    const punch = punchRef.current;
    punchRef.current = null;
    punch?.halt();
    const countIn = countInRef.current;
    countInRef.current = null;
    if (countIn) countIn.alive = false;
    const { uri, seconds } = await stopVoiceRecording(recorder);
    if (!uri) return;
    const label = t('panels.audio.voiceoverLabel');
    const st = useEditorStore.getState();
    if (punch?.open) {
      // ⏱️ metronómos felvétel: a take a lejátszófejtől (In) szól, a felvevő idejéből igazítva — kivágás nélkül
      const clockStart = punch.recording ? punch.startAt() : null;
      if (clockStart === null || !st.project) return;
      const end = clockStart + seconds;
      const startAt = await alignPunchTake(st.project, 'voiceover', uri, clockStart, { ...punch.win, out: end, stopAt: end }, st.isTrackAudible);
      const place = openTakePlacement({ seconds, startAt }, punch.win.in);
      if (!place) return;
      const { clip, asset } = voiceoverClip(uri, seconds, place.start, fps, label, makeId);
      st.addClip('voiceover', { ...clip, start: place.start, trimIn: place.trimIn, duration: place.duration }, asset);
      return;
    }
    if (punch) {
      // 🎯 punch: a klip pontosan In-től Out-ig (a felvevő idejéből), alatta kivágva — egy undo
      const clockStart = punch.recording ? punch.startAt() : null;
      if (clockStart === null || !st.project) return;
      // a take oda, amihez a felhasználó énekelt: a közben szóló klip áthallásához igazítva
      const startAt = await alignPunchTake(st.project, 'voiceover', uri, clockStart, punch.win, st.isTrackAudible);
      const cmds = punchCommands(st.project, 'voiceover', { uri, seconds, startAt, label }, punch.win, makeId);
      if (cmds.length > 0) st.applyBatch(cmds, 'user');
      return;
    }
    const { clip, asset } = voiceoverClip(uri, seconds, recordStartPlayhead.current, fps, label, makeId);
    if (countIn) {
      // ⏱️ az előszámlálás kimarad: a take ott kezdődik, ahol a következő ütés lenne (a felvevő idejében)
      if (countIn.trim === null) return;
      // a levágás a ténylegesen hallott kattanásokhoz igazítva (a lejátszó és a hangszóró késése)
      const trim = await alignCountInTake(uri, countIn.bars, countIn.bpm, countIn.meter, countIn.trim);
      if (seconds - trim < MIN_CLIP_DURATION) return;
      st.addClip('voiceover', { ...clip, trimIn: trim, duration: seconds - trim }, asset);
      return;
    }
    st.addClip('voiceover', clip, asset);
  };
  finishRecordingRef.current = finishRecording;

  // kilépéskor a futó felvétel klip lesz, nem vész el
  const exitStudio = () => {
    const done = recordingPhase(recorder.getStatus(), recPausedRef.current) !== 'idle' ? finishRecording() : Promise.resolve();
    void done
      .catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:exitStudio', caught); })
      .then(onExit);
  };

  const toggleRecord = async () => {
    // a szüneteltetett take is fut: a gomb leállítja (nem indít újat, ami felülírná)
    if (recActive) {
      await finishRecording();
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
      return;
    }
    const prefs = useRecordPrefs.getState();
    const st = useEditorStore.getState();
    try {
      if (prefs.punch) {
        const win = punchWindow(st.rangeIn, st.rangeOut);
        if (!win) {
          Alert.alert(t('studio.audio.rec.options'), t('studio.audio.rec.noRange'));
          return;
        }
        await prepareVoiceRecording(recorder);
        const session = new PunchSession(recorder, win, () => void finishRecordingRef.current());
        punchRef.current = session;
        setRecArmed(true);
        session.start();
        return;
      }
      if (prefs.metronome) {
        // ⏱️ metronómmal: a lejátszás (a többi sávval és a klikkel) a lejátszófej előtt az előszámlálásnyival
        // indul, a felvevő a lejátszófejnél — a take a punch-mérés szerint igazodik, nyitott véggel
        await prepareVoiceRecording(recorder);
        const session = new PunchSession(recorder, metronomeWindow(playhead, prefs.countInBars, bpm, meter), () => void finishRecordingRef.current(), true);
        punchRef.current = session;
        setRecArmed(true);
        session.start();
        return;
      }
      recordStartPlayhead.current = playhead;
      await startVoiceRecording(recorder);
      if (prefs.countInBars > 0) {
        const ci = { trim: null as number | null, alive: true, bars: prefs.countInBars, bpm, meter };
        countInRef.current = ci;
        setRecCountingIn(true);
        void runCountIn(recorder, prefs.countInBars, bpm, meter, () => ci.alive)
          .then((trim) => {
            if (ci.alive) ci.trim = trim;
          })
          .catch((caught) => logCaught('components/studio/audio/AudioStudioBody.tsx:countIn', caught))
          .finally(() => setRecCountingIn(false));
      }
    } catch (caught) {
      // 💾 kevés hely / foglalt mikrofon: érthető üzenet, a felvétel nem indul
      logCaught('components/studio/audio/AudioStudioBody.tsx:toggleRecord', caught);
      Alert.alert(t('panels.audio.recordFailedTitle'), caught instanceof Error ? caught.message : String(caught));
    }
  };

  // 🎙️ hosszú nyomás a felvétel-gombon: előszámlálás (ki / 1 / 2 ütem) és punch-in
  const recordOptions = () => {
    const p = useRecordPrefs.getState();
    const ci = p.countInBars === 0 ? t('studio.audio.rec.off') : t('studio.audio.rec.bars', { count: p.countInBars });
    Alert.alert(t('studio.audio.rec.options'), undefined, [
      { text: t('studio.audio.rec.countIn', { v: ci }), onPress: () => { p.setCountIn(((p.countInBars + 1) % 3) as 0 | 1 | 2); recordOptions(); } },
      { text: t('studio.audio.rec.punch', { v: t(p.punch ? 'studio.audio.rec.on' : 'studio.audio.rec.off') }), onPress: () => { p.setPunch(!p.punch); recordOptions(); } },
      {
        text: t('studio.audio.rec.metronomeLevel', { v: Math.round(p.metronomeGain * 100) }),
        onPress: () => {
          const i = METRONOME_LEVELS.findIndex((g) => Math.abs(g - p.metronomeGain) < 1e-6);
          p.setMetronomeGain(METRONOME_LEVELS[(i + 1) % METRONOME_LEVELS.length]);
          recordOptions();
        },
      },
      { text: t('studio.audio.rec.done'), style: 'cancel' },
    ]);
  };

  const pauseResumeRecording = () => {
    if (recorderState.isRecording) {
      pauseVoiceRecording(recorder);
      recPausedRef.current = true;
      setRecPaused(true);
    } else if (recPaused) {
      resumeVoiceRecording(recorder);
      recPausedRef.current = false;
      setRecPaused(false);
    }
  };

  gapDevRef.current = { insert: insertSilenceAt, join: joinSelected };
  recDevRef.current = {
    toggle: toggleRecord,
    pause: pauseResumeRecording,
    state: () => ({ active: recActive, recording: recorderState.isRecording, paused: recPaused, metering: recorderState.metering, hot: recHot, durationMillis: recorderState.durationMillis }),
  };

  const toggleFlag = (type: TrackType, flag: 'mute' | 'solo') =>
    useEditorStore.getState().toggleTrackFlag(type, flag);

  // 🥁🔎 tempó auto-felismerés: a kiválasztott (vagy az első hang-) klip beat-rácsából → BPM (a telefonon, offline; a worker tartalék)
  const autoDetectBpm = async () => {
    if (bpmBusy) {
      return;
    }
    const firstAudio = project.tracks
      .flatMap((tr) => tr.clips)
      .find((c): c is AudioClip => c.kind === 'audio' && typeof (c as AudioClip).uri === 'string');
    const sourceClip = selClip ?? firstAudio ?? null;
    const uri = sourceClip?.uri ?? null;
    if (!uri) {
      Alert.alert(t('studio.audio.autoBpm', { defaultValue: 'Tempó felismerése' }), t('studio.audio.autoBpmNoClip', { defaultValue: 'Nincs hang-klip az elemzéshez.' }));
      return;
    }
    setBpmBusy(true);
    try {
      const grid = await detectBeats(uri);
      if (grid && grid.bpm > 0) {
        useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: Math.round(grid.bpm) });
        // 🥁📍 a felismert beatek a forrás idejében maradnak, a vonalak a klipekből számolódnak
        setDetectedBeats({ uri, beats: grid.beats ?? [] });
      } else {
        Alert.alert(t('studio.audio.autoBpm', { defaultValue: 'Tempó felismerése' }), t('studio.audio.autoBpmFail', { defaultValue: 'Nem sikerült felismerni a tempót.' }));
      }
    } finally {
      setBpmBusy(false);
    }
  };

  // 🧪 füstteszt: a tempó-felismerés (a devRef a deklaráció előtt épül)
  autoBpmRef.current = autoDetectBpm;

  /**
   * 🎹🥁 a sütött minta a sávra: új minta → a minta (`InstrumentDoc`) + egy új klip a playheadnél;
   * újraszerkesztés → a minta + minden rá hivatkozó klip új hangja. Mindkettő egy kötegben (egy undo).
   */
  const placeInstrument = (doc: InstrumentDoc, res: { uri: string; durationSec: number }, label: string) => {
    const store = useEditorStore.getState();
    const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: label, duration: res.durationSec };
    const cur = store.project;
    if (cur && clipsOfDoc(cur, doc.id).length > 0) {
      store.applyBatch(rebakeCommands(cur, doc, res, asset), 'user');
      return;
    }
    const clip: AudioClip = {
      kind: 'audio',
      id: makeId('clip'),
      start: snapToFrame(playhead, fps),
      duration: res.durationSec,
      trimIn: 0,
      sourceDuration: res.durationSec,
      uri: res.uri,
      label,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: 'imported',
    };
    if (store.applyBatch(bakeNewCommands(doc, 'music', clip, asset), 'user') > 0) {
      store.selectClip(clip.id);
    }
  };

  // 🎹 a piano-roll hangjegyei → a telefonon sütött hang-klip (a minta a projektben marad, szerkeszthető)
  const bakeSynth = async (notes: SynthNote[], wave: SynthWave, bars: number) => {
    if (pianoBusy) {
      return;
    }
    setPianoBusy(true);
    try {
      const res = await renderSynthToClip(notes, { bpm, wave });
      if (!res) {
        Alert.alert(t('studio.pianoRoll.title', { defaultValue: 'Zeneszerzés' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      placeInstrument(synthDoc(editDocId ?? makeId('inst'), bpm, bars, wave, notes), res, t('studio.pianoRoll.clipLabel', { defaultValue: 'Zene' }));
      setPianoRoll(false);
      setEditDocId(null);
    } finally {
      setPianoBusy(false);
    }
  };

  /** a klipszerkesztő „Minta szerkesztése”: a minta szerinti hangszer-lap nyílik a mentett tartalommal */
  const editInstrument = (docId: string) => {
    const doc = instrumentDocOf(useEditorStore.getState().project, docId);
    if (!doc) return;
    setEditing(false);
    setEditDocId(doc.id);
    if (doc.kind === 'drums') setDrumMachine(true);
    else setPianoRoll(true);
  };

  // 🥁 a dob-minta ütései → a telefonon sütött hang-klip (a minta a projektben marad, szerkeszthető)
  const bakeDrums = async (hits: DrumHit[], bars: number, src: DrumSource) => {
    if (drumBusy) {
      return;
    }
    setDrumBusy(true);
    try {
      const res = await renderDrumsToClip(hits, { bpm, bars });
      if (!res) {
        Alert.alert(t('studio.drums.title', { defaultValue: 'Dob-gép' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      placeInstrument(drumsDoc(editDocId ?? makeId('inst'), bpm, bars, src.pattern, src.velocity, src.swing), res, t('studio.drums.clipLabel', { defaultValue: 'Dob' }));
      setDrumMachine(false);
      setEditDocId(null);
    } finally {
      setDrumBusy(false);
    }
  };

  // 🎛️🔊 a sampler step-mintája (saját minta a rácson) → worker /sampler-render → klip a playheadnél
  const bakeSampler = async (sampleUri: string, pattern: SamplerPattern, bars: number) => {
    if (samplerBusy) {
      return;
    }
    setSamplerBusy(true);
    try {
      const res = await renderSamplerToClip(sampleUri, pattern, { bpm, bars });
      if (!res) {
        Alert.alert(t('studio.sampler.title', { defaultValue: 'Sampler' }), t('studio.pianoRoll.failed', { defaultValue: 'A renderelés nem sikerült (fut a render-worker?).' }));
        return;
      }
      const start = snapToFrame(playhead, fps);
      useEditorStore.getState().addClip(
        'music',
        {
          kind: 'audio',
          id: makeId('clip'),
          start,
          duration: res.durationSec,
          trimIn: 0,
          sourceDuration: res.durationSec,
          uri: res.uri,
          label: t('studio.sampler.clipLabel', { defaultValue: 'Sampler' }),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'imported',
        },
        { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: t('studio.sampler.clipLabel', { defaultValue: 'Sampler' }), duration: res.durationSec }
      );
      setSampler(false);
    } finally {
      setSamplerBusy(false);
    }
  };

  // 🗂️ forrás-mappából a sávra: a HANG-forrás klipként a 'music' sávon, a playheadnél
  const insertSource = async (asset: Asset) => {
    if (asset.kind !== 'audio') {
      return;
    }
    const dur = asset.duration || (await probeAudioDuration(asset.uri));
    if (!dur) {
      Alert.alert(t('studio.audio.intake.unreadableTitle'), t('studio.audio.intake.unknownDuration'));
      return;
    }
    const clip: AudioClip = {
      kind: 'audio',
      id: makeId('clip'),
      start: snapToFrame(playhead, fps),
      duration: dur,
      trimIn: 0,
      sourceDuration: dur,
      uri: asset.uri,
      label: asset.name ?? t('studio.kind.audio'),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: 'imported',
    };
    useEditorStore.getState().addClip('music', clip, asset);
    setSource(false);
  };

  /**
   * 🎧💿➡️📲 Album megosztása a feedbe: a még nem renderelt (szerkesztőben épített) számokat
   * a workeren renderelem (swap az adott számra → audio-export → renderedUri), majd a borító +
   * a számok ALBUM-VIDEÓvá állnak össze (`buildAlbumVideoProject`) és a megszokott videó-úton
   * posztolódnak. Az IMPORTÁLT számok már „renderelt"-ek (a fájl maga), így azonnal mennek.
   * A32: a render óta szerkesztett szám újra renderelődik, a hang veszteségmentes és helyi
   * fájlként marad meg (nem lejáró linkként), hiba után is az eredeti szám aktív.
   */
  const renderAlbumSongs = async (report: (u: ProgressUpdate) => void, signal: AbortSignal) => {
    const store = useEditorStore.getState();
    const album0 = store.project!.album!;
    const originalActive = album0.activeSongId;
    try {
      for (const s of album0.songs) {
        // váltás a számra → a project.tracks ezt tükrözi → audio-render
        store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, s.id) });
        const p = useEditorStore.getState().project!;
        const key = songRenderKey(p.tracks, p);
        const song = p.album!.songs.find((x) => x.id === s.id)!;
        if (!songNeedsRender(song, key)) {
          continue;
        }
        const st = useEditorStore.getState();
        const mix = mixForExport(p, st.isTrackAudible, st.masterVolume);
        if (!mix) {
          throw new Error(t('studio.audio.album.silentSong', { name: s.name }));
        }
        const url = await exportAudioFile(mix, 'flac', report, signal, { notify: false });
        const local = await downloadToCache(url, `album_${s.id}.flac`);
        if (!local) {
          throw new Error(t('studio.audio.album.downloadFailed', { name: s.name }));
        }
        store.dispatch({
          type: 'APPLY_ALBUM',
          album: setSongRender(useEditorStore.getState().project!.album!, s.id, local, projectDuration(p), key),
        });
      }
    } finally {
      // vissza az eredeti aktív számra — hibánál és megszakításnál is
      store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, originalActive) });
    }
  };

  const shareAlbum = async (visibility: PostVisibility) => {
    if (!useEditorStore.getState().project?.album || albumSharing) {
      return;
    }
    setAlbumSharing(true);
    try {
      await guardPro(
        () =>
          withCancellableProgress(t('studio.audio.album.rendering'), async (report, signal) => {
            await renderAlbumSongs(report, signal);
            const albumProject = buildAlbumVideoProject(useEditorStore.getState().project!);
            if (!albumProject) {
              Alert.alert(t('common.error', { defaultValue: 'Hiba' }), t('studio.audio.album.needCover', { defaultValue: 'Az albumhoz borító és legalább egy renderelt szám kell.' }));
              return;
            }
            await publishRenderedProject(albumProject, report, { visibility });
            Alert.alert(t('studio.audio.album.doneTitle', { defaultValue: 'Megosztva' }), t('studio.audio.album.doneBody', { defaultValue: 'Az album felkerült a feedbe.' }));
          }),
        (e) => {
          logCaught('components/studio/audio/AudioStudioBody.tsx:shareAlbum', e);
          if (!isRenderCancelledError(e)) {
            Alert.alert(t('common.error', { defaultValue: 'Hiba' }), e.message);
          }
        }
      );
    } finally {
      setAlbumSharing(false);
    }
  };

  // A32: a közzététel nem indul megerősítés nélkül, és a láthatóság választható
  const confirmShareAlbum = () =>
    Alert.alert(t('studio.audio.album.confirmTitle'), t('studio.audio.album.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.audio.album.shareFollowers'), onPress: () => void shareAlbum('followers') },
      { text: t('studio.audio.album.sharePublic'), onPress: () => void shareAlbum('public') },
    ]);

  // a nyitott inline lap (a többi workspace vagy modális — azok nem nyomják össze a sávokat)
  const inlineSheet: AudioSheetId | null =
    editing && selClip ? 'clipEdit' : mastering ? 'master' : mixerOpen ? 'mixer' : null;
  const inlineDetent: Detent = inlineSheet
    ? (detentById[inlineSheet] ?? AUDIO_SHEET_SPECS[inlineSheet].initialDetent ?? 'half')
    : 'peek';
  const sheetFrame =
    rootH > 0
      ? {
          detents: layoutBudget({
            bodyHeight: rootH - topBarH,
            tier: 'sheet',
            detent: inlineDetent,
            hasTimeline: false,
            transportHeight: transportH,
          }).detents,
          detent: inlineDetent,
          onDetentChange: (d: Detent) =>
            inlineSheet && setDetentById((m) => ({ ...m, [inlineSheet]: d })),
          docked,
        }
      : null;
  // dokkolt módban a nyitott inline lap a sávok mellé kerül (a workspace/modális lapok maradnak)
  const sheetsInDock = docked && inlineSheet !== null;

  const sheets = (
    <AudioStudioSheets
      selClip={selClip}
      fps={fps}
      bpm={bpm}
      editing={editing}
      mastering={mastering}
      mixerOpen={mixerOpen}
      adding={adding}
      tts={tts}
      pianoRoll={pianoRoll}
      pianoBusy={pianoBusy}
      drumMachine={drumMachine}
      drumBusy={drumBusy}
      sampler={sampler}
      samplerBusy={samplerBusy}
      source={source}
      albumOpen={albumOpen}
      setEditing={setEditing}
      setMastering={setMastering}
      setMixerOpen={setMixerOpen}
      setAdding={setAdding}
      setTts={setTts}
      setPianoRoll={(v) => {
        setPianoRoll(v);
        if (!v) setEditDocId(null);
      }}
      setDrumMachine={(v) => {
        setDrumMachine(v);
        if (!v) setEditDocId(null);
      }}
      setSampler={setSampler}
      setSource={setSource}
      setAlbumOpen={setAlbumOpen}
      onBakeSynth={(notes, wave, bars) => void bakeSynth(notes, wave, bars)}
      onBakeDrums={(hits, bars, src) => void bakeDrums(hits, bars, src)}
      editDoc={instrumentDocOf(project, editDocId ?? undefined)}
      onEditInstrument={editInstrument}
      onBakeSampler={(uri, pattern, bars) => void bakeSampler(uri, pattern, bars)}
      onInsertSource={(asset) => {
        void insertSource(asset).catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:insertSource', caught); });
      }}
      onShareAlbum={confirmShareAlbum}
      frame={sheetFrame}
    />
  );

  return (
    <UndoGestureArea>
    <View style={styles.root} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <NewerSchemaBanner />
      {/* 🎬 a videóból nyitva: a lejátszófejhez tartozó videó-képkocka (A/V szinkron nem vakon) */}
      {mode === 'scoped' ? <VideoReference /> : null}
      <View style={styles.topBar} onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}>
        <Pressable onPress={exitStudio} hitSlop={10} style={styles.topBtn}>
          <Ionicons name={mode === 'scoped' ? 'close' : 'chevron-back'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.titleWrap}>
          <View style={styles.kindTag}>
            <Ionicons name="musical-notes" size={12} color={palette.accent} />
            <Text style={styles.kindTagText}>{t('studio.kind.audio')}</Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          onPress={() => setSource(true)}
          hitSlop={10}
          style={styles.srcBtn}
          accessibilityRole="button"
          accessibilityLabel={t('source.title')}
        >
          <Ionicons name="folder-open-outline" size={15} color={palette.textDim} />
        </Pressable>
        {mode === 'project' ? (
          <Pressable
            onPress={() => setAlbumOpen(true)}
            hitSlop={8}
            style={styles.srcBtn}
            accessibilityRole="button"
            accessibilityLabel={t('studio.audio.album.title', { defaultValue: 'Album' })}
          >
            {albumSharing ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <>
                <Ionicons name="albums-outline" size={15} color={project.album ? palette.accent : palette.textDim} />
                {project.album ? <Text style={styles.albumCount}>{songCount(project.album)}</Text> : null}
              </>
            )}
          </Pressable>
        ) : null}
        {/* 👥 a közös szerkesztés résztvevői (megosztott projektnél) */}
        <CollabPresence />
        {mode === 'scoped' ? (
          <Pressable onPress={exitStudio} hitSlop={10} style={styles.exportBtn}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.exportText}>{t('common.done')}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onExport} hitSlop={10} style={styles.exportBtn}>
            <Ionicons name="share-outline" size={16} color="#fff" />
            <Text style={styles.exportText}>{t('studio.export')}</Text>
          </Pressable>
        )}
      </View>

      {/* multi-track idővonal */}
      <View style={sheetsInDock ? styles.dockRow : styles.fillCol}>
        <GestureDetector gesture={timelinePinch}>
        <View style={styles.timelineWrap} onLayout={(e) => setTlH(e.nativeEvent.layout.height)}>
          <View style={styles.headers}>
            <View style={{ height: RULER_H }} />
            {LANES.map((lane) => {
              const muted = mutedTracks.includes(lane.type);
              const solo = soloTracks.includes(lane.type);
              return (
                <Pressable
                  key={lane.type}
                  style={[styles.laneHeader, { height: laneH }]}
                  testID={`audio-lane-head-${lane.type}`}
                  disabled={!lane.extra}
                  onLongPress={() => laneActions(lane)}
                >
                  <View style={styles.laneHeadTop}>
                    <Ionicons name={lane.icon} size={13} color={lane.color} />
                    <Text style={styles.trackName} numberOfLines={1}>
                      {laneLabel(lane, t)}
                    </Text>
                  </View>
                  <View style={styles.flagRow}>
                    <Pressable onPress={() => toggleFlag(lane.type, 'mute')} hitSlop={6}>
                      <Ionicons name={muted ? 'volume-mute' : 'volume-medium'} size={13} color={muted ? palette.danger : palette.textDim} />
                    </Pressable>
                    <Pressable onPress={() => toggleFlag(lane.type, 'solo')} hitSlop={6}>
                      <Text style={[styles.soloText, solo && { color: palette.accent }]}>S</Text>
                    </Pressable>
                    {/* 🔒 A47: a videó-szerkesztőben zárolt sáv itt is látszik, és itt is feloldható */}
                    <Pressable
                      onPress={() => useEditorStore.getState().toggleTrackFlag(lane.type, 'lock')}
                      hitSlop={6}
                      testID={`audio-lane-lock-${lane.type}`}
                      accessibilityLabel={lockedTracks.includes(lane.type) ? t('editor.timeline.unlock') : t('editor.timeline.lock')}
                    >
                      <Ionicons
                        name={lockedTracks.includes(lane.type) ? 'lock-closed' : 'lock-open-outline'}
                        size={13}
                        color={lockedTracks.includes(lane.type) ? palette.accent2 : palette.textDim}
                      />
                    </Pressable>
                  </View>
                  <LaneMeter type={lane.type} />
                </Pressable>
              );
            })}
            {/* ➕ új hangsáv (legfeljebb 8) */}
            {nextExtraTrack(LANE_TYPES) ? (
              <Pressable style={styles.addLane} onPress={addLane} testID="audio-add-lane">
                <Ionicons name="add" size={14} color={palette.textDim} />
                <Text style={styles.addLaneText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>{t('studio.audio.lanes.add')}</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setView((v) => (v.w === w ? v : { ...v, w }));
            }}
            onScroll={(e) => {
              // csak negyed-képernyőnyi elmozdulásnál rajzol újra (nem minden képkockánál)
              const x = e.nativeEvent.contentOffset.x;
              scrollXRef.current = x;
              if (Math.abs(x - viewXRef.current) > viewW / 4) {
                viewXRef.current = x;
                setView((v) => ({ ...v, x }));
              }
            }}
          >
            <View style={{ width: timelineW, height: contentH }}>
              {/* másodperc-rács a teljes magasságon */}
              {ticks.map((tick) => (
                <View
                  key={`g${tick.sec}`}
                  pointerEvents="none"
                  style={[
                    styles.grid,
                    { left: tick.sec * pxPerSec, height: contentH, backgroundColor: tick.major ? palette.border : `${palette.border}66` },
                  ]}
                />
              ))}
              {/* 🎵 beat-rács: az ütem-kezdő (downbeat) vonalak kiemelve */}
              {beatTimes.map(({ sec, downbeat }) => (
                <View
                  key={`beat${sec}`}
                  pointerEvents="none"
                  style={[
                    styles.beatLine,
                    { left: sec * pxPerSec, height: contentH, opacity: downbeat ? 0.5 : 0.22, width: downbeat ? 1.5 : 1 },
                  ]}
                />
              ))}
              {/* 🥁📍 detektált beat-vonalak (az importált zene VALÓS beatjei) */}
              {detectedLines.map((sec, i) => (
                <View
                  key={`db${i}`}
                  pointerEvents="none"
                  style={[styles.detectedBeat, { left: sec * pxPerSec, height: contentH }]}
                />
              ))}
              {/* 🔁 loop-régió árnyék (rangeIn…rangeOut) */}
              {rangeIn != null && rangeOut != null && rangeOut > rangeIn ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.loopShade,
                    { left: rangeIn * pxPerSec, width: (rangeOut - rangeIn) * pxPerSec, height: contentH },
                  ]}
                />
              ) : null}
              {/* idővonalzó (timecode) */}
              <GestureDetector gesture={rulerScrub}>
                <View style={styles.ruler} testID="audio-ruler">
                  <ClipMarkers pxPerSec={pxPerSec} />
                  {ticks.map((tick) =>
                    tick.major ? (
                      <Text key={`t${tick.sec}`} style={[styles.rulerLabel, { left: tick.sec * pxPerSec + 3 }]}>
                        {formatTime(tick.sec)}
                      </Text>
                    ) : null
                  )}
                </View>
              </GestureDetector>
              {/* 🔖 markerek (a vonalzó fölött, hogy a koppintás ne a csúsztatásé legyen) */}
              <AudioMarkerFlags pxPerSec={pxPerSec} height={contentH} />
              {/* sávok */}
              {LANES.map((lane) => {
                const track = project.tracks.find((tr) => tr.type === lane.type);
                const clips = (track?.clips ?? []).filter((c): c is AudioClip => c.kind === 'audio');
                return (
                  <Pressable key={lane.type} style={[styles.lane, { height: laneH, backgroundColor: `${lane.color}10` }]} onPress={seekAt}>
                    {clips.length === 0 ? (
                      <Text style={styles.laneEmpty} numberOfLines={1}>
                        {t(lane.labelKey)}
                      </Text>
                    ) : null}
                    {clips.map((clip) => (
                      <AudioTimelineClip
                        key={clip.id}
                        clip={clip}
                        pxPerSec={pxPerSec}
                        laneColor={lane.color}
                        laneH={laneH}
                        editMode={editMode}
                        laneType={lane.type}
                        laneTypes={LANE_TYPES}
                        selected={clip.id === selectedClipId}
                        multiSelected={multiSelectIds.includes(clip.id)}
                        snap={snapSecIn}
                      />
                    ))}
                    <CrossfadeMarks clips={clips} pxPerSec={pxPerSec} height={laneH} color={lane.color} />
                    <SilenceMarks trackType={lane.type} pxPerSec={pxPerSec} height={laneH} />
                    <SpeechCutMarks trackType={lane.type} pxPerSec={pxPerSec} height={laneH} />
                  </Pressable>
                );
              })}
              {/* playhead a teljes magasságon + idő-buborék */}
              <View pointerEvents="none" style={[styles.playhead, { left: playhead * pxPerSec, height: contentH }]} />
              <View pointerEvents="none" style={[styles.phBubble, { left: playhead * pxPerSec - 21 }]}>
                <Text style={styles.phBubbleText}>{formatTime(playhead)}</Text>
              </View>
            </View>
          </ScrollView>
          {/* 🧭 üres projekt: egyértelmű első lépés a sávok alatti üres területen (T1/A1) */}
          {LANES.every((lane) => !project.tracks.find((tr) => tr.type === lane.type)?.clips.length) ? (
            <View
              pointerEvents="box-none"
              style={[styles.emptyGuide, { top: RULER_H + LANES.length * laneH + 32 }]}
            >
              <Ionicons name="musical-notes-outline" size={28} color={palette.textDim} />
              <Text style={styles.emptyGuideText}>{t('studio.audio.emptyGuide')}</Text>
              <View style={styles.emptyGuideRow}>
                <Pressable
                  onPress={() => setAdding(true)}
                  style={[styles.emptyGuideBtn, styles.emptyGuideBtnPrimary]}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.emptyGuideBtnTextPrimary}>{t('studio.audio.emptyGuideAdd')}</Text>
                </Pressable>
                <Pressable onPress={toggleRecord} style={styles.emptyGuideBtn} accessibilityRole="button">
                  <Ionicons name="mic-outline" size={16} color={palette.text} />
                  <Text style={styles.emptyGuideBtnText}>{t('studio.audio.emptyGuideRecord')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
        </GestureDetector>
        {sheetsInDock ? <View style={{ width: L.editor.inspectorWidth }}>{sheets}</View> : null}
      </View>

      {/* transport — gazdag sor (undo/redo · ugrás · loop/In-Out · idő+ütem · BPM · zoom · snap) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.transportBar}
        onLayout={(e) => setTransportH(e.nativeEvent.layout.height)}
        contentContainerStyle={styles.transport}
        keyboardShouldPersistTaps="handled"
      >
        {/* undo / redo */}
        <TBtn icon="arrow-undo" onPress={() => useEditorStore.getState().undo()} disabled={!canUndo} />
        <TBtn icon="arrow-redo" onPress={() => useEditorStore.getState().redo()} disabled={!canRedo} />
        <View style={styles.tSep} />
        {/* ugrás elejére / lépés beatre vissza */}
        <TBtn icon="play-skip-back" onPress={() => useEditorStore.getState().setPlayhead(0)} />
        <TBtn icon="chevron-back" {...holdBack} onPress={() => useEditorStore.getState().setPlayhead(prevBeatSec(bpm, playhead))} />
        <Pressable onPress={() => useEditorStore.getState().setPlaying(!isPlaying)} style={styles.playBtn}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
        </Pressable>
        <TBtn icon="chevron-forward" {...holdForward} onPress={() => useEditorStore.getState().setPlayhead(nextBeatSec(bpm, playhead))} />
        <TBtn icon="play-skip-forward" onPress={() => useEditorStore.getState().setPlayhead(duration)} />
        <View style={styles.tSep} />
        {/* loop + In/Out + range törlés */}
        <TBtn icon="repeat" active={loop} onPress={() => useEditorStore.getState().setLoop(!loop)} />
        {/* ⏱️ metronóm: lejátszás és felvétel közben (az exportba nem kerül) */}
        <TBtn
          icon="timer-outline"
          testID="audio-metronome"
          active={metronomeOn}
          onPress={() => useRecordPrefs.getState().setMetronome(!metronomeOn)}
          accessibilityLabel={t('studio.audio.transport.metronome')}
        />
        <TBtn label={t('studio.audio.transport.rangeIn')} onPress={() => useEditorStore.getState().setRangeIn()} />
        <TBtn label={t('studio.audio.transport.rangeOut')} onPress={() => useEditorStore.getState().setRangeOut()} />
        {rangeIn != null || rangeOut != null ? (
          <TBtn icon="close" onPress={() => useEditorStore.getState().clearRange()} />
        ) : null}
        <View style={styles.tSep} />
        {/* idő + ütem:beat */}
        <View style={styles.timeWrap}>
          <Text style={styles.time}>
            {formatTime(playhead)} / {formatTime(duration)}
          </Text>
          <Text style={styles.bars}>♪ {barsBeatsLabel(bpm, playhead, meter)}</Text>
          <MasterMeter />
          <LoudnessReadout />
        </View>
        <View style={styles.tSep} />
        {/* BPM léptető + auto-felismerés (a kiválasztott/első hang-klipből) */}
        <TBtn icon="remove" onPress={() => useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: bpm - 1 })} />
        <View style={styles.bpmWrap}>
          <Text style={styles.bpmVal}>{bpm}</Text>
          <Text style={styles.bpmLabel}>BPM</Text>
        </View>
        <TBtn icon="add" onPress={() => useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: bpm + 1 })} />
        {/* 🎼 ütemjelzés: koppintásra a következő (4/4 → 3/4 → 2/4 → 6/8 → 5/4 → 7/8 → 12/8) */}
        <TBtn label={meterLabel(meter)} onPress={() => useEditorStore.getState().dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: nextMeter(meter) })} />
        <TBtn
          icon={bpmBusy ? undefined : 'sparkles-outline'}
          label={bpmBusy ? '…' : t('studio.audio.transport.auto')}
          active={bpmBusy}
          onPress={() => void autoDetectBpm()}
        />
        <View style={styles.tSep} />
        {/* zoom + snap */}
        <TBtn icon="remove-circle-outline" onPress={() => zoomStep(-1)} />
        <TBtn icon="add-circle-outline" onPress={() => zoomStep(1)} />
        <TBtn icon="bookmark-outline" label={t('studio.audio.markers.add')} onPress={markerAtPlayhead} />
        <TBtn icon="contract-outline" label={t('studio.audio.transport.fit')} active={fitPps !== null} onPress={fitToView} />
        {/* ✋✂️↔️ érintéses szerkesztési mód + nagy sávok (nagyobb hullámforma) */}
        <TBtn icon="hand-left-outline" active={editMode === 'select'} onPress={() => useAudioEditMode.getState().setMode('select')} accessibilityLabel={t('studio.audio.mode.select')} />
        <TBtn icon="cut-outline" active={editMode === 'cut'} onPress={() => useAudioEditMode.getState().setMode('cut')} accessibilityLabel={t('studio.audio.mode.cut')} />
        <TBtn icon="move-outline" active={editMode === 'move'} onPress={() => useAudioEditMode.getState().setMode('move')} accessibilityLabel={t('studio.audio.mode.move')} />
        <TBtn icon={largeLanes ? 'contract' : 'expand'} active={largeLanes} onPress={() => useAudioEditMode.getState().toggleLarge()} accessibilityLabel={t('studio.audio.mode.large')} />
        {/* 🎙️🤖 hang-asszisztens (a telefonon, offline) */}
        <TBtn icon="sparkles-outline" label={t('studio.audio.assistant.button')} active={assistantOpen} onPress={() => setAssistantOpen(!assistantOpen)} />
        {/* 🅰️🅱️ A/B: az eredeti (feldolgozás nélkül) ↔ a feldolgozott — csak az előnézetben */}
        <TBtn icon="git-compare-outline" label={fxBypass ? t('studio.audio.transport.abOriginal') : t('studio.audio.transport.ab')} active={fxBypass} onPress={() => useEditorStore.getState().setFxBypass(!fxBypass)} />
        <TBtn
          label={t(`studio.audio.transport.snap_${snapMode}`)}
          icon="magnet-outline"
          active={snapMode !== 'off'}
          onPress={() => setSnapMode(snapMode === 'off' ? 'frame' : snapMode === 'frame' ? 'beat' : 'off')}
        />
      </ScrollView>

      {/* többes kijelölés: a koppintás hozzáad, innen lehet kilépni */}
      {multiSelectMode ? (
        <Pressable
          testID="audio-multi-exit"
          style={styles.multiBar}
          onPress={() => useEditorStore.getState().setMultiSelectMode(false)}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        >
          <Text style={styles.multiText}>{t('editor.toolbar.multiSelectActive', { count: multiSelectIds.length + (selectedClipId ? 1 : 0) })}</Text>
          <Ionicons name="close" size={20} color={palette.text} />
        </Pressable>
      ) : null}

      {/* 🎚️🤖 mixjavaslat / mastering-segéd */}
      <MixAssistSheet />

      {/* 🎙️🤖 hang-asszisztens */}
      {assistantOpen ? <AudioAssistantBar onActions={runAssistantActions} onClose={() => setAssistantOpen(false)} /> : null}

      {/* ✂️💬 beszédvágás szöveggel */}
      <SpeechEditBar />

      {/* 🔇 csendek jóváhagyása */}
      <SilenceReviewBar />

      {/* 🎙️ felvételi sáv: szünet/folytatás, szintmérő, idő, „túl hangos” */}
      {recActive ? (
        <RecordingStrip
          paused={recPaused}
          meterDb={recorderState.metering}
          hot={recHot}
          durationMs={recorderState.durationMillis}
          onPauseResume={pauseResumeRecording}
          canPause={!punchRef.current && !recCountingIn}
          status={recArmed && !recorderState.isRecording ? t(punchRef.current?.open ? 'studio.audio.rec.countingIn' : 'studio.audio.rec.punchArmed') : recCountingIn ? t('studio.audio.rec.countingIn') : null}
        />
      ) : null}

      {/* eszköz-sor — nyitott inline lapnál rejtve (a lap fejléce a kilépés; a transport marad) */}
      {inlineSheet && !docked ? null : (
        <AudioStudioToolbar
          hasSelection={!!selClip}
          isRecording={recActive}
          onAdd={() => setAdding(true)}
          onRecord={toggleRecord}
          onRecordLongPress={recordOptions}
          onSplit={() => selClip && useEditorStore.getState().splitClipAt(selClip.id, playhead)}
          onBeatSplit={askCutMenu}
          onEdit={() => selClip && setEditing(true)}
          onDelete={() => selClip && useEditorStore.getState().removeSelectedClips()}
          onMixer={() => setMixerOpen(true)}
          onCopy={copySelection}
          onPaste={pasteAtPlayhead}
          onDuplicate={duplicateSelection}
          canPaste={canPaste}
        />
      )}

      {sheetsInDock ? null : sheets}
    </View>
    </UndoGestureArea>
  );
}

/** Kompakt transport-gomb (ikon és/vagy rövid címke; aktív/tiltott állapot). */
function TBtn({
  icon,
  label,
  onPress,
  disabled,
  active,
  ...press
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  onLongPress?: () => void;
  onPressOut?: () => void;
  delayLongPress?: number;
  testID?: string;
  /** csak ikonos gombnál kötelező értelme van (VoiceOver/TalkBack) */
  accessibilityLabel?: string;
}) {
  const color = disabled ? palette.border : active ? palette.accent : palette.text;
  return (
    <Pressable
      {...press}
      style={[styles.tBtn, active && styles.tBtnActive]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      {label ? (
        <Text style={[styles.tBtnLabel, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addLane: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  addLaneText: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  multiBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, backgroundColor: palette.surfaceHigh },
  multiText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  root: { flex: 1, backgroundColor: '#05060a' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topBtn: { padding: 2 },
  srcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: palette.surface,
  },
  albumCount: { color: palette.accent, fontSize: 11, fontWeight: '800' },
  titleWrap: { flex: 1, gap: 2 },
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  kindTagText: { color: palette.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  exportText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  timelineWrap: { flex: 1, flexDirection: 'row', marginTop: 8, backgroundColor: '#080a11' },
  headers: { width: HEADER_W, borderRightWidth: 1, borderRightColor: palette.border, backgroundColor: palette.surface },
  laneHeader: { height: LANE_H, alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: palette.border },
  laneHeadTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackName: { color: palette.textDim, fontSize: 9, fontWeight: '800', maxWidth: HEADER_W - 16, textTransform: 'uppercase', letterSpacing: 0.4 },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  soloText: { color: palette.textDim, fontSize: 12, fontWeight: '900' },
  lane: { height: LANE_H, borderBottomWidth: 1, borderBottomColor: palette.border, justifyContent: 'center' },
  laneEmpty: { color: `${palette.textDim}55`, fontSize: 11, fontWeight: '800', paddingLeft: 10, textTransform: 'uppercase', letterSpacing: 1.5 },
  grid: { position: 'absolute', top: 0, width: 1 },
  beatLine: { position: 'absolute', top: 0, backgroundColor: palette.accent },
  detectedBeat: { position: 'absolute', top: 0, width: 1.5, backgroundColor: palette.accent2, opacity: 0.55 },
  loopShade: { position: 'absolute', top: 0, backgroundColor: `${palette.accent}1f`, borderLeftWidth: 1, borderRightWidth: 1, borderColor: `${palette.accent}88` },
  ruler: { height: RULER_H, borderBottomWidth: 1, borderBottomColor: palette.border },
  rulerLabel: { position: 'absolute', top: 5, color: palette.textDim, fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clip: { position: 'absolute', top: 6, bottom: 6, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden', justifyContent: 'center' },
  clipFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clipLabel: { color: palette.text, fontSize: 10, fontWeight: '700', paddingHorizontal: 6 },
  playhead: { position: 'absolute', top: 0, width: 2, backgroundColor: '#fff' },
  phBubble: { position: 'absolute', top: 2, backgroundColor: palette.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  phBubbleText: { color: '#fff', fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fillCol: { flex: 1 },
  dockRow: { flex: 1, flexDirection: 'row' },
  emptyGuide: { position: 'absolute', left: HEADER_W, right: 0, alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  emptyGuideText: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyGuideRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  emptyGuideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  emptyGuideBtnPrimary: { backgroundColor: palette.accent, borderColor: palette.accent },
  emptyGuideBtnText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  emptyGuideBtnTextPrimary: { color: '#fff', fontSize: 14, fontWeight: '800' },
  // a transport-sor nem nő flexből (a sávok kapják a helyet)
  transportBar: { flexGrow: 0 },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  time: { color: palette.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  timeWrap: { alignItems: 'center' },
  bars: { color: palette.accent, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 30, height: 32, paddingHorizontal: 7, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, justifyContent: 'center' },
  tBtnActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}22` },
  tBtnLabel: { fontSize: 11, fontWeight: '800' },
  tSep: { width: 1, height: 24, backgroundColor: palette.border, marginHorizontal: 2 },
  bpmWrap: { alignItems: 'center', minWidth: 34 },
  bpmVal: { color: palette.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bpmLabel: { color: palette.textDim, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
});
