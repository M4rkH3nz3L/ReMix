import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import { palette } from '@/constants/editor';
import { deactivateProDev } from '@/lib/billing';

/** a panel teteje: aktív Pro (lejárattal) vagy a Pro-ajánlat sávja */
export function ProStatusBanner({
  isPro,
  proUntil,
  openPaywall,
}: {
  isPro: boolean;
  proUntil: string | null;
  openPaywall: () => void;
}) {
  const { t } = useTranslation();
  return isPro ? (
    // a hosszú-nyomásos Free-re-váltás CSAK dev-buildben (rejtett teszt-gesztus)
    <Pressable
      style={styles.proActive}
      onLongPress={__DEV__ ? () => void deactivateProDev() : undefined}
    >
      <Ionicons name="sparkles" size={15} color={palette.accent} />
      <Text style={styles.proActiveText}>
        {proUntil
          ? t('panels.export.proActiveUntil', {
              date: new Date(proUntil).toLocaleDateString(),
            })
          : t('panels.export.proActive')}
      </Text>
    </Pressable>
  ) : (
    <Pressable style={styles.proBanner} onPress={() => openPaywall()}>
      <Ionicons name="rocket-outline" size={16} color={palette.text} />
      <Text style={styles.proBannerText}>
        {t('panels.export.proBanner')}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
    </Pressable>
  );
}
