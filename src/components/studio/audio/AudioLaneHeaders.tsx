import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { laneLabel, type AudioLane } from '@/components/studio/audio/audioLanes';
import { HEADER_W, LANE_H, RULER_H } from '@/components/studio/audio/body/timelineMetrics';
import { LaneMeter } from '@/components/studio/audio/LaneMeter';
import { palette } from '@/constants/editor';
import type { TrackType } from '@/types/project';

/**
 * 🎚️ A sávok fejléc-oszlopa (az idővonal bal oldalán): név, némítás / szóló / zár, szintmérő; a hozzáadott sáv
 * hosszan nyomva a műveleteit nyitja; alul a „+ Sáv” (ha még van szabad hely).
 */
export function AudioLaneHeaders({
  lanes,
  laneH,
  mutedTracks,
  soloTracks,
  lockedTracks,
  canAddLane,
  onToggleFlag,
  onLaneActions,
  onAddLane,
}: {
  lanes: AudioLane[];
  laneH: number;
  mutedTracks: TrackType[];
  soloTracks: TrackType[];
  lockedTracks: TrackType[];
  canAddLane: boolean;
  onToggleFlag: (type: TrackType, flag: 'mute' | 'solo' | 'lock') => void;
  onLaneActions: (lane: AudioLane) => void;
  onAddLane: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.headers}>
      <View style={{ height: RULER_H }} />
      {lanes.map((lane) => {
        const muted = mutedTracks.includes(lane.type);
        const solo = soloTracks.includes(lane.type);
        return (
          <Pressable
            key={lane.type}
            style={[styles.laneHeader, { height: laneH }]}
            testID={`audio-lane-head-${lane.type}`}
            disabled={!lane.extra}
            onLongPress={() => onLaneActions(lane)}
          >
            <View style={styles.laneHeadTop}>
              <Ionicons name={lane.icon} size={13} color={lane.color} />
              <Text style={styles.trackName} numberOfLines={1}>
                {laneLabel(lane, t)}
              </Text>
            </View>
            <View style={styles.flagRow}>
              <Pressable onPress={() => onToggleFlag(lane.type, 'mute')} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: muted }} accessibilityLabel={t('studio.audio.a11y.muteTrack', { track: laneLabel(lane, t) })}>
                <Ionicons name={muted ? 'volume-mute' : 'volume-medium'} size={13} color={muted ? palette.danger : palette.textDim} />
              </Pressable>
              <Pressable onPress={() => onToggleFlag(lane.type, 'solo')} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: solo }} accessibilityLabel={t('studio.audio.a11y.soloTrack', { track: laneLabel(lane, t) })}>
                <Text style={[styles.soloText, solo && { color: palette.accent }]}>S</Text>
              </Pressable>
              {/* 🔒 A47: a videó-szerkesztőben zárolt sáv itt is látszik, és itt is feloldható */}
              <Pressable
                onPress={() => onToggleFlag(lane.type, 'lock')}
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
      {canAddLane ? (
        <Pressable style={styles.addLane} onPress={onAddLane} testID="audio-add-lane">
          <Ionicons name="add" size={14} color={palette.textDim} />
          <Text style={styles.addLaneText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>{t('studio.audio.lanes.add')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  addLane: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  addLaneText: { color: palette.textDim, fontSize: 12, fontWeight: '700' },
  headers: { width: HEADER_W, borderRightWidth: 1, borderRightColor: palette.border, backgroundColor: palette.surface },
  laneHeader: { height: LANE_H, alignItems: 'center', justifyContent: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: palette.border },
  laneHeadTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackName: { color: palette.textDim, fontSize: 9, fontWeight: '800', maxWidth: HEADER_W - 16, textTransform: 'uppercase', letterSpacing: 0.4 },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  soloText: { color: palette.textDim, fontSize: 12, fontWeight: '900' },
});
