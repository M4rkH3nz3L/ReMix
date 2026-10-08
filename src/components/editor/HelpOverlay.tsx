import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { SHORTCUT_HINTS } from '@/lib/editorKeymap';

/** A súgóban felsorolt alap-gesztusok (a leírás i18n-kulcsa + egy ikon-emoji). */
const GESTURES = ['tapSelect', 'dragMove', 'dragTrim', 'pinchZoom', 'longPressMulti'] as const;

/**
 * ❓ Gesztus- és billentyű-térkép (EDITOR-UX §2.7). A profi vágó-módokat
 * felfedezhetővé teszi: a `SHORTCUT_HINTS` magból épül a billentyű-lista
 * (a `resolveShortcut`-tal garantáltan szinkronban), alatta a fő gesztusok.
 */
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

        <Text style={[styles.section, styles.sectionGap]}>{t('editor.help.keyboardSection')}</Text>
        {SHORTCUT_HINTS.map((h) => (
          <View key={h.action} style={styles.row}>
            <Text style={styles.rowLabel}>{t('editor.help.shortcut.' + h.action)}</Text>
            <View style={styles.keyBadge}>
              <Text style={styles.keyText}>{h.keys}</Text>
            </View>
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
  sectionGap: {
    marginTop: 18,
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
  keyBadge: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  keyText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
});
