import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { devCycle, devGrantCoins, devResetWallet, devSetKyc, devSetTier, type DevCoinBucket } from '@/lib/devBilling';
import { TIER_ORDER, tierLabelKey, type Tier } from '@/lib/tiers';
import { useEntitlement } from '@/store/entitlementStore';

/**
 * 🧪 DEV-admin (csak `__DEV__`): minden PRO-CASH-állapot egy koppintással a saját fiókodon —
 * szint (Free … Vállalati), Coin bármelyik alegyenlegre, kifizetési azonosítás, a periódus
 * lejárata (megújítás próbája), a tartás feloldása, pénztárca-nullázás. A worker csak
 * `ALLOW_DEV_BILLING=1` mellett engedi; élesben ez a panel nem is látszik.
 */
const COIN_BUTTONS: { coins: number; bucket: DevCoinBucket; key: string }[] = [
  { coins: 10, bucket: 'purchased', key: 'purchased' },
  { coins: 100, bucket: 'purchased', key: 'purchased' },
  { coins: 5, bucket: 'bonus', key: 'bonus' },
  { coins: 50, bucket: 'earned', key: 'earned' },
  { coins: 50, bucket: 'earned_available', key: 'earnedAvailable' },
];

export function DevBillingPanel() {
  const { t } = useTranslation();
  const tier = useEntitlement((s) => s.effectiveTier());
  const [busy, setBusy] = useState(false);
  const [coinBilled, setCoinBilled] = useState(false);

  const run = (fn: () => Promise<unknown>, done?: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    fn()
      .then((out) => {
        if (done) {
          Alert.alert('DEV', done + (out && typeof out === 'object' ? `\n${JSON.stringify(out)}` : ''));
        }
      })
      .catch((e: unknown) => {
        logCaught('components/profile/DevBillingPanel.tsx:run', e);
        Alert.alert('DEV', e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  const chip = (label: string, onPress: () => void, on = false) => (
    <Pressable key={label} onPress={onPress} disabled={busy} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button">
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Ionicons name="construct-outline" size={14} color={palette.accent2} />
        <Text style={styles.title}>{t('devBilling.title')}</Text>
      </View>

      <Text style={styles.label}>{t('devBilling.tier')}</Text>
      <View style={styles.row}>
        {TIER_ORDER.map((x: Tier) => chip(t(tierLabelKey(x)), () => run(() => devSetTier(x, { days: 30, seats: 3, coinBilled })), tier === x))}
      </View>
      <View style={styles.row}>
        {chip(coinBilled ? t('devBilling.coinBilledOn') : t('devBilling.coinBilledOff'), () => setCoinBilled((v) => !v), coinBilled)}
      </View>

      <Text style={styles.label}>{t('devBilling.coins')}</Text>
      <View style={styles.row}>
        {COIN_BUTTONS.map((b) => chip(`+${b.coins} · ${t(`devBilling.bucket.${b.key}`)}`, () => run(() => devGrantCoins(b.coins, b.bucket))))}
      </View>

      <Text style={styles.label}>{t('devBilling.more')}</Text>
      <View style={styles.row}>
        {chip(t('devBilling.kycOn'), () => run(() => devSetKyc('verified'), t('devBilling.kycDone')))}
        {chip(t('devBilling.release'), () => run(() => devCycle('release'), t('devBilling.releaseDone')))}
        {chip(t('devBilling.expire'), () => run(() => devCycle('expire_now'), t('devBilling.expireDone')))}
        {chip(t('devBilling.reset'), () =>
          Alert.alert('DEV', t('devBilling.resetConfirm'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('devBilling.reset'), style: 'destructive', onPress: () => run(devResetWallet) },
          ])
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed', gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: palette.accent2, fontSize: 12, fontWeight: '800' },
  label: { color: palette.textDim, fontSize: 11, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: palette.border, justifyContent: 'center', backgroundColor: palette.surfaceHigh },
  chipOn: { borderColor: palette.accent2 },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
});
