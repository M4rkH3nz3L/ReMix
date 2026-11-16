import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 👋 Üres lap (IMAGE-PROD S22): egy mondatos vezetés és a három első lépés a vászon közepén — fotó,
 * szöveg, sablon. Az első réteggel eltűnik; a vászon gesztusait nem takarja (csak a kártya érinthető).
 */
export function EmptyCanvasHint({ onTool }: { onTool: (k: 'photo' | 'text' | 'templates') => void }) {
  const { t } = useTranslation();
  const steps: { key: 'photo' | 'text' | 'templates'; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'photo', icon: 'image-outline' },
    { key: 'text', icon: 'text-outline' },
    { key: 'templates', icon: 'grid-outline' },
  ];
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={styles.card}>
        <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('studio.image.empty.title')}</Text>
        <View style={styles.row}>
          {steps.map((s) => (
            <Pressable key={s.key} onPress={() => onTool(s.key)} style={styles.btn} accessibilityRole="button" accessibilityLabel={t(`studio.image.empty.${s.key}`)}>
              <Ionicons name={s.icon} size={18} color={palette.accent} />
              <Text maxFontSizeMultiplier={1.3} style={styles.btnText}>{t(`studio.image.empty.${s.key}`)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { backgroundColor: `${palette.bg}e6`, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: 16, gap: 12, maxWidth: 420, alignItems: 'center' },
  title: { color: palette.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 40, borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  btnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
