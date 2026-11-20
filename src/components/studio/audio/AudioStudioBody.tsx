import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type GestureResponderEvent, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { LANE_HEIGHTS, useAudioEditMode } from '@/store/audioEditModeStore';
import { NewerSchemaBanner } from '@/components/NewerSchemaBanner';
import { VideoReference } from '@/components/studio/audio/VideoReference';
import { MixAssistSheet } from '@/components/studio/audio/MixAssistSheet';
import { UndoGestureArea } from '@/components/UndoGestureArea';
import { audioLanes } from '@/components/studio/audio/audioLanes';
import { nextExtraTrack } from '@/lib/audioTracks';
import { SilenceReviewBar } from '@/components/studio/audio/SilenceReview';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { SpeechEditBar } from '@/components/studio/audio/SpeechEditBar';
import { useSpeechEdit } from '@/store/speechEditStore';
import { AudioAssistantBar } from '@/components/studio/audio/AudioAssistantBar';
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
import { timelineScrollHandlers, timelineZoomActions, useTimelineView } from '@/components/studio/audio/body/useTimelineView';
import { studioActions } from '@/components/studio/audio/body/studioActions';
import { studioDevApi } from '@/components/studio/audio/body/studioDevApi';
import { openInstrumentOf, studioSheetHandlers } from '@/components/studio/audio/body/sheetHandlers';
import { InstrumentOverlays } from '@/components/studio/audio/body/InstrumentOverlays';
import { MultiSelectBar } from '@/components/studio/audio/body/MultiSelectBar';
import { AudioStudioTopBar } from '@/components/studio/audio/AudioStudioTopBar';
import { AudioLaneHeaders } from '@/components/studio/audio/AudioLaneHeaders';
import { AudioTimelineContent } from '@/components/studio/audio/AudioTimelineContent';
import { AudioEmptyGuide } from '@/components/studio/audio/AudioEmptyGuide';
import { AudioTransportBar } from '@/components/studio/audio/AudioTransportBar';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { useLayout } from '@/hooks/useLayout';
import type { Detent } from '@/lib/panelLayout';
import type { AudioSheetId } from '@/lib/panelSpecs';
import { inlineDetentOf, inlineSheetOf, sheetFrameOf } from '@/lib/audioSheetLayout';
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
  pxPerSecAt,
  rulerTicks,
  type SnapMode,
} from '@/lib/audioTransport';
import { pasteTargetOf, timelineWindow } from '@/lib/audioStudioOps';
import { editGridRate } from '@/lib/frames';
import { projectDuration } from '@/lib/projectUtils';
import { beatLinesForClips } from '@/lib/beatMarkers';
import { useEditorStore } from '@/store/editorStore';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { initialAudioMode, transportLayout, type AudioStudioMode } from '@/lib/audioStudioModes';
import type { AudioClip } from '@/types/project';
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
 * nézet és nagyítás (`body/useTimelineView`), saját műveletek (`body/studioActions`), lap-kezelők
 * (`body/sheetHandlers`), füstteszt-API (`body/studioDevApi`); a tiszta számítások a `@/lib/audioStudioOps`-ban
 * és a `@/lib/audioSheetLayout`-ban.
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
  const [snapMode, setSnapMode] = useState<SnapMode>('frame');
  // 🎙️ felvétel (szünet, előszámlálás, metronóm, punch-in) — `body/useStudioRecording`
  const rec = useStudioRecording({ t, project, playhead });
  // 🔍 nagyítás, látható ablak, görgetés + követés lejátszás alatt — `body/useTimelineView`
  const { zoomIndex, setZoomIndex, view, setView, viewXRef, zoomIndexRef, pinchStartRef, fitPps, setFitPps, scrollRef, scrollXRef, followRef } = useTimelineView({ playhead, isPlaying });

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

  // 🔍 csippentés / ± lépés / „illeszd” — `body/useTimelineView`
  const { timelinePinch, zoomStep, fitToView } = timelineZoomActions({ fitPps, zoomIndex, view, duration, setFitPps, setZoomIndex, scrollRef, pinchStartRef, zoomIndexRef });

  // 🚪🥁🗂️ kilépés, tempó-felismerés, forrás beillesztése — `body/studioActions`
  const { exitStudio, autoDetectBpm, insertSource } = studioActions({
    t,
    project,
    playhead,
    grid,
    selClip,
    bpmBusy,
    setBpmBusy,
    setDetectedBeats,
    setSource,
    finishIfRecording: rec.finishIfRecording,
    onExit,
  });

  devApi.current = studioDevApi({ t, grid, meter, fitToView, zoomStep, edit, ai, inst, rec, autoDetectBpm, setMixerOpen, setEditing, setAssistantOpen });

  // a nyitott inline lap (a többi workspace vagy modális — azok nem nyomják össze a sávokat)
  const inlineSheet = inlineSheetOf({ editing, hasSelClip: !!selClip, mastering, mixerOpen });
  const inlineDetent = inlineDetentOf(inlineSheet, detentById);
  // 📐 a lap-keret (detentek, dokkolás) — `@/lib/audioSheetLayout`
  const sheetFrame = sheetFrameOf({
    rootH,
    topBarH,
    transportH,
    inlineDetent,
    docked,
    onDetentChange: (d: Detent) =>
      inlineSheet && setDetentById((m) => ({ ...m, [inlineSheet]: d })),
  });
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
      setSource={setSource}
      setAlbumOpen={setAlbumOpen}
      editDoc={instrumentDocOf(project, inst.editDocId ?? undefined)}
      {...studioSheetHandlers({ inst, ai, setEditing })}
      onInsertSource={(asset) => {
        void insertSource(asset).catch((caught) => { logCaught('components/studio/audio/AudioStudioBody.tsx:insertSource', caught); });
      }}
      onShareAlbum={album.confirmShareAlbum}
      frame={sheetFrame}
    />
  );

  const openInstrument = openInstrumentOf(inst);
  const scroll = timelineScrollHandlers({ setView, scrollXRef, viewXRef, viewW });

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
            onLayout={scroll.onLayout}
            onScroll={scroll.onScroll}
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
      {multiSelectMode ? <MultiSelectBar count={multiSelectIds.length + (selectedClipId ? 1 : 0)} /> : null}

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
      <InstrumentOverlays inst={inst} project={project} bpm={bpm} />
    </View>
    </UndoGestureArea>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  timelineWrap: { flex: 1, flexDirection: 'row', marginTop: 8, backgroundColor: '#080a11' },
  fillCol: { flex: 1 },
  dockRow: { flex: 1, flexDirection: 'row' },
});
