import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/** 💾 Sikertelen mentés és hiányzó média sávja a stúdiók tetején. */
export function StudioStatusBanners({
  saveFailed,
  missingCount,
  relinking,
  onRelink,
}: {
  saveFailed: boolean;
  missingCount: number;
  relinking: boolean;
  onRelink: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {saveFailed ? (
        <View style={styles.saveFailed} accessibilityRole="alert">
          <Ionicons name="warning-outline" size={14} color="#ffd166" />
          <Text style={styles.saveFailedText}>{t('studio.image.unsaved.banner')}</Text>
        </View>
      ) : null}
      {missingCount > 0 ? (
        <Pressable style={styles.missingBanner} onPress={onRelink} accessibilityRole="button">
          <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
          <Text style={styles.missingText}>
            {relinking ? t('editorScreen.relinking') : t('editorScreen.missingMedia', { count: missingCount })}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  saveFailed: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,209,102,0.12)' },
  missingBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(255,92,92,0.12)' },
  missingText: { color: palette.text, fontSize: 12, fontWeight: '600', flex: 1 },
  saveFailedText: { color: '#ffd166', fontSize: 12, fontWeight: '600', flex: 1 },
});
