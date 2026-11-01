import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import type { ImportAction } from '@/lib/imageMenu';

const ROWS: { key: ImportAction; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'file', icon: 'image-outline' },
  { key: 'source', icon: 'folder-open-outline' },
  { key: 'svg', icon: 'shapes-outline' },
  { key: 'psd', icon: 'layers-outline' },
  { key: 'pdf', icon: 'document-outline' },
];

/** 📥 Importálás: minden, ami kívülről jön, egy helyen (a fotót a Fotó szerszám hozza). */
export function ImportSheet({
  disabled,
  onPick,
  onClose,
}: {
  disabled: (key: ImportAction) => boolean;
  onPick: (key: ImportAction) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('studio.imageTools.import')} icon="folder-open-outline" onClose={onClose}>
      <View style={styles.list}>
        {ROWS.map((row) => {
          const off = disabled(row.key);
          return (
            <Pressable
              key={row.key}
              style={[styles.row, off ? styles.off : null]}
              disabled={off}
              onPress={() => onPick(row.key)}
              accessibilityRole="button"
              accessibilityState={{ disabled: off }}
            >
              <Ionicons name={row.icon} size={20} color={palette.accent} />
              <Text style={styles.label}>{t(`studio.image.importFrom.${row.key}`)}</Text>
              {off ? <Text style={styles.pro}>Pro</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.surfaceHigh },
  off: { opacity: 0.5 },
  label: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  pro: { color: palette.accent, fontSize: 12, fontWeight: '700' },
});
