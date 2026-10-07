import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { fetchMyUsage, nearQuota, type MetricStatus } from '@/lib/usageClient';
import { useEntitlement } from '@/store/entitlementStore';

const AMBER = '#f5a623';

/**
 * 📊 Kvóta soft-warn banner (02-monetization §2.2) — ha egy havi metrika eléri a
 * 80%-ot, figyelmeztet + Pro-ra terel. Kijelentkezve / Supabase nélkül némán kimarad
 * (a `fetchMyUsage` dob → nincs banner). A tényleges ENFORCE server-oldali; ez csak UI.
 */
export function UsageBanner() {
  const { t } = useTranslation();
  const tier = useEntitlement((s) => s.effectiveTier());
  const [warn, setWarn] = useState<MetricStatus[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMyUsage()
      .then((c) => {
        if (alive) {
          setWarn(nearQuota(c, tier));
        }
      })
      .catch(() => {}); // kijelentkezve / nincs supabase → nincs banner
    return () => {
      alive = false;
    };
  }, [tier]);

  if (dismissed || warn.length === 0) {
    return null;
  }
  const names = warn.map((s) => t(`usage.metric.${s.metric}`)).join(', ');
  const pct = Math.round(warn.reduce((a, b) => (b.ratio > a.ratio ? b : a)).ratio * 100);

  return (
    <View style={styles.banner}>
      <Ionicons name="alert-circle" size={16} color={AMBER} />
      <Text style={styles.text} numberOfLines={2}>
        {t('usage.nearQuota', { names, pct })}
      </Text>
      <Pressable onPress={() => router.push('/shop')} hitSlop={6} style={styles.upgrade}>
        <Text style={styles.upgradeText}>{t('usage.upgrade')}</Text>
      </Pressable>
      <Pressable
        onPress={() => setDismissed(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <Ionicons name="close" size={16} color={palette.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${AMBER}55`,
    backgroundColor: `${AMBER}18`,
  },
  text: { flex: 1, color: palette.text, fontSize: 12, lineHeight: 16 },
  upgrade: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  upgradeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
