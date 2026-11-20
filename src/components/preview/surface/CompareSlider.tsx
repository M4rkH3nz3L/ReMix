import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';

/**
 * 🅱️ before/after slider: elválasztó vonal + húzható fogantyú + oldal-címkék.
 * A PreviewSurface-ből kiemelve — kinézet és gesztus változatlan.
 */
export function CompareSlider({ sliderX, dividerPan }: { sliderX: number; dividerPan: ComponentProps<typeof GestureDetector>['gesture'] }) {
  const { t } = useTranslation();
  return (
    <>
      <View pointerEvents="none" style={[styles.splitLine, { left: sliderX }]} />
      <View pointerEvents="none" style={[styles.splitBadge, styles.splitBadgeLeft]}>
        <Text style={styles.splitBadgeText}>{t('editor.preview.original')}</Text>
      </View>
      <View pointerEvents="none" style={[styles.splitBadge, styles.splitBadgeRight]}>
        <Text style={styles.splitBadgeText}>{t('editor.preview.edited')}</Text>
      </View>
      <GestureDetector gesture={dividerPan}>
        <View style={[styles.splitHandle, { left: sliderX - 14 }]}>
          <Ionicons name="code-outline" size={16} color="#fff" />
        </View>
      </GestureDetector>
    </>
  );
}

const styles = StyleSheet.create({
  splitLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: '#fff',
    opacity: 0.9,
  },
  splitHandle: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  splitBadge: {
    position: 'absolute',
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  splitBadgeLeft: {
    left: 8,
  },
  splitBadgeRight: {
    right: 8,
  },
  splitBadgeText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
