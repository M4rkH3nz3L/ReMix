import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { BucketRow } from '@/components/profile/wallet/BucketRow';
import { styles } from '@/components/profile/wallet/walletStyles';
import { palette } from '@/constants/editor';
import {
  COIN_PACKS,
  COIN_PAYOUT_EUR,
  COIN_PRICE_EUR_WEB,
  formatCoins,
  formatEur,
  payoutEur,
  type WalletBreakdown,
} from '@/lib/coins';

/** 🪙 egyenleg + alegyenlegek + Coin-vétel (a WalletCard.tsx-ből kiemelve) */
export function WalletBalanceSection({
  wallet,
  balance,
  loading,
  busy,
  storeTopup,
  webTopup,
  onBuyDev,
  onBuyPack,
}: {
  wallet: WalletBreakdown;
  balance: number;
  loading: boolean;
  busy: boolean;
  storeTopup: boolean;
  webTopup: boolean;
  onBuyDev: (amount: number) => void;
  onBuyPack: (packId: string, via: 'store' | 'web') => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('wallet.section')}</Text>
      <Text style={styles.sectionHint}>
        {t('wallet.rates', { buy: formatEur(COIN_PRICE_EUR_WEB), cashout: formatEur(COIN_PAYOUT_EUR) })}
      </Text>
      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator color={palette.accent} />
        ) : (
          <>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>{t('wallet.balance')}</Text>
              <Text style={styles.balanceValue}>{formatCoins(balance)} 🪙</Text>
            </View>
            <BucketRow label={t('wallet.bucket.purchased')} cents={wallet.purchased} />
            {wallet.bonus > 0 ? <BucketRow label={t('wallet.bucket.bonus')} cents={wallet.bonus} /> : null}
            <BucketRow
              label={t('wallet.bucket.earnedPending')}
              cents={wallet.earnedPending}
              note={
                wallet.nextReleaseAt
                  ? t('wallet.bucket.nextRelease', { date: new Date(wallet.nextReleaseAt).toLocaleDateString() })
                  : undefined
              }
            />
            <BucketRow
              label={t('wallet.bucket.earnedAvailable')}
              cents={wallet.earnedAvailable}
              note={`≈ ${formatEur(payoutEur(wallet.earnedAvailable))}`}
              strong
            />

            {/* koin-vétel (dev: worker-grant; élesben IAP/áruház) */}
            {__DEV__ ? (
              <View style={styles.rowWrap}>
                <Pressable onPress={() => onBuyDev(1)} disabled={busy} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>+1 🪙 (dev)</Text>
                </Pressable>
                <Pressable onPress={() => onBuyDev(10)} disabled={busy} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>+10 🪙 (dev)</Text>
                </Pressable>
              </View>
            ) : null}
            {storeTopup || webTopup ? (
              <View style={styles.packGrid}>
                {COIN_PACKS.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => onBuyPack(p.id, storeTopup ? 'store' : 'web')}
                    disabled={busy}
                    style={styles.packChip}
                    accessibilityRole="button"
                  >
                    <Text style={styles.packCoins}>{p.coins} 🪙{p.bonusCoins ? ` +${formatCoins(p.bonusCoins * 100)}` : ''}</Text>
                    <Text style={styles.dim}>{formatEur(storeTopup ? p.priceEurStore : p.priceEurWeb)}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.dim}>{t('wallet.buyHint', { price: formatEur(COIN_PRICE_EUR_WEB) })}</Text>
            )}
            {storeTopup && webTopup ? (
              <Pressable onPress={() => onBuyPack('coins_10', 'web')} disabled={busy} style={styles.linkBtn}>
                <Ionicons name="globe-outline" size={15} color={palette.accent} />
                <Text style={styles.linkText}>{t('wallet.topup.webCheaper', { price: formatEur(COIN_PRICE_EUR_WEB) })}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.dim}>{t('wallet.topup.legal')}</Text>
          </>
        )}
      </View>
    </>
  );
}
