import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatCoins, moneyErrorText } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { InsufficientCreditsError } from '@/lib/shop';
import { ADDONS, addonAllowed, addonDef, suggestUpgrade, type AddonId, type PaidTier } from '@/lib/subscriptionPlan';
import { tierLabelKey } from '@/lib/tiers';
import {
  AddonNotAllowedError,
  addAddon,
  fetchSubscription,
  removeAddon,
  setAutoRenew,
  type MySubscription,
} from '@/lib/wallet';

/**
 * 🔁 Az előfizetésem (PRO-CASH 3.3–3.4): szint, lejárat, megújítás be/ki (lemondás egy
 * koppintással), függő lefelé váltás, add-onok felvétele és levétele. Csak Coinból fizetett
 * előfizetésnél kezelhető itt; az áruházit az App Store / Play kezeli.
 */
export function SubscriptionManageCard({ onChanged, refreshKey }: { onChanged: () => void; refreshKey: number }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<MySubscription | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchSubscription()
      .then(setSub)
      .catch((caught) => { logCaught('components/profile/SubscriptionManageCard.tsx:load', caught); });
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!sub || sub.tier === 'free') {
    return null;
  }
  const paid = sub.tier as PaidTier;
  const coinBilled = sub.source === 'coins';
  const monthlyAddons = sub.addons
    .filter((a) => !a.cancelAtPeriodEnd)
    .reduce((n, a) => n + (addonDef(a.addon)?.priceCents ?? 0) * a.qty, 0);
  const upsell = suggestUpgrade(paid, monthlyAddons);

  const run = async (fn: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      logCaught('components/profile/SubscriptionManageCard.tsx:run', e);
      if (e instanceof InsufficientCreditsError) {
        Alert.alert(t('wallet.notEnoughTitle'), t('wallet.notEnoughMsg'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('wallet.goToShop'), onPress: () => router.push('/shop') },
        ]);
      } else if (e instanceof AddonNotAllowedError) {
        Alert.alert(t('common.error'), t(`wallet.sub.addonError.${e.message}`, { defaultValue: e.message }));
      } else {
        Alert.alert(t('common.error'), moneyErrorText(t, e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onToggleRenew = () =>
    sub.autoRenew
      ? Alert.alert(t('wallet.sub.cancelTitle'), t('wallet.sub.cancelMsg', { date: dateOf(sub.until) }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('wallet.sub.cancelCta'), style: 'destructive', onPress: () => run(() => setAutoRenew(false)) },
        ])
      : run(() => setAutoRenew(true));

  const onAdd = (id: AddonId) => {
    const a = addonDef(id);
    if (!a) {
      return;
    }
    Alert.alert(
      t('wallet.sub.addTitle'),
      t('wallet.sub.addMsg', { name: t(`wallet.sub.addon.${id}`), price: formatCoins(a.priceCents) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('wallet.sub.addCta'), onPress: () => run(async () => { await addAddon(id, 1); }) },
      ]
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('wallet.sub.mine')}</Text>
      <Text style={styles.line}>
        {t(tierLabelKey(sub.tier))} · {sub.billingPeriod === 'year' ? t('wallet.annual') : t('wallet.monthly')}
        {sub.seats > 1 ? ` · ${t('wallet.sub.seats', { n: sub.seats })}` : ''}
      </Text>
      <Text style={styles.dim}>
        {sub.autoRenew
          ? t('wallet.sub.renewsOn', { date: dateOf(sub.until), cost: formatCoins(sub.renewalCost) })
          : t('wallet.sub.endsOn', { date: dateOf(sub.until) })}
      </Text>
      {sub.pendingTier ? (
        <Text style={styles.dim}>{t('wallet.sub.pending', { tier: t(tierLabelKey(sub.pendingTier)) })}</Text>
      ) : null}

      {coinBilled ? (
        <>
          <Pressable onPress={onToggleRenew} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
            <Ionicons name={sub.autoRenew ? 'close-circle-outline' : 'refresh'} size={16} color={palette.accent} />
            <Text style={styles.linkText}>{sub.autoRenew ? t('wallet.sub.cancelCta') : t('wallet.sub.resumeCta')}</Text>
          </Pressable>

          {sub.addons.length > 0 ? (
            <View style={styles.list}>
              {sub.addons.map((a) => (
                <View key={a.id} style={styles.addonRow}>
                  <Text style={styles.addonText}>
                    {t(`wallet.sub.addon.${a.addon}`)} × {a.qty}
                    {a.cancelAtPeriodEnd ? ` · ${t('wallet.sub.addonEnding')}` : ''}
                  </Text>
                  {!a.cancelAtPeriodEnd ? (
                    <Pressable
                      onPress={() => run(() => removeAddon(a.id))}
                      disabled={busy}
                      hitSlop={10}
                      accessibilityLabel={t('wallet.sub.removeAddon')}
                    >
                      <Ionicons name="remove-circle-outline" size={20} color={palette.textDim} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <Text style={styles.subTitle}>{t('wallet.sub.addonsTitle')}</Text>
          <View style={styles.chips}>
            {ADDONS.filter((a) => addonAllowed(a.id, sub.tier)).map((a) => (
              <Pressable key={a.id} onPress={() => onAdd(a.id)} disabled={busy} style={styles.chip}>
                <Text style={styles.chipText}>
                  {t(`wallet.sub.addon.${a.id}`)} · {formatCoins(a.priceCents)} 🪙
                </Text>
              </Pressable>
            ))}
          </View>
          {upsell ? (
            <Text style={styles.upsell}>{t('wallet.sub.upsell', { tier: t(tierLabelKey(upsell)) })}</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.dim}>{t('wallet.sub.storeManaged')}</Text>
      )}
    </View>
  );
}

function dateOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  title: { color: palette.text, fontSize: 14, fontWeight: '800' },
  subTitle: { color: palette.text, fontSize: 13, fontWeight: '700', marginTop: 4 },
  line: { color: palette.text, fontSize: 14, fontWeight: '600' },
  dim: { color: palette.textDim, fontSize: 12 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  list: { gap: 6 },
  addonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  addonText: { color: palette.text, fontSize: 13, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  upsell: { color: palette.accent, fontSize: 12, fontWeight: '700' },
});
