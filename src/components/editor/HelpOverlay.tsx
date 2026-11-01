import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';

/** A súgóban felsorolt alap-gesztusok (a leírás i18n-kulcsa + egy ikon-emoji). */
const GESTURES = ['tapSelect', 'dragMove', 'dragTrim', 'pinchZoom', 'longPressMulti'] as const;

/** ❓ Gesztus-térkép (EDITOR-UX §2.7): a profi vágó-módokat felfedezhetővé teszi. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('editor.help.title')} icon="help-circle" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>{t('editor.help.gestureSection')}</Text>
        {GESTURES.map((g) => (
          <View key={g} style={styles.row}>
            <Text style={styles.rowLabel}>{t('editor.help.gesture.' + g)}</Text>
          </View>
        ))}
      </ScrollView>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 2,
  },
  section: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  rowLabel: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
  },
});
