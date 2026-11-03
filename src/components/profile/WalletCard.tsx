import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { EarningsCard } from '@/components/profile/EarningsCard';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { SubscriptionManageCard } from '@/components/profile/SubscriptionManageCard';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { PurchaseCancelledError, billingClientAvailable, purchaseCoinPack } from '@/lib/billing';
import {
  COIN_PACKS,
  COIN_PAYOUT_EUR,
  COIN_PRICE_EUR_WEB,
  webTopupAvailable,
  EMPTY_WALLET,
  MIN_PAYOUT_CENTS,
  coinsToCents,
  formatCoins,
  formatEur,
  moneyErrorText,
  payoutEur,
  subscriptionCostCents,
  type WalletBreakdown,
} from '@/lib/coins';
import { InsufficientCreditsError, buyCreditsDev } from '@/lib/shop';
import { tierLabelKey, type Tier } from '@/lib/tiers';
import {
  type CreditTx,
  type Gift,
  type GiftEvent,
  GiftNotFoundError,
  InsufficientEarnedError,
  KycRequiredError,
  ManagedByStoreError,
  NoPayoutAccountError,
  type PayoutAccount,
  type PayoutRequest,
  PayoutWeeklyLimitError,
  RecipientNotFoundError,
  SelfSendError,
  BelowMinPayoutError,
  creditHistory,
  fetchPayoutAccount,
  fetchWallet,
  listGifts,
  myPayoutRequests,
  receivedGifts,
  requestPayout,
  sendGift,
  setPayoutAccount,
  startStripeKyc,
  startWebTopup,
  subscribeWithCoins,
} from '@/lib/wallet';
import { logCaught } from '@/lib/logCaught';

const KIND_ICON: Record<string, string> = {
  topup: 'add-circle',
  purchase: 'cart',
  sale: 'pricetag',
  refund: 'return-down-back',
  payout: 'cash',
  transfer: 'swap-horizontal',
  gift: 'gift',
  promo: 'pricetags',
  subscription: 'rocket',
  addon: 'add',
  bonus: 'sparkles',
  release: 'lock-open',
  expire: 'time',
  reversal: 'arrow-undo',
};

/** A Coinnal megvehető egyéni szintek (a Vállalati a szervezeti fiókból jön, 4. fázis). */
const COIN_TIERS: Exclude<Tier, 'free' | 'business'>[] = ['basic', 'pro', 'ultra'];

function giftIcon(gifts: Gift[], id: string): string {
  return gifts.find((g) => g.id === id)?.icon ?? '🎁';
}

export function WalletCard() {
  const { t } = useTranslation();

  const [wallet, setWallet] = useState<WalletBreakdown>(EMPTY_WALLET);
  const balance = wallet.balance;
  const setBalance = (b: number) => setWallet((w) => ({ ...w, balance: b }));
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [history, setHistory] = useState<CreditTx[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [subTier, setSubTier] = useState<Exclude<Tier, 'free' | 'business'>>('basic');
  const [annual, setAnnual] = useState(false);
  const [subKey, setSubKey] = useState(0);
  const [sendTo, setSendTo] = useState('');
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [received, setReceived] = useState<GiftEvent[]>([]);
  const [payoutCoins, setPayoutCoins] = useState('');
  const [payoutEmail, setPayoutEmail] = useState('');

  const refresh = useCallback(() => {
    fetchWallet()
      .then((w) => {
        setWallet(w);
        setLoading(false);
      })
      .catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); return setLoading(false); });
    fetchPayoutAccount()
      .then((a) => {
        setAccount(a);
        if (a?.email) {
          setPayoutEmail(a.email);
        }
      })
      .catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); });
    creditHistory(12).then(setHistory).catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); });
    myPayoutRequests(5).then(setPayouts).catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); });
    listGifts().then(setGifts).catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); });
    receivedGifts(8).then(setReceived).catch((caught) => { logCaught('components/profile/WalletCard.tsx:refresh', caught); });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toShop = () =>
    Alert.alert(t('wallet.notEnoughTitle'), t('wallet.notEnoughMsg'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('wallet.goToShop'), onPress: () => router.push('/shop') },
    ]);

  const onBuyDev = (amount: number) =>
    guard(async () => {
      try {
        setBalance(await buyCreditsDev(amount));
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onBuyDev', e);
        Alert.alert(t('common.error'), moneyErrorText(t, e));
      }
    });

  const storeTopup = billingClientAvailable();
  const webTopup = webTopupAvailable(Platform.OS, process.env.EXPO_PUBLIC_WEB_TOPUP_LINKOUT);

  // 🪙 Coin-csomag: az áruházban (IAP, a webhook ír jóvá) vagy a weben (Stripe, 5 € / Coin)
  const onBuyPack = (packId: string, via: 'store' | 'web') =>
    guard(async () => {
      try {
        if (via === 'store') {
          await purchaseCoinPack(packId);
          Alert.alert(t('wallet.topup.storeDoneTitle'), t('wallet.topup.storeDoneMsg'));
        } else {
          const url = await startWebTopup(packId);
          if (Platform.OS === 'web') {
            window.location.assign(url);
            return;
          }
          await WebBrowser.openBrowserAsync(url);
        }
        refresh();
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onBuyPack', e);
        if (!(e instanceof PurchaseCancelledError)) {
          Alert.alert(t('common.error'), moneyErrorText(t, e));
        }
      }
    });

  const onSubscribe = () =>
    guard(async () => {
      try {
        const months = annual ? 12 : 1;
        const res = await subscribeWithCoins(subTier, months);
        setBalance(res.balance);
        refresh();
        setSubKey((k) => k + 1);
        const until = new Date(res.until).toLocaleDateString();
        Alert.alert(
          t('wallet.subDoneTitle'),
          res.kind === 'downgrade'
            ? t('wallet.sub.downgradeMsg', { tier: t(tierLabelKey(subTier)), date: until })
            : res.credit > 0
              ? t('wallet.sub.changeMsg', { tier: t(tierLabelKey(subTier)), credit: formatCoins(res.credit), until })
              : t('wallet.subDoneMsg', { tier: t(tierLabelKey(subTier)), until })
        );
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onPayPro', e);
        if (e instanceof InsufficientCreditsError) {
          toShop();
        } else if (e instanceof ManagedByStoreError) {
          Alert.alert(t('common.error'), t('wallet.sub.storeManaged'));
        } else {
          Alert.alert(t('common.error'), moneyErrorText(t, e));
        }
      }
    });

  const sendTheGift = (gift: Gift) =>
    guard(async () => {
      const to = sendTo.trim();
      try {
        const res = await sendGift(to, gift.id);
        setBalance(res.balance);
        setSendTo('');
        refresh();
        Alert.alert(
          t('wallet.gift.sentTitle'),
          t('wallet.gift.sentMsg', { icon: gift.icon, name: gift.name, user: to })
        );
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:sendTheGift', e);
        if (e instanceof InsufficientCreditsError) {
          toShop();
        } else if (e instanceof RecipientNotFoundError) {
          Alert.alert(t('common.error'), t('wallet.recipientNotFound'));
        } else if (e instanceof SelfSendError) {
          Alert.alert(t('common.error'), t('wallet.cannotSendToSelf'));
        } else if (e instanceof GiftNotFoundError) {
          Alert.alert(t('common.error'), t('wallet.gift.notFound'));
        } else {
          Alert.alert(t('common.error'), moneyErrorText(t, e));
        }
      }
    });

  const onPickGift = (gift: Gift) => {
    const to = sendTo.trim();
    if (!to) {
      Alert.alert(t('common.error'), t('wallet.gift.needRecipient'));
      return;
    }
    Alert.alert(
      t('wallet.gift.confirmTitle'),
      t('wallet.gift.confirmMsg', { icon: gift.icon, name: gift.name, coins: formatCoins(gift.costCents), user: to }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('wallet.gift.send'), onPress: () => sendTheGift(gift) },
      ]
    );
  };

  const onSaveAccount = () =>
    guard(async () => {
      if (!payoutEmail.trim()) {
        return;
      }
      try {
        await setPayoutAccount(payoutEmail.trim());
        setAccount((a) => ({ provider: 'paypal', email: payoutEmail.trim(), kycStatus: a?.email === payoutEmail.trim() ? (a?.kycStatus ?? 'none') : 'none' }));
        Alert.alert(t('wallet.accountSavedTitle'), t('wallet.accountSavedMsg'));
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onSaveAccount', e);
        Alert.alert(t('common.error'), moneyErrorText(t, e));
      }
    });

  // 🪪 azonosítás (KYC) a Stripe Connecttel — az eredményt a Stripe webhook írja
  const onKyc = () =>
    guard(async () => {
      try {
        const url = await startStripeKyc();
        if (Platform.OS === 'web') {
          window.location.assign(url);
          return;
        }
        await WebBrowser.openBrowserAsync(url);
        refresh();
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onKyc', e);
        Alert.alert(t('common.error'), moneyErrorText(t, e));
      }
    });

  const onCashout = () =>
    guard(async () => {
      const cents = coinsToCents(payoutCoins);
      if (cents <= 0) {
        return;
      }
      try {
        const res = await requestPayout(cents);
        setBalance(res.balance);
        setPayoutCoins('');
        refresh();
        Alert.alert(
          res.status === 'paid' ? t('wallet.payoutPaidTitle') : t('wallet.payoutPendingTitle'),
          res.status === 'under_review'
            ? t('wallet.payoutReviewMsg', { amount: formatEur(res.amountEurCents / 100) })
            : t('wallet.payoutMsg', { amount: formatEur(res.amountEurCents / 100) })
        );
      } catch (e) {
        logCaught('components/profile/WalletCard.tsx:onCashout', e);
        if (e instanceof NoPayoutAccountError) {
          Alert.alert(t('common.error'), t('wallet.noPayoutAccount'));
        } else if (e instanceof KycRequiredError) {
          Alert.alert(t('wallet.kyc.title'), t('wallet.kyc.required'));
        } else if (e instanceof InsufficientEarnedError) {
          Alert.alert(t('common.error'), t('wallet.insufficientEarned'));
        } else if (e instanceof PayoutWeeklyLimitError) {
          Alert.alert(t('common.error'), t('wallet.payoutWeekly'));
        } else if (e instanceof BelowMinPayoutError) {
          Alert.alert(t('common.error'), t('wallet.belowMin', { min: formatCoins(MIN_PAYOUT_CENTS) }));
        } else {
          Alert.alert(t('common.error'), moneyErrorText(t, e));
        }
      }
    });

  const cashoutCents = coinsToCents(payoutCoins);
  const subCost = subscriptionCostCents(subTier, annual ? 12 : 1);

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

      {/* céges fiók (Vállalati, PRO-CASH 5.) */}
      <Pressable onPress={() => router.push('/org')} style={styles.linkBtn} accessibilityRole="button">
        <Ionicons name="business-outline" size={15} color={palette.accent} />
        <Text style={styles.linkText}>{t('org.entry')}</Text>
      </Pressable>

      {/* az előfizetésem: lejárat, lemondás, add-onok */}
      <SubscriptionManageCard onChanged={refresh} refreshKey={subKey} />

      {/* előfizetés Coinból: szint + havi/éves */}
      <View style={styles.card}>
        <Text style={styles.blockTitle}>{t('wallet.subTitle')}</Text>
        <Text style={styles.dim}>{t('wallet.subHint')}</Text>
        <View style={styles.rowWrap}>
          {COIN_TIERS.map((tier) => (
            <Pressable
              key={tier}
              onPress={() => setSubTier(tier)}
              style={[styles.smallBtn, subTier === tier && styles.chipActive]}
              accessibilityState={{ selected: subTier === tier }}
            >
              <Text style={styles.smallBtnText}>{t(tierLabelKey(tier))}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rowWrap}>
          <Pressable onPress={() => setAnnual(false)} style={[styles.smallBtn, !annual && styles.chipActive]}>
            <Text style={styles.smallBtnText}>{t('wallet.monthly')}</Text>
          </Pressable>
          <Pressable onPress={() => setAnnual(true)} style={[styles.smallBtn, annual && styles.chipActive]}>
            <Text style={styles.smallBtnText}>{t('wallet.annual')}</Text>
          </Pressable>
        </View>
        <View style={styles.costRow}>
          <Text style={styles.costText}>
            {t(tierLabelKey(subTier))} · {annual ? t('wallet.annual') : t('wallet.monthly')}
          </Text>
          <Text style={styles.costCoins}>{formatCoins(subCost)} 🪙</Text>
        </View>
        <PrimaryButton
          icon="rocket"
          label={busy ? t('wallet.working') : t('wallet.subCta')}
          onPress={onSubscribe}
          disabled={busy}
        />
      </View>

      {/* bevételi panel */}
      <EarningsCard refreshKey={subKey} />

      {/* ajánlói program */}
      <ReferralCard />

      {/* ajándék küldése (TikTok-modell): címzett + gift-katalógus */}
      <View style={styles.card}>
        <Text style={styles.blockTitle}>{t('wallet.gift.title')}</Text>
        <Text style={styles.dim}>{t('wallet.gift.hint')}</Text>
        <TextInput
          value={sendTo}
          onChangeText={setSendTo}
          placeholder={t('wallet.recipientPlaceholder')}
          placeholderTextColor={palette.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <View style={styles.giftGrid}>
          {gifts.map((g) => (
            <Pressable key={g.id} onPress={() => onPickGift(g)} disabled={busy} style={styles.giftChip}>
              <Text style={styles.giftIcon}>{g.icon}</Text>
              <Text style={styles.giftCost}>{formatCoins(g.costCents)} 🪙</Text>
            </Pressable>
          ))}
        </View>
        {received.length > 0 ? (
          <View style={styles.receivedRow}>
            <Text style={styles.dim}>{t('wallet.gift.received')}:</Text>
            <Text style={styles.receivedIcons} numberOfLines={1}>
              {received.map((r) => giftIcon(gifts, r.giftId)).join(' ')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* kiváltás pénzre */}
      <View style={styles.card}>
        <Text style={styles.blockTitle}>{t('wallet.cashoutTitle')}</Text>
        <Text style={styles.dim}>
          {t('wallet.cashoutHint', { rate: formatEur(COIN_PAYOUT_EUR), min: formatCoins(MIN_PAYOUT_CENTS) })}
        </Text>
        <TextInput
          value={payoutEmail}
          onChangeText={setPayoutEmail}
          placeholder={t('wallet.paypalPlaceholder')}
          placeholderTextColor={palette.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
        />
        <Pressable onPress={onSaveAccount} disabled={busy} style={styles.linkBtn}>
          <Ionicons name="save-outline" size={15} color={palette.accent} />
          <Text style={styles.linkText}>
            {account?.email ? t('wallet.updateAccount') : t('wallet.saveAccount')}
          </Text>
        </Pressable>
        <View style={styles.bucketRow}>
          <Text style={styles.bucketLabel}>
            {t('wallet.kyc.title')}: {t(`wallet.kyc.status.${account?.kycStatus ?? 'none'}`)}
          </Text>
          {account?.kycStatus !== 'verified' ? (
            <Pressable onPress={onKyc} disabled={busy} style={styles.linkBtn} accessibilityRole="button">
              <Ionicons name="shield-checkmark-outline" size={15} color={palette.accent} />
              <Text style={styles.linkText}>{t('wallet.kyc.start')}</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          value={payoutCoins}
          onChangeText={setPayoutCoins}
          placeholder={t('wallet.coinsPlaceholder')}
          placeholderTextColor={palette.textDim}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <View style={styles.costRow}>
          <Text style={styles.costText}>
            {formatCoins(cashoutCents)} 🪙 → {formatEur(payoutEur(cashoutCents))}
          </Text>
        </View>
        <PrimaryButton
          icon="cash"
          label={busy ? t('wallet.working') : t('wallet.cashoutCta')}
          onPress={onCashout}
          disabled={busy}
        />
        {payouts.length > 0 ? (
          <View style={styles.payoutList}>
            {payouts.map((p) => (
              <Text key={p.id} style={styles.payoutRow}>
                {formatCoins(p.cents)} 🪙 → {formatEur(p.amountEurCents / 100)} ·{' '}
                <Text style={{ color: p.status === 'paid' ? palette.accent : palette.textDim }}>
                  {t(`wallet.status.${p.status}`, { defaultValue: p.status })}
                </Text>
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      {/* előzmények */}
      {history.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.blockTitle}>{t('wallet.historyTitle')}</Text>
          {history.map((h) => (
            <View key={h.id} style={styles.histRow}>
              <Ionicons
                name={(KIND_ICON[h.kind] ?? 'ellipse') as never}
                size={15}
                color={h.deltaCents >= 0 ? palette.accent : palette.textDim}
              />
              <Text style={styles.histKind} numberOfLines={1}>
                {t(`wallet.kind.${h.kind}`, { defaultValue: h.kind })}
                {h.note ? ` · ${h.note}` : ''}
              </Text>
              <Text style={[styles.histDelta, { color: h.deltaCents >= 0 ? '#39d98a' : palette.danger }]}>
                {h.deltaCents >= 0 ? '+' : ''}
                {formatCoins(h.deltaCents)} 🪙
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

function BucketRow({ label, cents, note, strong }: { label: string; cents: number; note?: string; strong?: boolean }) {
  return (
    <View style={styles.bucketRow}>
      <Text style={styles.bucketLabel}>
        {label}
        {note ? <Text style={styles.dim}> · {note}</Text> : null}
      </Text>
      <Text style={[styles.bucketValue, strong && { color: palette.accent }]}>{formatCoins(cents)} 🪙</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800', marginTop: 22, marginBottom: 4 },
  sectionHint: { color: palette.textDim, fontSize: 12, marginBottom: 8 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  dim: { color: palette.textDim, fontSize: 12 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { color: palette.textDim, fontSize: 13 },
  balanceValue: { color: palette.text, fontSize: 22, fontWeight: '900' },
  rowWrap: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  packGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  packChip: {
    minWidth: 92,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    paddingHorizontal: 10,
  },
  packCoins: { color: palette.text, fontSize: 14, fontWeight: '800' },
  bucketRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 },
  bucketLabel: { color: palette.text, fontSize: 13, flexShrink: 1 },
  bucketValue: { color: palette.text, fontSize: 13, fontWeight: '700' },
  chipActive: { borderColor: palette.accent, borderWidth: 1 },
  smallBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  smallBtnText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  blockTitle: { color: palette.text, fontSize: 13, fontWeight: '800' },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  costText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  costCoins: { color: palette.accent, fontSize: 14, fontWeight: '800' },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  giftChip: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 62,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    gap: 2,
  },
  giftIcon: { fontSize: 24 },
  giftCost: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  receivedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  receivedIcons: { flex: 1, fontSize: 15 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  linkText: { color: palette.accent, fontSize: 13, fontWeight: '600' },
  payoutList: { marginTop: 6, gap: 4 },
  payoutRow: { color: palette.textDim, fontSize: 12 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histKind: { color: palette.textDim, fontSize: 12, flex: 1 },
  histDelta: { fontSize: 13, fontWeight: '800' },
});
