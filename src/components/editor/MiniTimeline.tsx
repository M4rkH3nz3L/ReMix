import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TimelineMinimap } from '@/components/editor/TimelineMinimap';
import { BASE_PX_PER_SEC, palette } from '@/constants/editor';
import { formatTimecode, projectFps } from '@/lib/frames';
import { PANEL_METRICS } from '@/lib/panelLayout';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🎞️ Mini-idővonal (MOBILE-UI §6.5) — az idővonal összecsukott, 44 pt-os alakja,
 * amíg egy Sheet `half`/`full` detenten nyitva van.
 *
 * MIÉRT: telefonon eddig a nyitott panel KIVÁLTOTTA az idővonalat — a felhasználó
 * nem látta, hol tart és mit szerkeszt. Itt végig látszik a timecode, a teljes
 * projekt térképe a kijelölt klip keretével, és a lejátszófej húzással
 * mozgatható. A ⌃ gomb a lapot `peek`-re engedi → a teljes idővonal visszajön
 * (a playhead és a zoom a store-ban él, így pontosan ugyanott folytatódik).
 */
export function MiniTimeline({ onExpand }: { onExpand?: () => void } = {}) {
  const { t } = useTranslation();
  const playhead = useEditorStore((s) => s.playhead);
  const fps = useEditorStore((s) => projectFps(s.project));
  const zoom = useEditorStore((s) => s.zoom);
  const setPanelDetent = useEditorStore((s) => s.setPanelDetent);
  const [w, setW] = useState(0);

  return (
    <View style={styles.row} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Text style={styles.time}>{formatTimecode(playhead, fps)}</Text>
      <TimelineMinimap viewportW={w} pps={BASE_PX_PER_SEC * zoom} showSelection style={styles.map} />
      <Pressable
        onPress={onExpand ?? (() => setPanelDetent('peek'))}
        hitSlop={8}
        style={styles.expand}
        accessibilityRole="button"
        accessibilityLabel={t('editor.panelHost.showTimeline')}
      >
        <Ionicons name="chevron-up" size={16} color={palette.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: PANEL_METRICS.timelineMini,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  time: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginRight: 2,
  },
  map: { flex: 1, marginBottom: 0 },
  expand: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
