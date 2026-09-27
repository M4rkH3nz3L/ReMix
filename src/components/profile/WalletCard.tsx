import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { InsufficientCreditsError, buyCreditsDev, creditBalance } from '@/lib/shop';
import {
  COIN_BUY_HUF,
  COIN_CASHOUT_HUF,
  CURRENCY,
  type CreditTx,
  type Gift,
  type GiftEvent,
  GiftNotFoundError,
  MIN_PAYOUT_COINS,
  NoPayoutAccountError,
  type PayoutAccount,
  type PayoutRequest,
  PRO_MONTHLY_COINS,
  RecipientNotFoundError,
  SelfSendError,
  BelowMinPayoutError,
  creditHistory,
  fetchPayoutAccount,
  listGifts,
  myPayoutRequests,
  receivedGifts,
  requestPayout,
  sendGift,
  setPayoutAccount,
  subscribeProWithCredits,
} from '@/lib/wallet';

const KIND_ICON: Record<string, string> = {
  topup: 'add-circle',
  purchase: 'cart',
  sale: 'pricetag',
  refund: 'return-down-back',
  payout: 'cash',
  transfer: 'swap-horizontal',
  gift: 'gift',
};

function giftIcon(gifts: Gift[], id: string): string {
  return gifts.find((g) => g.id === id)?.icon ?? '🎁';
}

export function WalletCard() {
  const { t } = useTranslation();

  const [balance, setBalance] = useState(0);
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [history, setHistory] = useState<CreditTx[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [proMonths, setProMonths] = useState(1);
  const [sendTo, setSendTo] = useState('');
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [received, setReceived] = useState<GiftEvent[]>([]);
  const [payoutCoins, setPayoutCoins] = useState('');
  const [payoutEmail, setPayoutEmail] = useState('');

  const refresh = useCallback(() => {
    creditBalance()
      .then((b) => {
        setBalance(b);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    fetchPayoutAccount()
      .then((a) => {
        setAccount(a);
        if (a?.email) {
          setPayoutEmail(a.email);
        }
      })
      .catch(() => {});
    creditHistory(12).then(setHistory).catch(() => {});
    myPayoutRequests(5).then(setPayouts).catch(() => {});
    listGifts().then(setGifts).catch(() => {});
    receivedGifts(8).then(setReceived).catch(() => {});
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
        Alert.alert(t('common.error'), (e as Error).message);
      }
    });

  const onPayPro = () =>
    guard(async () => {
      try {
        const res = await subscribeProWithCredits(proMonths);
        setBalance(res.balance);
        refresh();
        Alert.alert(t('wallet.proDoneTitle'), t('wallet.proDoneMsg', { months: proMonths }));
      } catch (e) {
        if (e instanceof InsufficientCreditsError) {
          toShop();
        } else {
          Alert.alert(t('common.error'), (e as Error).message);
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
        if (e instanceof InsufficientCreditsError) {
          toShop();
        } else if (e instanceof RecipientNotFoundError) {
          Alert.alert(t('common.error'), t('wallet.recipientNotFound'));
        } else if (e instanceof SelfSendError) {
          Alert.alert(t('common.error'), t('wallet.cannotSendToSelf'));
        } else if (e instanceof GiftNotFoundError) {
          Alert.alert(t('common.error'), t('wallet.gift.notFound'));
        } else {
          Alert.alert(t('common.error'), (e as Error).message);
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
      t('wallet.gift.confirmMsg', { icon: gift.icon, name: gift.name, coins: gift.costCoins, user: to }),
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
        setAccount({ provider: 'paypal', email: payoutEmail.trim() });
        Alert.alert(t('wallet.accountSavedTitle'), t('wallet.accountSavedMsg'));
      } catch (e) {
        Alert.alert(t('common.error'), (e as Error).message);
      }
    });

  const onCashout = () =>
    guard(async () => {
      const coins = Math.trunc(Number(payoutCoins) || 0);
      if (coins <= 0) {
        return;
      }
      try {
        const res = await requestPayout(coins);
        setBalance(res.balance);
        setPayoutCoins('');
        refresh();
        Alert.alert(
          res.status === 'paid' ? t('wallet.payoutPaidTitle') : t('wallet.payoutPendingTitle'),
          t('wallet.payoutMsg', { amount: res.amountHuf, currency: CURRENCY })
        );
      } catch (e) {
        if (e instanceof NoPayoutAccountError) {
          Alert.alert(t('common.error'), t('wallet.noPayoutAccount'));
        } else if (e instanceof InsufficientCreditsError) {
          toShop();
        } else if (e instanceof BelowMinPayoutError) {
          Alert.alert(t('common.error'), t('wallet.belowMin', { min: MIN_PAYOUT_COINS }));
        } else {
          Alert.alert(t('common.error'), (e as Error).message);
        }
      }
    });

  const cashoutCoins = Math.trunc(Number(payoutCoins) || 0);
  const cashoutHuf = cashoutCoins * COIN_CASHOUT_HUF;
  const proCost = PRO_MONTHLY_COINS * proMonths;

  return (
    <>
      <Text style={styles.sectionTitle}>{t('wallet.section')}</Text>
      <Text style={styles.sectionHint}>
        {t('wallet.rates', { buy: COIN_BUY_HUF, cashout: COIN_CASHOUT_HUF, currency: CURRENCY })}
      </Text>
      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator color={palette.accent} />
        ) : (
          <>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>{t('wallet.balance')}</Text>
              <Text style={styles.balanceValue}>{balance} 🪙</Text>
            </View>

            {/* koin-vétel (dev: worker-grant; élesben IAP/áruház) */}
            {__DEV__ ? (
              <View style={styles.rowWrap}>
                <Pressable onPress={() => onBuyDev(100)} disabled={busy} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>+100 🪙 (dev)</Text>
                </Pressable>
                <Pressable onPress={() => onBuyDev(500)} disabled={busy} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>+500 🪙 (dev)</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.dim}>{t('wallet.buyHint', { huf: COIN_BUY_HUF, currency: CURRENCY })}</Text>
            )}
          </>
        )}
      </View>

      {/* Pro fizetése koinnal */}
      <View style={styles.card}>
        <Text style={styles.blockTitle}>{t('wallet.payProTitle')}</Text>
        <Text style={styles.dim}>{t('wallet.payProHint', { coins: PRO_MONTHLY_COINS })}</Text>
        <Stepper label={t('wallet.months')} value={proMonths} min={1} max={12} onChange={setProMonths} />
        <View style={styles.costRow}>
          <Text style={styles.costText}>
            {proMonths} {t('wallet.monthsShort')} · Pro
          </Text>
          <Text style={styles.costCoins}>{proCost} 🪙</Text>
        </View>
        <PrimaryButton
          icon="rocket"
          label={busy ? t('wallet.working') : t('wallet.payProCta')}
          onPress={onPayPro}
          disabled={busy}
        />
      </View>

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
              <Text style={styles.giftCost}>{g.costCoins} 🪙</Text>
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
          {t('wallet.cashoutHint', { rate: COIN_CASHOUT_HUF, currency: CURRENCY, min: MIN_PAYOUT_COINS })}
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
        <TextInput
          value={payoutCoins}
          onChangeText={setPayoutCoins}
          placeholder={t('wallet.coinsPlaceholder')}
          placeholderTextColor={palette.textDim}
          keyboardType="number-pad"
          style={styles.input}
        />
        <View style={styles.costRow}>
          <Text style={styles.costText}>
            {cashoutCoins} 🪙 → {cashoutHuf} {CURRENCY}
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
                {p.coins} 🪙 → {p.amountHuf} {CURRENCY} ·{' '}
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
                color={h.delta >= 0 ? palette.accent : palette.textDim}
              />
              <Text style={styles.histKind} numberOfLines={1}>
                {t(`wallet.kind.${h.kind}`, { defaultValue: h.kind })}
                {h.note ? ` · ${h.note}` : ''}
              </Text>
              <Text style={[styles.histDelta, { color: h.delta >= 0 ? '#39d98a' : palette.danger }]}>
                {h.delta >= 0 ? '+' : ''}
                {h.delta} 🪙
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="remove" size={16} color={palette.text} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="add" size={16} color={palette.text} />
      </Pressable>
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
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperLabel: { color: palette.textDim, fontSize: 13, flex: 1 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { color: palette.text, fontSize: 15, fontWeight: '800', minWidth: 28, textAlign: 'center' },
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
