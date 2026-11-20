import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, trackColors, trackLabels } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { AUDIBLE_TRACKS, RULER_HEIGHT, VISUAL_TRACKS } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';

/** sáv-ikonok a tablet-fejléchez (látványterv: ikon + címke oszlop) */
const trackIcons: Record<TrackType, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  pip: 'albums',
  adjust: 'color-filter',
  text: 'text',
  captions: 'chatbox-ellipses',
  overlay: 'happy',
  interactive: 'sparkles',
  music: 'musical-notes',
  voiceover: 'mic',
  sfx: 'volume-high',
  aux1: 'musical-note',
  aux2: 'musical-note',
  aux3: 'musical-note',
  aux4: 'musical-note',
  aux5: 'musical-note',
};

/**
 * 🖥️ tablet/széles kijelző: fix fejléc-oszlop ikon+címkével a sávok elején
 * (némítás / szóló / láthatóság / zárolás ikongombokkal).
 */
export function TrackHeaderColumn({
  visibleTracks,
  th,
}: {
  visibleTracks: TrackType[];
  th: (t: TrackType) => number;
}) {
  const { t } = useTranslation();
  const L = useLayout();
  // 🎚️ sáv-monitorozás (előnézet-szintű) + 🔒 zárolás + 👁️ láthatóság
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const hiddenTracks = useEditorStore((s) => s.hiddenTracks);
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);

  return (
    <View style={[styles.headerCol, { width: L.editor.trackHeaderWidth }]}>
      <View style={{ height: RULER_HEIGHT }} />
      {visibleTracks.map((type) => (
        <View
          key={type}
          style={[styles.headerRow, { height: th(type) }]}
        >
          <Ionicons name={trackIcons[type]} size={L.isExpanded ? 16 : 13} color={trackColors[type]} />
          <Text
            style={[styles.headerText, { color: trackColors[type], fontSize: L.font(10) }]}
            numberOfLines={1}
          >
            {t(trackLabels[type])}
          </Text>
          <View style={styles.headerBtns}>
            {AUDIBLE_TRACKS.includes(type) ? (
              <>
                <Pressable
                  hitSlop={6}
                  onPress={() => toggleTrackFlag(type, 'mute')}
                  style={styles.headerBtn}
                >
                  <Ionicons
                    name={mutedTracks.includes(type) ? 'volume-mute' : 'volume-medium-outline'}
                    size={12}
                    color={mutedTracks.includes(type) ? palette.accent2 : palette.textDim}
                  />
                </Pressable>
                <Pressable
                  hitSlop={6}
                  onPress={() => toggleTrackFlag(type, 'solo')}
                  style={styles.headerBtn}
                >
                  <Ionicons
                    name={soloTracks.includes(type) ? 'star' : 'star-outline'}
                    size={12}
                    color={soloTracks.includes(type) ? palette.accent : palette.textDim}
                  />
                </Pressable>
              </>
            ) : null}
            {VISUAL_TRACKS.includes(type) ? (
              <Pressable
                hitSlop={6}
                onPress={() => toggleTrackFlag(type, 'hidden')}
                style={styles.headerBtn}
              >
                <Ionicons
                  name={hiddenTracks.includes(type) ? 'eye-off-outline' : 'eye-outline'}
                  size={12}
                  color={hiddenTracks.includes(type) ? palette.accent2 : palette.textDim}
                />
              </Pressable>
            ) : null}
            <Pressable
              hitSlop={6}
              onPress={() => toggleTrackFlag(type, 'lock')}
              style={styles.headerBtn}
            >
              <Ionicons
                name={lockedTracks.includes(type) ? 'lock-closed' : 'lock-open-outline'}
                size={12}
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
  headerCol: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    // a sávokkal azonos elválasztó, hogy a fejléc-sorok pixelre igazodjanak
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  headerText: {
    fontWeight: '700',
    flexShrink: 1,
  },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  headerBtn: {
    padding: 2,
  },
});
