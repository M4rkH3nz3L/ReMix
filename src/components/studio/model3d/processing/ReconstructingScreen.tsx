import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { styles } from '@/components/studio/model3d/model3dStudioStyles';
import { palette } from '@/constants/editor';
import { Remix3D } from '@/lib/remix3dNative';

/** ⏳ REKONSTRUKCIÓ: a natív fotogrammetria haladása + megszakítás */
export function ReconstructingScreen({ header, progress }: { header: ReactNode; progress: number }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
      {header}
      <View style={styles.center}>
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={styles.bigText}>{t('model3d.reconstruct.title')}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.dim}>{Math.round(progress * 100)}%</Text>
        <Text style={[styles.dim, styles.centerText]}>{t('model3d.reconstruct.hint')}</Text>
        <Pressable onPress={() => void Remix3D?.cancelReconstruct()} style={styles.secondaryBtn} accessibilityRole="button">
          <Text style={styles.secondaryText}>{t('model3d.reconstruct.cancel')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
