import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { LANE_HEIGHTS, useAudioEditMode } from '@/store/audioEditModeStore';
import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { VideoReference } from '@/components/studio/audio/VideoReference';
import { MixAssistSheet } from '@/components/studio/audio/MixAssistSheet';
import { UndoGestureArea } from '@/components/UndoGestureArea';
import { audioLanes } from '@/components/studio/audio/audioLanes';
import { nextExtraTrack } from '@/lib/audioTracks';
import { SilenceReviewBar, startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { SpeechEditBar, startSpeechEdit, upgradeSpeechModel } from '@/components/studio/audio/SpeechEditBar';
import { useSpeechEdit } from '@/store/speechEditStore';
import { AudioAssistantBar } from '@/components/studio/audio/AudioAssistantBar';
import { runAudioSync, syncCandidates } from '@/components/studio/audio/audioSyncAction';
import { snapToMarkers } from '@/lib/audioMarkers';
import { selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { AudioStudioSheets } from '@/components/studio/audio/body/AudioStudioSheets';
import { AudioStudioToolbar } from '@/components/studio/audio/body/AudioStudioToolbar';
import { RecordingStrip } from '@/components/studio/audio/body/RecordingStrip';
import { LANE_H, RULER_H } from '@/components/studio/audio/body/timelineMetrics';
import { useStudioRecording } from '@/components/studio/audio/body/useStudioRecording';
import { useInstrumentStudio } from '@/components/studio/audio/body/useInstrumentStudio';
import { useAlbumShare } from '@/components/studio/audio/body/useAlbumShare';
import { clipAiActions } from '@/components/studio/audio/body/clipAiActions';
import { audioEditActions } from '@/components/studio/audio/body/editActions';
import { NOOP_DEV_API, useAudioStudioDevActions, type AudioStudioDevApi } from '@/components/studio/audio/body/useAudioStudioDevActions';
import { AudioStudioTopBar } from '@/components/studio/audio/AudioStudioTopBar';
import { AudioLaneHeaders } from '@/components/studio/audio/AudioLaneHeaders';
import { AudioTimelineContent } from '@/components/studio/audio/AudioTimelineContent';
import { AudioEmptyGuide } from '@/components/studio/audio/AudioEmptyGuide';
import { AudioTransportBar, type TransportInstrument } from '@/components/studio/audio/AudioTransportBar';
import { SamplerMelodySheet } from '@/components/studio/audio/SamplerMelodySheet';
import { ChordSheet } from '@/components/studio/audio/ChordSheet';
import { LoopLibrarySheet } from '@/components/studio/audio/LoopLibrarySheet';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { layoutBudget, type Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';
import {
  beatGridForTiming,
  bpmAt,
  DEFAULT_BPM,
  DEFAULT_METER,
  projectTiming,
  snapSecT,
  tempoChangeAt,
  tempoMapWith,
  tempoMapWithout,
  nextMeter,
  DEFAULT_ZOOM_INDEX,
  fitPxPerSec,
  followScrollX,
  nearestZoomIndex,
  pxPerSecAt,
  rulerTicks,
  type SnapMode,
  zoomIn,
  zoomOut,
  ZOOM_LEVELS,
} from '@/lib/audioTransport';
import { zoomIndexForPinch } from '@/lib/audioTimelineGestures';
import { firstAudioClipWithUri, importedAudioClip, pasteTargetOf, timelineWindow } from '@/lib/audioStudioOps';
import { editGridRate, snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { detectBeats } from '@/lib/beats';
import { beatLinesForClips } from '@/lib/beatMarkers';
import { useEditorStore } from '@/store/editorStore';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { initialAudioMode, transportLayout, type AudioStudioMode } from '@/lib/audioStudioModes';
import type { Asset, AudioClip } from '@/types/project';
import { probeAudioDuration } from '@/lib/media';
import { logCaught } from '@/lib/logCaught';

/* a sávok: `audioLanes(project)` (az alap három + a „+ Sáv”-val hozzáadottak) */

/**
 * 🎧 A hang-stúdió TÖRZSE — store-vezérelt, UI-only. A projektet a hívó tölti a
 * `useEditorStore`-ba (route-mód) VAGY már betöltve van (scoped, a videó-editorból),
 * és a hívó gondoskodik a rAF-óráról (`usePlaybackClock`) + a `<AudioLayer />`-ről
 * (scoped módban a videó-editor előnézete adja — NE duplázzuk). Így ugyanez a UI és
 * logika fut a `/studio/audio/[id]` képernyőn és a videóból nyíló Modalban.
 *
 * A részei: fejléc (`AudioStudioTopBar`), sáv-fejlécek (`AudioLaneHeaders`), idővonal
 * (`AudioTimelineContent`), transzport (`AudioTransportBar`), lapok (`body/AudioStudioSheets`);
 * a logika: felvétel (`body/useStudioRecording`), hangszerek (`body/useInstrumentStudio`),
 * AI-műveletek (`body/clipAiActions`), szerkesztés (`body/editActions`), album (`body/useAlbumShare`),
 * a tiszta számítások a `@/lib/audioStudioOps`-ban.
 */
export function AudioStudioBody({
  mode,
  workspace,
  title,
  onExit,
  onExport,
  onRequestCheck,
  onSendToVideo,
}: {
  mode: 'project' | 'scoped';
  /** 🎵 Zene munkaterület (S10): a hangszer-eszközök a transzport elején (a `music` fajta / `?ws=music`) */
  workspace?: 'music';
  title: string;
  onExit: () => void;
  onExport?: () => void;
  /** 🩺 a hangellenőrzés (a képernyő futtatja; az asszisztens is kérheti) */
  onRequestCheck?: () => void;
  /** 🔗 C7: az asszisztens „videóba” művelete — a képernyő a C2 hivatkozásos átadásával végzi */
  onSendToVideo?: (target: 'new' | 'latest' | 'pick') => void;
}) {
  const { t } = useTranslation();
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
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const [editing, setEditing] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tts, setTts] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // 🎛️ V10: stúdió-mód (Gyors · Keverés · Zene · AI) — nézet, projektenként az eszközön; a módon
  // kívüli gombcsoportok a „Több” mögött
  const savedMode = useEditorPrefs((s) => (project ? s.audioModes[project.id] : undefined));
  const studioMode = initialAudioMode(savedMode, project?.kind, workspace);
  const [modePicker, setModePicker] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const layout = useMemo(() => transportLayout(studioMode), [studioMode]);
  const chooseMode = useCallback(
    (m: AudioStudioMode) => {
      const id = useEditorStore.getState().project?.id;
      if (id) useEditorPrefs.getState().setAudioMode(id, m);
      setModePicker(false);
      setShowMore(false);
      // az AI módban az asszisztens azonnal kéznél van
      if (m === 'ai') setAssistantOpen(true);
    },
    []
  );
  const editMode = useAudioEditMode((s) => s.mode);
  const largeLanes = useAudioEditMode((s) => s.large);
  const laneH = largeLanes ? LANE_HEIGHTS.large : LANE_H;
  const inst = useInstrumentStudio({ t, project, setEditing });
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
  // 🧪 füstteszt (S14): a lap-elrendezés kiolvasása
  const layoutRef = useRef<{ docked: boolean; workspaceTop: number | null; rootH: number }>({ docked: false, workspaceTop: null, rootH: 0 });
  const album = useAlbumShare(t);
  const [tlH, setTlH] = useState(0); // az idővonal-terület magassága (rács/playhead a teljes magasságot tölti)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [snapMode, setSnapMode] = useState<SnapMode>('frame');
  // 📏 A42: a vonalzó és a rács csak a látható ablakra (± egy képernyő) rajzolódik
  const [view, setView] = useState({ x: 0, w: 0 });
  const viewXRef = useRef(0);
  // 🎙️ felvétel (szünet, előszámlálás, metronóm, punch-in) — `body/useStudioRecording`
  const rec = useStudioRecording({ t, project, playhead });
  // 🔍 pinch-zoom: a mindig friss zoom-index + a csippentés kezdő-indexe (ref, hogy a
  // gesztus-callback ne stale state-et lásson)
  const zoomIndexRef = useRef(DEFAULT_ZOOM_INDEX);
  zoomIndexRef.current = zoomIndex;
  const pinchStartRef = useRef(DEFAULT_ZOOM_INDEX);

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
  const devApi = useRef<AudioStudioDevApi>(NOOP_DEV_API);
  useAudioStudioDevActions({
    workspace,
    api: devApi,
    layoutRef,
    scrollXRef,
    followRef,
    studioMode,
    layout,
    showMore,
    assistantOpen,
    chooseMode,
    setModePicker,
    setShowMore,
    setMastering,
    setMixerOpen,
    setTts,
    setSampler: inst.setSampler,
    setAdding,
    setLoopsOpen: inst.setLoopsOpen,
    setChordsOpen: inst.setChordsOpen,
  });

  if (!project) {
    return null;
  }
  const fps = project.fps ?? 30;
  // 🎧 V6: a szerkesztési rács (hang-projektben a minta, a videóból nyitva a képkocka) — a beillesztés, a vágás,
  // a duplikálás, a felvétel és az elemzések (csend, szinkron) helye ezen; a „Képkocka” snap-mód marad fps
  const grid = editGridRate(project);
  const bpm = project.bpm ?? DEFAULT_BPM;
  // 🎼 S13: a projekt időzítése tempóváltásokkal — a rács, a snap, az ugrás, a kijelzés és az ütemre vágás ezen
  const timing = projectTiming(project);
  // 🎼 ütemjelzés (hiányzó = 4/4) — a rács, a snap és az ütem.ütemrész kijelzés is ezt követi
  const meter = project.timeSignature ?? DEFAULT_METER;
  // 🎼 a lejátszófejnél érvényes tempó és tempóváltás; a ± az itteni szakaszt lépteti (az induló tempót SET_BPM-mel)
  const tempoHere = tempoChangeAt(project, playhead);
  const bpmHere = bpmAt(project, playhead);
  const pxPerSec = fitPps ?? pxPerSecAt(zoomIndex);
  const duration = projectDuration(project);
  const { timelineW, viewW, viewFrom, viewTo } = timelineWindow(duration, pxPerSec, view);
  const laneAreaH = RULER_H + laneH * LANES.length;
  const contentH = Math.max(tlH, laneAreaH); // a rács/playhead a teljes területet tölti
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
  // 🎼 S13: a rács a projekt időzítésén (tempóváltásokkal)
  const beatTimes = beatGridForTiming(timing, viewFrom, Math.min(duration + 2, viewTo), pxPerSec);

  // 🔖 a markerek is snap-pontok (10 képpontnyi közelségben)
  const snapSecIn = (sec: number) => snapToMarkers(snapSecT(sec, snapMode, fps, timing), project.markers ?? [], 10 / pxPerSec);

  // 🤖 a klipekre futó AI-műveletek (hangolás, dallam, stemek, zajszűrés, AI-dob) — `body/clipAiActions`
  const ai = clipAiActions({ t, bpm, setEditing, placeInstrument: inst.placeInstrument });
  // ✂️📋 szerkesztő-műveletek + az asszisztens folyamat-műveletei — `body/editActions`
  const edit = audioEditActions({
    t,
    grid,
    bpm,
    meter,
    pxPerSec,
    laneTypes: LANE_TYPES,
    onRequestCheck,
    onSendToVideo,
    aiDrums: (bars) => ai.aiDrumsAt(bars),
    aiDenoiseMany: (ids) => ai.aiDenoiseClips(ids),
  });

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

  const zoomStep = (dir: 1 | -1) => {
    const from = fitPps !== null ? nearestZoomIndex(fitPps) : zoomIndex;
    setFitPps(null);
    setZoomIndex(dir > 0 ? zoomIn(from) : zoomOut(from));
  };
  const fitToView = () => {
    setFitPps(fitPxPerSec(view.w || 1200, duration));
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  };

  // kilépéskor a futó felvétel klip lesz, nem vész el
  const exitStudio = () => {
    void rec
      .finishIfRecording()
      .catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:exitStudio', caught); })
      .then(onExit);
  };

  // 🥁🔎 tempó auto-felismerés: a kiválasztott (vagy az első hang-) klip beat-rácsából → BPM (a telefonon, offline; a worker tartalék)
  const autoDetectBpm = async () => {
    if (bpmBusy) {
      return;
    }
    const sourceClip = selClip ?? firstAudioClipWithUri(project) ?? null;
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
    const clip = importedAudioClip({ id: makeId('clip'), start: snapToFrame(playhead, grid), duration: dur, uri: asset.uri, label: asset.name ?? t('studio.kind.audio') });
    useEditorStore.getState().addClip('music', clip, asset);
    setSource(false);
  };

  devApi.current = {
    fit: fitToView,
    zoomIn: () => zoomStep(1),
    marker: edit.markerAtPlayhead,
    addLane: edit.addLane,
    mixer: () => setMixerOpen(true),
    copy: edit.copySelection,
    paste: edit.pasteAtPlayhead,
    duplicate: edit.duplicateSelection,
    meter: () => useEditorStore.getState().dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: nextMeter(meter) }),
    beatSplit: edit.beatSplitSelection,
    silenceFind: async () => {
      const st = useEditorStore.getState();
      const c = selectedAudioClip(st.project, st.selectedClipId);
      const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === c?.id));
      return c && tr ? startSilenceSearch(c, tr.type, grid, t) : null;
    },
    speechStart: async () => {
      const st = useEditorStore.getState();
      const tr = st.project?.tracks.find((x) => x.clips.some((y) => y.id === st.selectedClipId));
      return tr ? startSpeechEdit(tr.type, t) : null;
    },
    speechUpgrade: () => upgradeSpeechModel(t, false),
    syncSelected: async () => {
      const st = useEditorStore.getState();
      const c = selectedAudioClip(st.project, st.selectedClipId);
      const ref = c ? syncCandidates(c)[0] : undefined;
      return c && ref ? runAudioSync(c, ref, grid, t, true) : null;
    },
    openDrums: () => inst.setDrumMachine(true),
    editClip: () => setEditing(true),
    closeDrums: () => inst.setDrumMachine(false),
    assistant: () => setAssistantOpen(true),
    pianoRoll: (open) => inst.setPianoRoll(open),
    autoBpm: autoDetectBpm,
    insertSilence: edit.insertSilenceAt,
    join: edit.joinSelected,
    recordToggle: rec.toggleRecord,
    recordPause: rec.pauseResumeRecording,
    recordState: rec.recordState,
    placeLoop: inst.placeLoopById,
    placeCloud: inst.placeCloudTrack,
    placeChords: (arg) => inst.placeChords(arg.key, arg.prog, arg.parts),
    stems: ai.stemsOnDevice,
    aiDrums: ai.aiDrumsAt,
    aiDenoiseMany: ai.aiDenoiseClips,
    aiDenoise: ai.applyAiDenoise,
    resetAiDenoise: ai.resetAiDenoise,
    humMelody: ai.humMelody,
    applyTune: ai.applyTune,
  };

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
          // 🎹 S14: iPad fekvőben a hangszer-szerkesztő a felület alsó ~58 %-án, a sávok fölötte látszanak
          ...(docked ? { workspaceTop: topBarH + Math.round((rootH - topBarH) * 0.42) } : {}),
        }
      : null;
  layoutRef.current = { docked, workspaceTop: sheetFrame?.workspaceTop ?? null, rootH };
  // dokkolt módban a nyitott inline lap a sávok mellé kerül (a workspace/modális lapok maradnak)
  const sheetsInDock = docked && inlineSheet !== null;

  const sheets = (
    <AudioStudioSheets
      selClip={selClip}
      fps={grid}
      bpm={bpm}
      editing={editing}
      mastering={mastering}
      mixerOpen={mixerOpen}
      adding={adding}
      tts={tts}
      pianoRoll={inst.pianoRoll}
      pianoBusy={inst.pianoBusy}
      drumMachine={inst.drumMachine}
      drumBusy={inst.drumBusy}
      sampler={inst.sampler}
      samplerBusy={inst.samplerBusy}
      source={source}
      albumOpen={albumOpen}
      setEditing={setEditing}
      setMastering={setMastering}
      setMixerOpen={setMixerOpen}
      setAdding={setAdding}
      setTts={setTts}
      setPianoRoll={(v) => {
        inst.setPianoRoll(v);
        if (!v) inst.setEditDocId(null);
      }}
      setDrumMachine={(v) => {
        inst.setDrumMachine(v);
        if (!v) inst.setEditDocId(null);
      }}
      setSampler={(v) => {
        inst.setSampler(v);
        if (!v) inst.setEditDocId(null);
      }}
      setSource={setSource}
      setAlbumOpen={setAlbumOpen}
      onBakeSynth={(notes, wave, bars) => void inst.bakeSynth(notes, wave, bars)}
      onBakeDrums={(hits, bars, src) => void inst.bakeDrums(hits, bars, src)}
      editDoc={instrumentDocOf(project, inst.editDocId ?? undefined)}
      onEditInstrument={inst.editInstrument}
      onOpenLoops={() => inst.setLoopsOpen(true)}
      onTune={(id, s) => {
        setEditing(false);
        void ai.applyTune(id, s);
      }}
      onHumMelody={(id, k) => void ai.humMelody(id, k)}
      onStemsOnDevice={(id) => void ai.stemsOnDevice(id)}
      onAiDenoise={(id, strength) => void ai.applyAiDenoise(id, strength)}
      onResetAiDenoise={ai.resetAiDenoise}
      onResetTune={(id) => {
        setEditing(false);
        ai.resetTune(id);
      }}
      onBakeSamplerPads={(uri, slices, pads, bars, name) => void inst.bakeSamplerPads(uri, slices, pads, bars, name)}
      onSamplerMelody={(uri, name, rootMidi) => {
        inst.setSampler(false);
        inst.setSamplerMelody({ sampleUri: uri, sampleName: name, rootMidi });
      }}
      onBakeSampler={(uri, pattern, bars, name) => void inst.bakeSampler(uri, pattern, bars, name)}
      onInsertSource={(asset) => {
        void insertSource(asset).catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:insertSource', caught); });
      }}
      onShareAlbum={album.confirmShareAlbum}
      frame={sheetFrame}
    />
  );

  const openInstrument = (which: TransportInstrument) => {
    if (which === 'pianoRoll') inst.setPianoRoll(true);
    else if (which === 'drums') inst.setDrumMachine(true);
    else if (which === 'sampler') inst.setSampler(true);
    else if (which === 'loops') inst.setLoopsOpen(true);
    else inst.setChordsOpen(true);
  };

  return (
    <UndoGestureArea>
    <View style={styles.root} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <NewerSchemaBanner />
      {/* 🎬 a videóból nyitva: a lejátszófejhez tartozó videó-képkocka (A/V szinkron nem vakon) */}
      {mode === 'scoped' ? <VideoReference /> : null}
      <AudioStudioTopBar
        mode={mode}
        title={title}
        studioMode={studioMode}
        modePicker={modePicker}
        album={project.album}
        albumSharing={album.albumSharing}
        onExit={exitStudio}
        onToggleModePicker={() => setModePicker((v) => !v)}
        onChooseMode={chooseMode}
        onSource={() => setSource(true)}
        onAlbum={() => setAlbumOpen(true)}
        onExport={onExport}
        onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}
      />

      {/* multi-track idővonal */}
      <View style={sheetsInDock ? styles.dockRow : styles.fillCol}>
        <GestureDetector gesture={timelinePinch}>
        <View style={styles.timelineWrap} onLayout={(e) => setTlH(e.nativeEvent.layout.height)}>
          <AudioLaneHeaders
            lanes={LANES}
            laneH={laneH}
            mutedTracks={mutedTracks}
            soloTracks={soloTracks}
            lockedTracks={lockedTracks}
            canAddLane={!!nextExtraTrack(LANE_TYPES)}
            onToggleFlag={(type, flag) => useEditorStore.getState().toggleTrackFlag(type, flag)}
            onLaneActions={edit.laneActions}
            onAddLane={edit.addLane}
          />

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
            <AudioTimelineContent
              tracks={project.tracks}
              lanes={LANES}
              laneTypes={LANE_TYPES}
              laneH={laneH}
              timelineW={timelineW}
              contentH={contentH}
              pxPerSec={pxPerSec}
              duration={duration}
              playhead={playhead}
              ticks={ticks}
              beatTimes={beatTimes}
              detectedLines={detectedLines}
              rangeIn={rangeIn}
              rangeOut={rangeOut}
              editMode={editMode}
              selectedClipId={selectedClipId}
              multiSelectIds={multiSelectIds}
              snap={snapSecIn}
              onSeek={seekAt}
            />
          </ScrollView>
          {/* 🧭 üres projekt: egyértelmű első lépés a sávok alatti üres területen (T1/A1) */}
          {LANES.every((lane) => !project.tracks.find((tr) => tr.type === lane.type)?.clips.length) ? (
            <AudioEmptyGuide top={RULER_H + LANES.length * laneH + 32} onAdd={() => setAdding(true)} onRecord={rec.toggleRecord} />
          ) : null}
        </View>
        </GestureDetector>
        {sheetsInDock ? <View style={{ width: L.editor.inspectorWidth }}>{sheets}</View> : null}
      </View>

      {/* transport — gazdag sor (undo/redo · ugrás · loop/In-Out · idő+ütem · BPM · zoom · snap) */}
      <AudioTransportBar
        playhead={playhead}
        duration={duration}
        timing={timing}
        isPlaying={isPlaying}
        meter={meter}
        bpmHere={bpmHere}
        hasTempoHere={tempoHere !== null}
        front={layout.front}
        more={layout.more}
        showMore={showMore}
        onToggleMore={() => setShowMore((v) => !v)}
        instruments={{ pianoRoll: inst.pianoRoll, drums: inst.drumMachine, sampler: inst.sampler, loops: inst.loopsOpen, chords: inst.chordsOpen }}
        onOpenInstrument={openInstrument}
        rangeIn={rangeIn}
        rangeOut={rangeOut}
        onTempoAdd={() => useEditorStore.getState().dispatch({ type: 'SET_TEMPO_MAP', tempoMap: tempoMapWith(project, playhead, bpmHere) })}
        onTempoRemove={() => useEditorStore.getState().dispatch({ type: 'SET_TEMPO_MAP', tempoMap: tempoMapWithout(project, playhead) })}
        onNextMeter={() => useEditorStore.getState().dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: nextMeter(meter) })}
        bpmBusy={bpmBusy}
        onAutoBpm={() => void autoDetectBpm()}
        onZoomStep={zoomStep}
        fitActive={fitPps !== null}
        onFit={fitToView}
        onMarker={edit.markerAtPlayhead}
        editMode={editMode}
        largeLanes={largeLanes}
        assistantOpen={assistantOpen}
        onToggleAssistant={() => setAssistantOpen(!assistantOpen)}
        snapMode={snapMode}
        onSnapMode={setSnapMode}
        onLayout={(e) => setTransportH(e.nativeEvent.layout.height)}
      />

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
      {assistantOpen ? <AudioAssistantBar onActions={edit.runAssistantActions} onClose={() => setAssistantOpen(false)} /> : null}

      {/* ✂️💬 beszédvágás szöveggel */}
      <SpeechEditBar />

      {/* 🔇 csendek jóváhagyása */}
      <SilenceReviewBar />

      {/* 🎙️ felvételi sáv: szünet/folytatás, szintmérő, idő, „túl hangos” */}
      {rec.recActive ? (
        <RecordingStrip
          paused={rec.recPaused}
          meterDb={rec.recorderState.metering}
          hot={rec.recHot}
          durationMs={rec.recorderState.durationMillis}
          onPauseResume={rec.pauseResumeRecording}
          canPause={!rec.punchRef.current && !rec.recCountingIn}
          status={rec.recArmed && !rec.recorderState.isRecording ? t(rec.punchRef.current?.open ? 'studio.audio.rec.countingIn' : 'studio.audio.rec.punchArmed') : rec.recCountingIn ? t('studio.audio.rec.countingIn') : null}
        />
      ) : null}

      {/* eszköz-sor — nyitott inline lapnál rejtve (a lap fejléce a kilépés; a transport marad) */}
      {inlineSheet && !docked ? null : (
        <AudioStudioToolbar
          hasSelection={!!selClip}
          isRecording={rec.recActive}
          onAdd={() => setAdding(true)}
          onRecord={rec.toggleRecord}
          onRecordLongPress={rec.recordOptions}
          onSplit={() => selClip && useEditorStore.getState().splitClipAt(selClip.id, playhead)}
          onBeatSplit={edit.askCutMenu}
          onEdit={() => selClip && setEditing(true)}
          onDelete={() => selClip && useEditorStore.getState().removeSelectedClips()}
          onMixer={() => setMixerOpen(true)}
          onCopy={edit.copySelection}
          onPaste={edit.pasteAtPlayhead}
          onDuplicate={edit.duplicateSelection}
          canPaste={canPaste}
        />
      )}

      {sheetsInDock ? null : sheets}
      {inst.samplerMelody ? (
        <SamplerMelodySheet
          key={`sampler-melody-${inst.editDocId ?? 'new'}`}
          melody={inst.samplerMelody}
          bpm={bpm}
          busy={inst.samplerBusy}
          editDoc={instrumentDocOf(project, inst.editDocId ?? undefined)}
          onClose={() => {
            inst.setSamplerMelody(null);
            inst.setEditDocId(null);
          }}
          onBake={(notes, bars) => void inst.bakeSamplerMelody(notes, bars)}
        />
      ) : null}
      {inst.chordsOpen ? <ChordSheet bpm={bpm} busy={inst.chordBusy} onPlace={(key, prog, parts) => void inst.placeChords(key, prog, parts)} onClose={() => inst.setChordsOpen(false)} /> : null}
      {inst.loopsOpen ? <LoopLibrarySheet bpm={bpm} busyId={inst.loopBusy} onPick={(l) => void inst.placeLoop(l)} onPickCloud={(tr) => void inst.placeCloudTrack(tr)} onClose={() => inst.setLoopsOpen(false)} /> : null}
    </View>
    </UndoGestureArea>
  );
}

const styles = StyleSheet.create({
  multiBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, backgroundColor: palette.surfaceHigh },
  multiText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  root: { flex: 1, backgroundColor: '#05060a' },
  timelineWrap: { flex: 1, flexDirection: 'row', marginTop: 8, backgroundColor: '#080a11' },
  fillCol: { flex: 1 },
  dockRow: { flex: 1, flexDirection: 'row' },
});
