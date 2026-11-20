import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { useToast } from '@/store/toastStore';

interface Props {
  /** a szerkesztő-gombok (csak szerkesztésben, betöltött projekttel) */
  showControls: boolean;
  showSafeZones: boolean;
  toggleSafeZones: () => void;
  comparingOriginal: boolean;
  setComparingOriginal: (on: boolean) => void;
  compareSplit: number | null;
  setCompareSplit: (split: number | null) => void;
}

/**
 * 🧰 Az előnézet sarok-gombjai a vászon fölött: safe-zone kapcsoló, before/after
 * (nyomva tartva eredeti), slider-kapcsoló + az „eredeti” jelvény.
 * A PreviewSurface-ből kiemelve — kinézet és sorrend változatlan.
 */
export function PreviewToolbar({
  showControls,
  showSafeZones,
  toggleSafeZones,
  comparingOriginal,
  setComparingOriginal,
  compareSplit,
  setCompareSplit,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      {/* safe-zone kapcsoló (bal felső sarok, csak szerkesztésben) */}
      {showControls ? (
        <Pressable
          onPress={() => {
            // bekapcsoláskor egy mondat, MIT mutat (az ikon önmagában nem egyértelmű — D9)
            if (!showSafeZones) useToast.getState().show(t('editor.preview.safeZonesHint'));
            toggleSafeZones();
          }}
          hitSlop={8}
          style={[styles.safeToggle, showSafeZones ? styles.safeToggleOn : null]}
          accessibilityRole="switch"
          accessibilityState={{ checked: showSafeZones }}
          accessibilityLabel={t('editor.preview.safeZones')}
          accessibilityHint={t('editor.preview.safeZonesHint')}
        >
          <Ionicons
            name="phone-portrait-outline"
            size={16}
            color={showSafeZones ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {/* 🅱️ before/after: nyomva tartva a NYERS forrás látszik (look nélkül) */}
      {showControls ? (
        <Pressable
          onPressIn={() => setComparingOriginal(true)}
          onPressOut={() => setComparingOriginal(false)}
          hitSlop={8}
          style={[styles.compareBtn, comparingOriginal ? styles.compareBtnOn : null]}
          accessibilityRole="button"
          accessibilityLabel={t('editor.preview.compareOriginal')}
          accessibilityHint={t('editor.preview.compareHint')}
        >
          <Ionicons
            name="git-compare-outline"
            size={16}
            color={comparingOriginal ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {/* 🅱️ before/after SLIDER kapcsoló (eredeti | szerkesztett, húzható elválasztóval) */}
      {showControls ? (
        <Pressable
          onPress={() => setCompareSplit(compareSplit == null ? 0.5 : null)}
          hitSlop={8}
          style={[styles.sliderToggle, compareSplit != null ? styles.compareBtnOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: compareSplit != null }}
          accessibilityLabel={t('editor.preview.compareSlider')}
        >
          <Ionicons
            name="contrast-outline"
            size={16}
            color={compareSplit != null ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {comparingOriginal ? (
        <View pointerEvents="none" style={styles.originalBadge}>
          <Text style={styles.originalBadgeText}>{t('editor.preview.original')}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  safeToggle: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  safeToggleOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  compareBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  compareBtnOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  originalBadge: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: palette.accent,
  },
  originalBadgeText: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sliderToggle: {
    position: 'absolute',
    top: 44,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});
