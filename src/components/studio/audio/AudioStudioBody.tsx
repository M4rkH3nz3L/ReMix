import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { AudioTimelineClip } from '@/components/studio/audio/AudioTimelineClip';
import { selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { AudioStudioSheets } from '@/components/studio/audio/body/AudioStudioSheets';
import { AudioStudioToolbar } from '@/components/studio/audio/body/AudioStudioToolbar';
import { palette } from '@/constants/editor';
import { layoutBudget, type Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';
import { setActiveSong, setSongRender, songCount } from '@/lib/albumDoc';
import { buildAlbumVideoProject } from '@/lib/albumShare';
import {
  barsBeatsLabel,
  beatLines,
  DEFAULT_BPM,
  DEFAULT_ZOOM_INDEX,
  nextBeatSec,
  prevBeatSec,
  pxPerSecAt,
  snapSec,
  type SnapMode,
  zoomIn,
  zoomOut,
  ZOOM_LEVELS,
} from '@/lib/audioTransport';
import { zoomIndexForPinch } from '@/lib/audioTimelineGestures';
import { publishRenderedProject } from '@/lib/feed';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { exportAudioFile } from '@/lib/render';
import { renderSynthToClip } from '@/lib/synthClient';
import type { SynthNote, SynthWave } from '@/lib/synth';
import { renderDrumsToClip } from '@/lib/drumsClient';
import type { DrumHit } from '@/lib/drums';
import { renderSamplerToClip } from '@/lib/samplerClient';
import type { SamplerPattern } from '@/lib/sampler';
import { detectBeats } from '@/lib/beats';
import { beatsToTimelineLines } from '@/lib/beatMarkers';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, TrackType } from '@/types/project';

const LANE_H = 70;
const RULER_H = 24;
const HEADER_W = 62;

const LANES: { type: TrackType; icon: keyof typeof Ionicons.glyphMap; color: string; labelKey: string }[] = [
  { type: 'music', icon: 'musical-notes', color: palette.accent, labelKey: 'editor.track.music' },
  { type: 'voiceover', icon: 'mic', color: palette.accent2, labelKey: 'editor.track.voiceover' },
  { type: 'sfx', icon: 'flash', color: '#39d98a', labelKey: 'editor.track.sfx' },
];
/** a sávok típusai fentről le — stabil referencia az AudioTimelineClip sáv-váltásához */
const LANE_TYPES = LANES.map((l) => l.type);

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
}: {
  mode: 'project' | 'scoped';
  title: string;
  onExit: () => void;
  onExport?: () => void;
}) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
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
  const [pianoBusy, setPianoBusy] = useState(false);
  const [drumMachine, setDrumMachine] = useState(false);
  const [drumBusy, setDrumBusy] = useState(false);
  const [sampler, setSampler] = useState(false);
  const [samplerBusy, setSamplerBusy] = useState(false);
  const [bpmBusy, setBpmBusy] = useState(false);
  const [detectedBeats, setDetectedBeats] = useState<number[]>([]);
  const [source, setSource] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(false);
  // 📐 MOBILE-UI §6.7: a nyitott inline lap (keverő/master/klip-szerk.) detentje laponként;
  // a munkaterület (sávok) mért magassága a detentek alapja
  const [detentById, setDetentById] = useState<Partial<Record<AudioSheetId, Detent>>>({});
  const [rootH, setRootH] = useState(0);
  const [topBarH, setTopBarH] = useState(0);
  const [transportH, setTransportH] = useState<number | undefined>(undefined);
  const [albumSharing, setAlbumSharing] = useState(false);
  const [tlH, setTlH] = useState(0); // az idővonal-terület magassága (rács/playhead a teljes magasságot tölti)
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [snapMode, setSnapMode] = useState<SnapMode>('frame');
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recordStartPlayhead = useRef(0);
  // 🔍 pinch-zoom: a mindig friss zoom-index + a csippentés kezdő-indexe (ref, hogy a
  // gesztus-callback ne stale state-et lásson)
  const zoomIndexRef = useRef(DEFAULT_ZOOM_INDEX);
  zoomIndexRef.current = zoomIndex;
  const pinchStartRef = useRef(DEFAULT_ZOOM_INDEX);

  if (!project) {
    return null;
  }
  const fps = project.fps ?? 30;
  const bpm = project.bpm ?? DEFAULT_BPM;
  const pxPerSec = pxPerSecAt(zoomIndex);
  const duration = projectDuration(project);
  const timelineW = Math.max(320, duration * pxPerSec + 40);
  const laneAreaH = RULER_H + LANE_H * LANES.length;
  const contentH = Math.max(tlH, laneAreaH); // a rács/playhead a teljes területet tölti
  const ticks = Array.from({ length: Math.min(180, Math.ceil(timelineW / pxPerSec)) + 1 }, (_, i) => i);
  const selClip = selectedAudioClip(project, selectedClipId);
  // 🎵 beat-rács (ütem-vonalak) a BPM szerint — a látható tartományra + max 300 vonalra sapkázva
  const beatTimes = beatLines(bpm, 0, Math.min(duration + 2, (timelineW - 40) / pxPerSec)).slice(0, 300);
  const secPerBar = (60 / bpm) * 4; // 4/4 ütem hossza (a downbeat kiemeléséhez)

  const snapSecIn = (sec: number) => snapSec(sec, snapMode, fps, bpm);
  const seekAt = (e: GestureResponderEvent) =>
    useEditorStore.getState().setPlayhead(snapSecIn(Math.max(0, e.nativeEvent.locationX / pxPerSec)));

  // 🔍 kétujjas csippentés = idővonal-zoom (a 7 szint közt lépked). A pinch a
  // timelineWrap-en ül → a 2-ujjas zoom és az 1-ujjas vízszintes görgetés nem ütközik.
  const timelinePinch = Gesture.Pinch()
    .runOnJS(true)
    .onStart(() => {
      pinchStartRef.current = zoomIndexRef.current;
    })
    .onUpdate((e) => {
      const next = zoomIndexForPinch(pinchStartRef.current, e.scale, ZOOM_LEVELS.length);
      if (next !== zoomIndexRef.current) {
        setZoomIndex(next);
      }
    });

  // 🎙️ felvétel a voiceover sávra — a playheadnél kezd, a hosszt a felvevő adja
  const toggleRecord = async () => {
    if (recorderState.isRecording) {
      const seconds = Math.max(recorderState.durationMillis / 1000, 0.5);
      await recorder.stop();
      // 🔊 KRITIKUS: a felvétel az audio-módot `allowsRecording:true`-ra állította,
      // amiben iOS-en a kimenet a fülhallgató-hangszóróra megy (halk/„néma"
      // lejátszás). Felvétel UTÁN vissza kell állni lejátszó-módra, különben a
      // stúdió-lejátszás elnémul — ez volt a fő „nem működik" tünet.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      const uri = recorder.uri;
      if (uri) {
        useEditorStore.getState().addClip(
          'voiceover',
          {
            kind: 'audio',
            id: makeId('clip'),
            start: recordStartPlayhead.current,
            duration: seconds,
            trimIn: 0,
            sourceDuration: seconds,
            uri,
            label: t('panels.audio.voiceoverLabel'),
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            source: 'voiceover',
          },
          { id: makeId('ast'), kind: 'audio', uri, provider: 'local', name: t('panels.audio.voiceoverLabel'), duration: seconds }
        );
      }
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recordStartPlayhead.current = snapToFrame(playhead, fps);
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const toggleFlag = (type: TrackType, flag: 'mute' | 'solo') =>
    useEditorStore.getState().toggleTrackFlag(type, flag);

  // 🥁🔎 tempó auto-felismerés: a kiválasztott (vagy az első hang-) klip beat-rácsából (/beats) → BPM
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
        // 🥁📍 a felismert beatek vonalként az idővonalra (a klip start-jával eltolva)
        setDetectedBeats(beatsToTimelineLines(grid.beats ?? [], sourceClip?.start ?? 0, fps));
      } else {
        Alert.alert(t('studio.audio.autoBpm', { defaultValue: 'Tempó felismerése' }), t('studio.audio.autoBpmFail', { defaultValue: 'Nem sikerült tempót felismerni (fut a render-worker?).' }));
      }
    } finally {
      setBpmBusy(false);
    }
  };

  // 🎹 a piano-roll hangjegyei → worker /synth-render → sima hang-klip a music-sávon a playheadnél
  const bakeSynth = async (notes: SynthNote[], wave: SynthWave) => {
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
          label: t('studio.pianoRoll.clipLabel', { defaultValue: 'Zene' }),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'imported',
        },
        { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: t('studio.pianoRoll.clipLabel', { defaultValue: 'Zene' }), duration: res.durationSec }
      );
      setPianoRoll(false);
    } finally {
      setPianoBusy(false);
    }
  };

  // 🥁 a dob-minta ütései → worker /drums-render → sima hang-klip a music-sávon a playheadnél
  const bakeDrums = async (hits: DrumHit[], bars: number) => {
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
          label: t('studio.drums.clipLabel', { defaultValue: 'Dob' }),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
          source: 'imported',
        },
        { id: makeId('ast'), kind: 'audio', uri: res.uri, provider: 'local', name: t('studio.drums.clipLabel', { defaultValue: 'Dob' }), duration: res.durationSec }
      );
      setDrumMachine(false);
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
  const insertSource = (asset: Asset) => {
    if (asset.kind !== 'audio') {
      return;
    }
    const dur = asset.duration || 5;
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
   */
  const shareAlbum = async () => {
    const store = useEditorStore.getState();
    if (!store.project?.album || albumSharing) {
      return;
    }
    setAlbumSharing(true);
    try {
      const album0 = store.project.album;
      const originalActive = album0.activeSongId;
      for (const s of album0.songs) {
        if (s.renderedUri) {
          continue;
        }
        // váltás a számra → a project.tracks ezt tükrözi → audio-render
        store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, s.id) });
        const p = useEditorStore.getState().project!;
        const url = await exportAudioFile(p, 'aac');
        store.dispatch({
          type: 'APPLY_ALBUM',
          album: setSongRender(useEditorStore.getState().project!.album!, s.id, url, projectDuration(p)),
        });
      }
      // vissza az eredeti aktív számra
      store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, originalActive) });

      const albumProject = buildAlbumVideoProject(useEditorStore.getState().project!);
      if (!albumProject) {
        Alert.alert(t('common.error', { defaultValue: 'Hiba' }), t('studio.audio.album.needCover', { defaultValue: 'Az albumhoz borító és legalább egy renderelt szám kell.' }));
        return;
      }
      await publishRenderedProject(albumProject, undefined, { visibility: 'public' });
      Alert.alert(t('studio.audio.album.doneTitle', { defaultValue: 'Megosztva' }), t('studio.audio.album.doneBody', { defaultValue: 'Az album felkerült a feedbe.' }));
    } catch (e) {
      Alert.alert(t('common.error', { defaultValue: 'Hiba' }), (e as Error).message);
    } finally {
      setAlbumSharing(false);
    }
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
        }
      : null;

  return (
    <View style={styles.root} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <View style={styles.topBar} onLayout={(e) => setTopBarH(e.nativeEvent.layout.height)}>
        <Pressable onPress={onExit} hitSlop={10} style={styles.topBtn}>
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
        {mode === 'scoped' ? (
          <Pressable onPress={onExit} hitSlop={10} style={styles.exportBtn}>
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
      <GestureDetector gesture={timelinePinch}>
      <View style={styles.timelineWrap} onLayout={(e) => setTlH(e.nativeEvent.layout.height)}>
        <View style={styles.headers}>
          <View style={{ height: RULER_H }} />
          {LANES.map((lane) => {
            const muted = mutedTracks.includes(lane.type);
            const solo = soloTracks.includes(lane.type);
            return (
              <View key={lane.type} style={styles.laneHeader}>
                <View style={styles.laneHeadTop}>
                  <Ionicons name={lane.icon} size={13} color={lane.color} />
                  <Text style={styles.trackName} numberOfLines={1}>
                    {t(lane.labelKey)}
                  </Text>
                </View>
                <View style={styles.flagRow}>
                  <Pressable onPress={() => toggleFlag(lane.type, 'mute')} hitSlop={6}>
                    <Ionicons name={muted ? 'volume-mute' : 'volume-medium'} size={13} color={muted ? palette.danger : palette.textDim} />
                  </Pressable>
                  <Pressable onPress={() => toggleFlag(lane.type, 'solo')} hitSlop={6}>
                    <Text style={[styles.soloText, solo && { color: palette.accent }]}>S</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: timelineW, height: contentH }}>
            {/* másodperc-rács a teljes magasságon */}
            {ticks.map((i) => (
              <View
                key={`g${i}`}
                pointerEvents="none"
                style={[
                  styles.grid,
                  { left: i * pxPerSec, height: contentH, backgroundColor: i % 5 === 0 ? palette.border : `${palette.border}66` },
                ]}
              />
            ))}
            {/* 🎵 beat-rács: az ütem-kezdő (downbeat) vonalak kiemelve */}
            {beatTimes.map((sec, i) => {
              const isDownbeat = Math.abs((sec % secPerBar) ) < 1e-3 || Math.abs((sec % secPerBar) - secPerBar) < 1e-3;
              return (
                <View
                  key={`beat${i}`}
                  pointerEvents="none"
                  style={[
                    styles.beatLine,
                    { left: sec * pxPerSec, height: contentH, opacity: isDownbeat ? 0.5 : 0.22, width: isDownbeat ? 1.5 : 1 },
                  ]}
                />
              );
            })}
            {/* 🥁📍 detektált beat-vonalak (az importált zene VALÓS beatjei) */}
            {detectedBeats.map((sec, i) => (
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
            <View style={styles.ruler}>
              {ticks.map((i) =>
                i % 5 === 0 ? (
                  <Text key={`t${i}`} style={[styles.rulerLabel, { left: i * pxPerSec + 3 }]}>
                    {formatTime(i)}
                  </Text>
                ) : null
              )}
            </View>
            {/* sávok */}
            {LANES.map((lane) => {
              const track = project.tracks.find((tr) => tr.type === lane.type);
              const clips = (track?.clips ?? []).filter((c): c is AudioClip => c.kind === 'audio');
              return (
                <Pressable key={lane.type} style={[styles.lane, { backgroundColor: `${lane.color}10` }]} onPress={seekAt}>
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
                      laneH={LANE_H}
                      laneType={lane.type}
                      laneTypes={LANE_TYPES}
                      selected={clip.id === selectedClipId}
                      snap={snapSecIn}
                    />
                  ))}
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
      </View>
      </GestureDetector>

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
        <TBtn icon="chevron-back" onPress={() => useEditorStore.getState().setPlayhead(prevBeatSec(bpm, playhead))} />
        <Pressable onPress={() => useEditorStore.getState().setPlaying(!isPlaying)} style={styles.playBtn}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={24} color="#fff" />
        </Pressable>
        <TBtn icon="chevron-forward" onPress={() => useEditorStore.getState().setPlayhead(nextBeatSec(bpm, playhead))} />
        <TBtn icon="play-skip-forward" onPress={() => useEditorStore.getState().setPlayhead(duration)} />
        <View style={styles.tSep} />
        {/* loop + In/Out + range törlés */}
        <TBtn icon="repeat" active={loop} onPress={() => useEditorStore.getState().setLoop(!loop)} />
        <TBtn label="In" onPress={() => useEditorStore.getState().setRangeIn()} />
        <TBtn label="Out" onPress={() => useEditorStore.getState().setRangeOut()} />
        {rangeIn != null || rangeOut != null ? (
          <TBtn icon="close" onPress={() => useEditorStore.getState().clearRange()} />
        ) : null}
        <View style={styles.tSep} />
        {/* idő + ütem:beat */}
        <View style={styles.timeWrap}>
          <Text style={styles.time}>
            {formatTime(playhead)} / {formatTime(duration)}
          </Text>
          <Text style={styles.bars}>♪ {barsBeatsLabel(bpm, playhead)}</Text>
        </View>
        <View style={styles.tSep} />
        {/* BPM léptető + auto-felismerés (a kiválasztott/első hang-klipből) */}
        <TBtn icon="remove" onPress={() => useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: bpm - 1 })} />
        <View style={styles.bpmWrap}>
          <Text style={styles.bpmVal}>{bpm}</Text>
          <Text style={styles.bpmLabel}>BPM</Text>
        </View>
        <TBtn icon="add" onPress={() => useEditorStore.getState().dispatch({ type: 'SET_BPM', bpm: bpm + 1 })} />
        <TBtn
          icon={bpmBusy ? undefined : 'sparkles-outline'}
          label={bpmBusy ? '…' : 'Auto'}
          active={bpmBusy}
          onPress={() => void autoDetectBpm()}
        />
        <View style={styles.tSep} />
        {/* zoom + snap */}
        <TBtn icon="remove-circle-outline" onPress={() => setZoomIndex(zoomOut(zoomIndex))} />
        <TBtn icon="add-circle-outline" onPress={() => setZoomIndex(zoomIn(zoomIndex))} />
        <TBtn
          label={snapMode === 'off' ? 'Snap' : snapMode === 'frame' ? 'Frame' : 'Beat'}
          icon="magnet-outline"
          active={snapMode !== 'off'}
          onPress={() => setSnapMode(snapMode === 'off' ? 'frame' : snapMode === 'frame' ? 'beat' : 'off')}
        />
      </ScrollView>

      {/* eszköz-sor — nyitott inline lapnál rejtve (a lap fejléce a kilépés; a transport marad) */}
      {inlineSheet ? null : (
        <AudioStudioToolbar
          hasSelection={!!selClip}
          isRecording={recorderState.isRecording}
          onAdd={() => setAdding(true)}
          onRecord={toggleRecord}
          onSplit={() => selClip && useEditorStore.getState().splitClipAt(selClip.id, playhead)}
          onEdit={() => selClip && setEditing(true)}
          onDelete={() => selClip && useEditorStore.getState().removeClip(selClip.id)}
          onMixer={() => setMixerOpen(true)}
        />
      )}

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
        setPianoRoll={setPianoRoll}
        setDrumMachine={setDrumMachine}
        setSampler={setSampler}
        setSource={setSource}
        setAlbumOpen={setAlbumOpen}
        onBakeSynth={(notes, wave) => void bakeSynth(notes, wave)}
        onBakeDrums={(hits, bars) => void bakeDrums(hits, bars)}
        onBakeSampler={(uri, pattern, bars) => void bakeSampler(uri, pattern, bars)}
        onInsertSource={insertSource}
        onShareAlbum={() => void shareAlbum()}
        frame={sheetFrame}
      />
    </View>
  );
}

/** Kompakt transport-gomb (ikon és/vagy rövid címke; aktív/tiltott állapot). */
function TBtn({
  icon,
  label,
  onPress,
  disabled,
  active,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const color = disabled ? palette.border : active ? palette.accent : palette.text;
  return (
    <Pressable
      style={[styles.tBtn, active && styles.tBtnActive]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
    >
      {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      {label ? <Text style={[styles.tBtnLabel, { color }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
