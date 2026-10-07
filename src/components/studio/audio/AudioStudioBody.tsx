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
import { Alert, type GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SourceSheet } from '@/components/SourceSheet';
import { ClipWaveform } from '@/components/editor/ClipWaveform';
import { AddMediaSheet } from '@/components/studio/audio/AddMediaSheet';
import { ClipEditSheet, selectedAudioClip } from '@/components/studio/audio/ClipEditSheet';
import { MasterSheet } from '@/components/studio/audio/MasterSheet';
import { TtsSheet } from '@/components/studio/audio/TtsSheet';
import { palette } from '@/constants/editor';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, AudioClip, TrackType } from '@/types/project';

const PX_PER_SEC = 56;
const LANE_H = 70;
const RULER_H = 24;
const HEADER_W = 62;

const LANES: { type: TrackType; icon: keyof typeof Ionicons.glyphMap; color: string; labelKey: string }[] = [
  { type: 'music', icon: 'musical-notes', color: palette.accent, labelKey: 'editor.track.music' },
  { type: 'voiceover', icon: 'mic', color: palette.accent2, labelKey: 'editor.track.voiceover' },
  { type: 'sfx', icon: 'flash', color: '#39d98a', labelKey: 'editor.track.sfx' },
];

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
  const [editing, setEditing] = useState(false);
  const [mastering, setMastering] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tts, setTts] = useState(false);
  const [source, setSource] = useState(false);
  const [tlH, setTlH] = useState(0); // az idővonal-terület magassága (rács/playhead a teljes magasságot tölti)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recordStartPlayhead = useRef(0);

  if (!project) {
    return null;
  }
  const fps = project.fps ?? 30;
  const duration = projectDuration(project);
  const timelineW = Math.max(320, duration * PX_PER_SEC + 40);
  const laneAreaH = RULER_H + LANE_H * LANES.length;
  const contentH = Math.max(tlH, laneAreaH); // a rács/playhead a teljes területet tölti
  const ticks = Array.from({ length: Math.min(180, Math.ceil(timelineW / PX_PER_SEC)) + 1 }, (_, i) => i);
  const selClip = selectedAudioClip(project, selectedClipId);

  const seekAt = (e: GestureResponderEvent) =>
    useEditorStore.getState().setPlayhead(snapToFrame(Math.max(0, e.nativeEvent.locationX / PX_PER_SEC), fps));

  // 🎙️ felvétel a voiceover sávra — a playheadnél kezd, a hosszt a felvevő adja
  const toggleRecord = async () => {
    if (recorderState.isRecording) {
      const seconds = Math.max(recorderState.durationMillis / 1000, 0.5);
      await recorder.stop();
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

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
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
                  { left: i * PX_PER_SEC, height: contentH, backgroundColor: i % 5 === 0 ? palette.border : `${palette.border}66` },
                ]}
              />
            ))}
            {/* idővonalzó (timecode) */}
            <View style={styles.ruler}>
              {ticks.map((i) =>
                i % 5 === 0 ? (
                  <Text key={`t${i}`} style={[styles.rulerLabel, { left: i * PX_PER_SEC + 3 }]}>
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
                  {clips.map((clip) => {
                    const left = clip.start * PX_PER_SEC;
                    const w = Math.max(20, clip.duration * PX_PER_SEC);
                    const sel = clip.id === selectedClipId;
                    return (
                      <Pressable
                        key={clip.id}
                        onPress={() => {
                          useEditorStore.getState().selectClip(clip.id);
                          useEditorStore.getState().setPlayhead(clip.start);
                        }}
                        style={[styles.clip, { left, width: w, borderColor: sel ? '#fff' : `${lane.color}99` }]}
                      >
                        <View style={[styles.clipFill, { backgroundColor: `${lane.color}26` }]}>
                          <ClipWaveform clip={clip} widthPx={w} heightPx={LANE_H - 22} color={lane.color} />
                        </View>
                        <Text style={styles.clipLabel} numberOfLines={1}>
                          {clip.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Pressable>
              );
            })}
            {/* playhead a teljes magasságon + idő-buborék */}
            <View pointerEvents="none" style={[styles.playhead, { left: playhead * PX_PER_SEC, height: contentH }]} />
            <View pointerEvents="none" style={[styles.phBubble, { left: playhead * PX_PER_SEC - 21 }]}>
              <Text style={styles.phBubbleText}>{formatTime(playhead)}</Text>
            </View>
          </View>
        </ScrollView>
      </View>

      {/* transport */}
      <View style={styles.transport}>
        <Pressable onPress={() => useEditorStore.getState().setPlaying(!isPlaying)} style={styles.playBtn}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color="#fff" />
        </Pressable>
        <Text style={styles.time}>
          {formatTime(playhead)} / {formatTime(duration)}
        </Text>
      </View>

      {/* eszköz-sor */}
      <View style={styles.toolBar}>
        <Tool icon="add-circle-outline" label={t('studio.audioTools.add')} onPress={() => setAdding(true)} />
        <Tool
          icon={recorderState.isRecording ? 'stop-circle' : 'mic-outline'}
          label={t('studio.audioTools.record')}
          onPress={toggleRecord}
          danger={recorderState.isRecording}
        />
        <Tool icon="cut-outline" label={t('studio.audioTools.split')} onPress={() => selClip && useEditorStore.getState().splitClipAt(selClip.id, playhead)} disabled={!selClip} />
        <Tool icon="options-outline" label={t('studio.audioTools.edit')} onPress={() => selClip && setEditing(true)} disabled={!selClip} />
        <Tool icon="trash-outline" label={t('studio.audioTools.delete')} onPress={() => selClip && useEditorStore.getState().removeClip(selClip.id)} disabled={!selClip} danger />
        <Tool icon="pulse-outline" label={t('studio.audioTools.master')} onPress={() => setMastering(true)} />
      </View>

      {editing && selClip ? <ClipEditSheet clip={selClip} fps={fps} onClose={() => setEditing(false)} /> : null}
      {mastering ? <MasterSheet onClose={() => setMastering(false)} /> : null}
      {adding ? (
        <AddMediaSheet
          track="music"
          onClose={() => setAdding(false)}
          onTts={() => {
            setAdding(false);
            setTts(true);
          }}
        />
      ) : null}
      {tts ? <TtsSheet onClose={() => setTts(false)} /> : null}
      {source ? <SourceSheet onInsert={insertSource} onClose={() => setSource(false)} /> : null}
    </View>
  );
}

function Tool({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
  return (
    <Pressable style={styles.tool} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topBtn: { padding: 2 },
  srcBtn: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: palette.surface,
  },
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
  ruler: { height: RULER_H, borderBottomWidth: 1, borderBottomColor: palette.border },
  rulerLabel: { position: 'absolute', top: 5, color: palette.textDim, fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clip: { position: 'absolute', top: 6, bottom: 6, borderRadius: 8, borderWidth: 1.5, overflow: 'hidden', justifyContent: 'center' },
  clipFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clipLabel: { color: palette.text, fontSize: 10, fontWeight: '700', paddingHorizontal: 6 },
  playhead: { position: 'absolute', top: 0, width: 2, backgroundColor: '#fff' },
  phBubble: { position: 'absolute', top: 2, backgroundColor: palette.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  phBubbleText: { color: '#fff', fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  time: { color: palette.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  toolBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, paddingTop: 10, paddingBottom: 6 },
  tool: { flex: 1, alignItems: 'center', gap: 4 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
});
