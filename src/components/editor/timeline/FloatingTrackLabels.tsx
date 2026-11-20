import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, trackColors, trackLabels } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { AUDIBLE_TRACKS, RULER_HEIGHT, VISUAL_TRACKS } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';
import { openTrackMenu } from './timelineMenus';

/**
 * 🏷️ sáv-címkék (nem görgetődnek) — telefonon, fejléc-oszlop nélkül: a címke
 * koppintása nyitja a sáv-menüt, mellette a közvetlen némítás/szem + zár gombok.
 */
export function FloatingTrackLabels({
  visibleTracks,
  th,
}: {
  visibleTracks: TrackType[];
  th: (t: TrackType) => number;
}) {
  const { t } = useTranslation();
  const L = useLayout();
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const collapsedTracks = useEditorStore((s) => s.collapsedTracks);
  const hiddenTracks = useEditorStore((s) => s.hiddenTracks);
  const autoTrackHeight = useEditorStore((s) => s.autoTrackHeight);
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);
  const cycleTrackHeight = useEditorStore((s) => s.cycleTrackHeight);
  const toggleAutoTrackHeight = useEditorStore((s) => s.toggleAutoTrackHeight);

  return (
    <View pointerEvents="box-none" style={styles.trackLabels}>
      <View pointerEvents="none" style={{ height: RULER_HEIGHT }} />
      {visibleTracks.map((type) => (
        <View
          key={type}
          pointerEvents="box-none"
          style={[styles.trackLabelRow, { height: th(type) }]}
        >
          <View style={styles.trackLabelGroup} pointerEvents="box-none">
            <Pressable
              hitSlop={6}
              onPress={() =>
                openTrackMenu(t, type, {
                  mutedTracks,
                  soloTracks,
                  lockedTracks,
                  collapsedTracks,
                  hiddenTracks,
                  autoTrackHeight,
                  toggleTrackFlag,
                  cycleTrackHeight,
                  toggleAutoTrackHeight,
                })
              }
              style={[styles.trackLabelChip, { borderColor: trackColors[type] }]}
              accessibilityRole="button"
              accessibilityLabel={t(trackLabels[type])}
              accessibilityHint={t('editor.timeline.trackMenuMessage')}
            >
              <Text style={[styles.trackLabelText, { color: trackColors[type], fontSize: L.font(10) }]}>
                {t(trackLabels[type])}
              </Text>
              {soloTracks.includes(type) ? <Ionicons name="star" size={10} color={palette.accent} /> : null}
              {collapsedTracks.includes(type) ? (
                <Ionicons name="chevron-expand" size={10} color={palette.textDim} />
              ) : null}
            </Pressable>
            {/* 🔇/👁️ + 🔒 közvetlenül látható, érinthető sáv-vezérlők (D7) — a ritkábbak
                (szóló, összecsukás, magasság) a címke-menüben maradnak */}
            {AUDIBLE_TRACKS.includes(type) ? (
              <Pressable
                hitSlop={8}
                onPress={() => toggleTrackFlag(type, 'mute')}
                style={styles.trackIconBtn}
                accessibilityRole="button"
                accessibilityLabel={mutedTracks.includes(type) ? t('editor.timeline.unmute') : t('editor.timeline.mute')}
              >
                <Ionicons
                  name={mutedTracks.includes(type) ? 'volume-mute' : 'volume-medium-outline'}
                  size={13}
                  color={mutedTracks.includes(type) ? palette.accent2 : palette.textDim}
                />
              </Pressable>
            ) : VISUAL_TRACKS.includes(type) ? (
              <Pressable
                hitSlop={8}
                onPress={() => toggleTrackFlag(type, 'hidden')}
                style={styles.trackIconBtn}
                accessibilityRole="button"
                accessibilityLabel={hiddenTracks.includes(type) ? t('editor.timeline.show') : t('editor.timeline.hide')}
              >
                <Ionicons
                  name={hiddenTracks.includes(type) ? 'eye-off-outline' : 'eye-outline'}
                  size={13}
                  color={hiddenTracks.includes(type) ? palette.accent2 : palette.textDim}
                />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={8}
              onPress={() => toggleTrackFlag(type, 'lock')}
              style={styles.trackIconBtn}
              accessibilityRole="button"
              accessibilityLabel={lockedTracks.includes(type) ? t('editor.timeline.unlock') : t('editor.timeline.lock')}
            >
              <Ionicons
                name={lockedTracks.includes(type) ? 'lock-closed' : 'lock-open-outline'}
                size={13}
                color={lockedTracks.includes(type) ? palette.accent2 : palette.textDim}
              />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  trackLabels: {
    position: 'absolute',
    left: 6,
    top: 0,
  },
  trackLabelRow: {
    justifyContent: 'center',
  },
  trackLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: `${palette.bg}cc`,
  },
  trackLabelText: {
    fontWeight: '700',
  },
  trackLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trackIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.bg}cc`,
  },
});
