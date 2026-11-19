import { useTranslation } from 'react-i18next';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { AudioMarkerFlags } from '@/components/studio/audio/AudioMarkerFlags';
import { AudioTimelineClip } from '@/components/studio/audio/AudioTimelineClip';
import type { AudioLane } from '@/components/studio/audio/audioLanes';
import { LANE_H, RULER_H } from '@/components/studio/audio/body/timelineMetrics';
import { CrossfadeMarks } from '@/components/studio/audio/CrossfadeMarks';
import { ClipMarkers } from '@/components/studio/audio/LaneMeter';
import { SilenceMarks } from '@/components/studio/audio/SilenceReview';
import { SpeechCutMarks } from '@/components/studio/audio/SpeechEditBar';
import { palette } from '@/constants/editor';
import { scrubTime } from '@/lib/audioTransport';
import { formatTime } from '@/lib/time';
import type { AudioEditMode } from '@/store/audioEditModeStore';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project, TrackType } from '@/types/project';

/**
 * 🎚️ Az idővonal görgethető tartalma: másodperc- és beat-rács, a detektált beatek, a loop-régió árnyéka, a
 * vonalzó (húzva scrub), a markerek, a sávok a klipjeikkel és a lejátszófej.
 */
export function AudioTimelineContent({
  tracks,
  lanes,
  laneTypes,
  laneH,
  timelineW,
  contentH,
  pxPerSec,
  duration,
  playhead,
  ticks,
  beatTimes,
  detectedLines,
  rangeIn,
  rangeOut,
  editMode,
  selectedClipId,
  multiSelectIds,
  snap,
  onSeek,
}: {
  tracks: Project['tracks'];
  lanes: AudioLane[];
  laneTypes: TrackType[];
  laneH: number;
  timelineW: number;
  contentH: number;
  pxPerSec: number;
  duration: number;
  playhead: number;
  ticks: { sec: number; major: boolean }[];
  beatTimes: { sec: number; downbeat: boolean }[];
  detectedLines: number[];
  rangeIn: number | null;
  rangeOut: number | null;
  editMode: AudioEditMode;
  selectedClipId: string | null;
  multiSelectIds: string[];
  snap: (sec: number) => number;
  onSeek: (e: GestureResponderEvent) => void;
}) {
  const { t } = useTranslation();
  // ↔️ scrub: a vonalzón húzva a lejátszófej követi az ujjat
  const rulerScrub = Gesture.Pan()
    .runOnJS(true)
    .withTestId('audio-ruler-scrub')
    .minDistance(0)
    .onBegin((e) => useEditorStore.getState().setPlayhead(scrubTime(e.x, pxPerSec, duration)))
    .onUpdate((e) => useEditorStore.getState().setPlayhead(scrubTime(e.x, pxPerSec, duration)));
  return (
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
      {lanes.map((lane) => {
        const track = tracks.find((tr) => tr.type === lane.type);
        const clips = (track?.clips ?? []).filter((c): c is AudioClip => c.kind === 'audio');
        return (
          <Pressable key={lane.type} style={[styles.lane, { height: laneH, backgroundColor: `${lane.color}10` }]} onPress={onSeek}>
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
                laneTypes={laneTypes}
                selected={clip.id === selectedClipId}
                multiSelected={multiSelectIds.includes(clip.id)}
                snap={snap}
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
  );
}

const styles = StyleSheet.create({
  lane: { height: LANE_H, borderBottomWidth: 1, borderBottomColor: palette.border, justifyContent: 'center' },
  laneEmpty: { color: `${palette.textDim}55`, fontSize: 11, fontWeight: '800', paddingLeft: 10, textTransform: 'uppercase', letterSpacing: 1.5 },
  grid: { position: 'absolute', top: 0, width: 1 },
  beatLine: { position: 'absolute', top: 0, backgroundColor: palette.accent },
  detectedBeat: { position: 'absolute', top: 0, width: 1.5, backgroundColor: palette.accent2, opacity: 0.55 },
  loopShade: { position: 'absolute', top: 0, backgroundColor: `${palette.accent}1f`, borderLeftWidth: 1, borderRightWidth: 1, borderColor: `${palette.accent}88` },
  ruler: { height: RULER_H, borderBottomWidth: 1, borderBottomColor: palette.border },
  rulerLabel: { position: 'absolute', top: 5, color: palette.textDim, fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', top: 0, width: 2, backgroundColor: '#fff' },
  phBubble: { position: 'absolute', top: 2, backgroundColor: palette.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  phBubbleText: { color: '#fff', fontSize: 9, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
