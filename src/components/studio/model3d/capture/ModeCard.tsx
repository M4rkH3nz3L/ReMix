import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';

/** 🧭 egy rögzítési mód kártyája: mire jó · hogyan · mi lesz az eredmény (a valós formátummal) */
export function ModeCard({
  icon,
  mode,
  format,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  mode: 'object' | 'freeform' | 'room' | 'pointcloud' | 'import';
  format: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={t(`model3d.mode.${mode}`)}
      accessibilityHint={t(`model3d.mode.${mode}Desc`)}
    >
      <Ionicons name={icon} size={26} color={palette.accent} style={styles.modeIcon} />
      <View style={styles.fill}>
        <Text style={styles.modeTitle}>{t(`model3d.mode.${mode}`)}</Text>
        <Text style={styles.modeDesc}>{t(`model3d.mode.${mode}Desc`)}</Text>
        <Text style={styles.modeHow}>
          <Text style={styles.modeHowLabel}>{t('model3d.mode.howLabel')} </Text>
          {t(`model3d.mode.${mode}How`)}
        </Text>
        <Text style={styles.modeResult}>{t(`model3d.mode.${mode}Result`, { format })}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.textDim} />
    </Pressable>
  );
}
