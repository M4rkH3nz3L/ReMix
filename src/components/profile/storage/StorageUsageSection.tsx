import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';

import { Stepper } from '@/components/profile/storage/Stepper';
import { styles } from '@/components/profile/storage/storageStyles';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';
import { type StorageUsage, formatBytes } from '@/lib/storageQuota';
import { tierLabelKey, type Tier } from '@/lib/tiers';

/** 📊 a ReMix-tárhely: használat-sáv, bontás, türelmi idő, bővítés (a StorageCard.tsx-ből kiemelve) */
export function StorageUsageSection({
  loading,
  usage,
  pct,
  barColor,
  tier,
  boostBlocks,
  setBoostBlocks,
  cost,
  balance,
  busy,
  onBuy,
}: {
  loading: boolean;
  usage: StorageUsage | null;
  pct: number;
  barColor: string;
  tier: Tier;
  boostBlocks: number;
  setBoostBlocks: (v: number) => void;
  cost: number;
  balance: number;
  busy: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.storage.section')}</Text>
      <Text style={styles.sectionHint}>{t('profile.storage.sectionHint')}</Text>
      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator color={palette.accent} />
        ) : !usage ? (
          <Text style={styles.dim}>{t('profile.storage.unavailable')}</Text>
        ) : (
          <>
            {/* használat-sáv */}
            <View style={styles.usageRow}>
              <Text style={styles.usageText}>
                {formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)}
              </Text>
              <Text style={[styles.usagePct, { color: barColor }]}>{Math.round(pct * 100)}%</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.breakdown}>
              {t('profile.storage.baseLabel', { plan: t(tierLabelKey(tier)) })}: {formatBytes(usage.baseBytes)}
              {usage.addonBytes > 0 ? ` · ${t('profile.storage.addonLabel')}: ${formatBytes(usage.addonBytes)}` : ''}
              {usage.bonusBytes > 0 ? ` · ${t('profile.storage.bonusLabel')}: ${formatBytes(usage.bonusBytes)}` : ''}
            </Text>
            {usage.bonusExpiresAt ? (
              <Text style={styles.dim}>
                {t('profile.storage.bonusExpires', {
                  date: new Date(usage.bonusExpiresAt).toLocaleDateString(),
                })}
              </Text>
            ) : null}

            {usage.overQuota ? (
              <View style={styles.graceBox}>
                <Ionicons name="lock-closed" size={15} color={palette.danger} />
                <Text style={styles.graceText}>
                  {t('profile.storage.readOnly', {
                    date: usage.graceUntil ? new Date(usage.graceUntil).toLocaleDateString() : '—',
                  })}
                </Text>
              </View>
            ) : null}

            {/* bővítés: +10 GB / hó ismétlődő add-on — csak fizetős szinten */}
            {tier === 'free' ? (
              <Text style={styles.dim}>{t('profile.storage.freeHint')}</Text>
            ) : (
            <View style={styles.boostBox}>
              <Text style={styles.boostTitle}>{t('profile.storage.boostTitle')}</Text>
              <Stepper label={t('profile.storage.blocks')} value={boostBlocks} min={1} max={10} onChange={setBoostBlocks} />
              <View style={styles.costRow}>
                <Text style={styles.costText}>
                  <Ionicons name="server" size={13} color={palette.accent} /> +{boostBlocks * 10} GB / {t('profile.storage.monthsShort')}
                </Text>
                <Text style={styles.costCoins}>
                  {formatCoins(cost)} 🪙 / {t('profile.storage.monthsShort')} · {t('profile.storage.balance')}: {formatCoins(balance)}
                </Text>
              </View>
              <PrimaryButton
                icon="add-circle"
                label={busy ? t('profile.storage.working') : t('profile.storage.buyBoost')}
                onPress={onBuy}
                disabled={busy}
              />
            </View>
            )}
          </>
        )}
      </View>
    </>
  );
}
