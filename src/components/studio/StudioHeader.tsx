import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🧭 A Stúdió felső fejléce: app-logó + profil/shop/ütemezések/import ikon-gombok.
 * Tisztán prezentációs — a `.vided` importot a szülő adja át (handler-threading).
 */
export function StudioHeader({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Image
        source={require('../../../assets/images/icon.png')}
        style={styles.logoBadge}
        contentFit="cover"
        accessibilityLabel={t('home.appName')}
      />
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => router.push('/profile')}
        hitSlop={8}
        style={styles.importButton}
        accessibilityRole="button"
        accessibilityLabel={t('auth.account')}
      >
        <Ionicons name="person-circle-outline" size={20} color={palette.textDim} />
        <Text style={styles.importLabel}>{t('auth.account')}</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/shop')}
        hitSlop={8}
        style={styles.importButton}
        accessibilityRole="button"
        accessibilityLabel={t('shop.title')}
      >
        <Ionicons name="storefront-outline" size={20} color={palette.accent} />
        <Text style={[styles.importLabel, { color: palette.accent }]}>{t('shop.title')}</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push('/schedules')}
        hitSlop={8}
        style={styles.importButton}
        accessibilityRole="button"
        accessibilityLabel={t('schedules.title')}
      >
        <Ionicons name="layers-outline" size={20} color={palette.textDim} />
        <Text style={styles.importLabel}>{t('nav.schedules')}</Text>
      </Pressable>
      <Pressable onPress={onImport} hitSlop={8} style={styles.importButton}>
        <Ionicons name="download-outline" size={20} color={palette.textDim} />
        <Text style={styles.importLabel}>{t('common.import')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  importButton: {
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.surface,
  },
  importLabel: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  logoBadge: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.accent,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
});
