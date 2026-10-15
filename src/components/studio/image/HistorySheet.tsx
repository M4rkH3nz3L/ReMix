import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🕓 Előzmények-panel (history) — a command-bus undo-verme VIZUÁLISAN: a lépések
 * ember-olvasható címkékkel (a parancs `label`-je vagy `describeCommand`), a
 * jelenlegi állapot kiemelve, és bármely lépésre KOPPINTVA oda ugorhatsz
 * (`jumpHistory` = ennyi undo/redo egyben). Kronológia felülről lefelé (legrégebbi fönt).
 */
export function HistorySheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const pastLabels = useEditorStore((s) => s.pastLabels);
  const futureLabels = useEditorStore((s) => s.futureLabels);
  const jumpHistory = useEditorStore((s) => s.jumpHistory);

  const last = pastLabels.length - 1;
  const atStart = pastLabels.length === 0;

  return (
    <StudioSheet title={t('studio.image.historyTitle', { defaultValue: 'Előzmények' })} icon="time-outline" onClose={onClose}>
      <View style={{ gap: 6 }}>
        {/* kiindulási állapot (minden lépés előtt) */}
        <Row
          icon="flag-outline"
          label={t('studio.image.historyStart', { defaultValue: 'Kiindulás' })}
          active={atStart}
          onPress={() => jumpHistory(-pastLabels.length)}
        />
        {/* alkalmazott lépések (legrégebbi → legújabb); az utolsó a JELENLEGI állapot */}
        {pastLabels.map((lbl, i) => (
          <Row
            key={`p${i}`}
            icon={i === last ? 'ellipse' : 'ellipse-outline'}
            label={lbl || t('studio.image.historyStep', { defaultValue: 'Lépés' })}
            active={i === last}
            onPress={() => jumpHistory(-(last - i))}
          />
        ))}
        {/* visszavont (újra-elérhető) lépések */}
        {futureLabels.map((lbl, k) => (
          <Row
            key={`f${k}`}
            icon="arrow-redo-outline"
            label={lbl || t('studio.image.historyStep', { defaultValue: 'Lépés' })}
            active={false}
            dim
            onPress={() => jumpHistory(k + 1)}
          />
        ))}
      </View>
      <Text style={styles.hint}>{t('studio.image.historyHint', { defaultValue: 'Koppints egy lépésre az odaugráshoz.' })}</Text>
    </StudioSheet>
  );
}

function Row({
  icon,
  label,
  active,
  dim,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  dim?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.row, active ? styles.rowActive : null]}>
      <Ionicons name={icon} size={15} color={active ? palette.accent : dim ? palette.textDim : palette.text} />
      <Text style={[styles.label, active ? styles.labelActive : null, dim ? styles.labelDim : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  rowActive: { borderColor: palette.accent, backgroundColor: `${palette.accent}1a` },
  label: { flex: 1, color: palette.text, fontSize: 12, fontWeight: '600' },
  labelActive: { color: palette.accent, fontWeight: '800' },
  labelDim: { color: palette.textDim },
  hint: { color: palette.textDim, fontSize: 11, textAlign: 'center', paddingTop: 10 },
});
