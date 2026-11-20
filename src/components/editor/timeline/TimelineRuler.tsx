import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatRuler } from '@/lib/time';
import { RULER_HEIGHT, rulerMarksFor } from '@/lib/timelineLayout';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';
import { openMarkerMenu, openRangeMenu } from './timelineMenus';

/**
 * 📏 Az idővonal vonalzója: időosztások, beat-pontok, régiók, jelölő-zászlók és a
 * tartomány-kijelölés. A teljes-magas sávok a vonalzóból lógnak le a sávokra.
 */
export function TimelineRuler({
  project,
  pps,
  duration,
  totalTracksHeight,
}: {
  project: Project;
  pps: number;
  duration: number;
  totalTracksHeight: number;
}) {
  const { t } = useTranslation();
  // beat-rács a zenesáv első klipjéből — jelölők a vonalzón + snap-célpontok
  const beatTimes = useEditorStore((s) => s.beatTimes);
  const downbeatTimes = useEditorStore((s) => s.downbeatTimes);
  const removeRegion = useEditorStore((s) => s.removeRegion);
  const recolorRegion = useEditorStore((s) => s.recolorRegion);
  // 🅸🅾 tartomány-kijelölés
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const clearRange = useEditorStore((s) => s.clearRange);
  const deleteRange = useEditorStore((s) => s.deleteRange);
  const regionFromRange = useEditorStore((s) => s.regionFromRange);

  const rulerMarks = rulerMarksFor(duration, pps);

  return (
    <View style={styles.ruler}>
      {rulerMarks.map((t) => (
        <View key={t} style={[styles.rulerMark, { left: t * pps }]}>
          <View style={styles.tick} />
          <Text style={styles.rulerText}>{formatRuler(t)}</Text>
        </View>
      ))}
      {/* beat-jelölők: pötty minden beatre, erősebb a downbeatre */}
      {beatTimes.map((t) => (
        <View key={`b${t}`} style={[styles.beatDot, { left: t * pps - 1.5 }]} />
      ))}
      {downbeatTimes.map((t) => (
        <View key={`d${t}`} style={[styles.downbeatDot, { left: t * pps - 2 }]} />
      ))}
      {/* 🏷️ régiók: halvány, teljes-magas sáv (a klipek mögött, nem fog gesztust) */}
      {(project.regions ?? []).map((r) => (
        <View
          key={`rb-${r.id}`}
          pointerEvents="none"
          style={[
            styles.regionBand,
            {
              left: r.start * pps,
              width: Math.max(2, (r.end - r.start) * pps),
              height: RULER_HEIGHT + totalTracksHeight,
              backgroundColor: `${r.color}1f`,
              borderColor: r.color,
            },
          ]}
        />
      ))}
      {/* régió-címkék a tetején: tap = ugrás, hosszú-nyomás = átszínez/törlés */}
      {(project.regions ?? []).map((r) => (
        <Pressable
          key={`rl-${r.id}`}
          hitSlop={6}
          onPress={() => useEditorStore.getState().setPlayhead(r.start)}
          onLongPress={() =>
            Alert.alert(r.label, t('editor.regions.menuMessage'), [
              { text: t('editor.regions.recolor'), onPress: () => recolorRegion(r.id) },
              { text: t('common.delete'), style: 'destructive', onPress: () => removeRegion(r.id) },
              { text: t('common.cancel'), style: 'cancel' },
            ])
          }
          style={[styles.regionLabel, { left: r.start * pps, borderColor: r.color, backgroundColor: `${r.color}33` }]}
        >
          <Text style={styles.regionLabelText} numberOfLines={1}>
            {r.label}
          </Text>
        </Pressable>
      ))}
      {/* 🔖 szerkezeti jelölők: zászló + felirat, koppintásra odaugrik, hosszú nyomásra menü */}
      {(project.markers ?? []).map((m) => (
        <Pressable
          key={m.id}
          hitSlop={8}
          onPress={() => useEditorStore.getState().setPlayhead(m.time)}
          onLongPress={() => openMarkerMenu(t, m.id)}
          style={[styles.markerFlag, { left: m.time * pps }]}
        >
          <View style={[styles.markerStem, m.color ? { backgroundColor: m.color } : null]} />
          <Text
            style={[styles.markerText, m.color ? { color: m.color } : null]}
            numberOfLines={1}
          >
            {m.label}
          </Text>
          {/* 📝 jegyzet-jelző pötty */}
          {m.note ? (
            <View style={[styles.markerNoteDot, m.color ? { backgroundColor: m.color } : null]} />
          ) : null}
        </Pressable>
      ))}
      {/* 🅸🅾 tartomány-kijelölés: teljes-magas sáv + kezdet/vég vonal + fogantyú-chip */}
      {rangeIn != null ? (
        <View
          pointerEvents="none"
          style={[styles.rangeEdge, { left: rangeIn * pps, height: RULER_HEIGHT + totalTracksHeight }]}
        />
      ) : null}
      {rangeOut != null ? (
        <View
          pointerEvents="none"
          style={[styles.rangeEdge, { left: rangeOut * pps, height: RULER_HEIGHT + totalTracksHeight }]}
        />
      ) : null}
      {rangeIn != null && rangeOut != null && rangeOut > rangeIn ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.rangeBand,
              {
                left: rangeIn * pps,
                width: (rangeOut - rangeIn) * pps,
                height: RULER_HEIGHT + totalTracksHeight,
              },
            ]}
          />
          <Pressable
            hitSlop={6}
            onPress={() => openRangeMenu(t, { regionFromRange, deleteRange, clearRange })}
            style={[styles.rangeChip, { left: rangeIn * pps }]}
          >
            <Ionicons name="scan-outline" size={10} color={palette.accent} />
            <Text style={styles.rangeChipText}>{(rangeOut - rangeIn).toFixed(1)}s</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: {
    height: RULER_HEIGHT,
  },
  rulerMark: {
    position: 'absolute',
    top: 0,
    alignItems: 'flex-start',
  },
  tick: {
    width: 1,
    height: 6,
    backgroundColor: palette.textDim,
  },
  rulerText: {
    color: palette.textDim,
    fontSize: 9,
    marginTop: 1,
  },
  regionBand: {
    position: 'absolute',
    top: 0,
    borderLeftWidth: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  regionLabel: {
    position: 'absolute',
    top: 1,
    maxWidth: 130,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  regionLabelText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
  },
  rangeEdge: {
    position: 'absolute',
    top: 0,
    width: 1.5,
    marginLeft: -0.75,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
  rangeBand: {
    position: 'absolute',
    top: 0,
    backgroundColor: `${palette.accent}22`,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: palette.accent,
  },
  rangeChip: {
    position: 'absolute',
    top: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.accent,
    backgroundColor: `${palette.accent}33`,
  },
  rangeChipText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  markerNoteDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.accent2,
  },
  markerFlag: {
    position: 'absolute',
    top: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 110,
  },
  markerStem: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: palette.accent2,
  },
  markerText: {
    color: palette.accent2,
    fontSize: 9,
    fontWeight: '700',
    flexShrink: 1,
  },
  beatDot: {
    position: 'absolute',
    bottom: 1,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: `${palette.accent2}aa`,
  },
  downbeatDot: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: 6,
    borderRadius: 2,
    backgroundColor: palette.accent2,
  },
});
