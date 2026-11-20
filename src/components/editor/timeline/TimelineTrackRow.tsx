import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TimelineClip } from '@/components/editor/TimelineClip';
import { palette, trackColors } from '@/constants/editor';
import { videoTrackGaps } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { Track, TrackType } from '@/types/project';

/**
 * 🎬 Egy sáv sora az idővonalon: a (virtualizált) klipek, a fő videósáv
 * hézag-jelzői és a borotva-réteg.
 */
export function TimelineTrackRow({
  type,
  track,
  height,
  pps,
  clipVisible,
  selectedClipId,
  multiSelectIds,
  collapsed,
  locked,
  razorMode,
  onRazorCut,
}: {
  type: TrackType;
  track: Track | undefined;
  height: number;
  pps: number;
  clipVisible: (c: { id: string; start: number; duration: number }) => boolean;
  selectedClipId: string | null;
  multiSelectIds: string[];
  collapsed: boolean;
  locked: boolean;
  razorMode: boolean;
  onRazorCut: (type: TrackType, time: number) => void;
}) {
  const { t } = useTranslation();
  const closeGapBefore = useEditorStore((s) => s.closeGapBefore);

  return (
    <View
      style={[
        styles.trackRow,
        // halvány, sáv-színű "lane" háttér (látványterv szerint)
        {
          height,
          backgroundColor: `${trackColors[type]}0d`,
        },
      ]}
    >
      {track && !collapsed
        ? track.clips.filter(clipVisible).map((clip) => (
            <TimelineClip
              key={clip.id}
              clip={clip}
              trackType={type}
              pps={pps}
              height={height}
              selected={clip.id === selectedClipId}
              multiSelected={multiSelectIds.includes(clip.id)}
            />
          ))
        : null}
      {/* ⚠️ hézag-jelző a fő videósávon: koppintásra bezárul (visszavonható) */}
      {type === 'video' && track && !collapsed
        ? videoTrackGaps(track.clips).map((g, i) => (
            <Pressable
              key={`gap-${i}`}
              hitSlop={6}
              onPress={() => closeGapBefore(g.nextId)}
              accessibilityRole="button"
              accessibilityLabel={t('editor.timeline.gapRemove', {
                seconds: (g.end - g.start).toFixed(1),
              })}
              style={[
                styles.gap,
                { left: g.start * pps, width: (g.end - g.start) * pps, height },
              ]}
            >
              <Ionicons name="warning" size={11} color={palette.danger} />
              {(g.end - g.start) * pps > 46 ? (
                <Text style={styles.gapText}>{(g.end - g.start).toFixed(1)}s</Text>
              ) : null}
            </Pressable>
          ))
        : null}
      {/* ✂️ borotva-réteg: koppintásra elvágja a lefedő klipet ezen a sávon */}
      {razorMode && !collapsed && !locked ? (
        <Pressable
          style={styles.razorLayer}
          onPress={(e) => onRazorCut(type, e.nativeEvent.locationX / pps)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trackRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  gap: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: '#ff5c7222',
    borderWidth: 1,
    borderColor: '#ff5c7266',
    borderStyle: 'dashed',
    borderRadius: 4,
  },
  gapText: {
    color: palette.danger,
    fontSize: 9,
    fontWeight: '700',
  },
  razorLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
