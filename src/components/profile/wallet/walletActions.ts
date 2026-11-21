import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert, Platform } from 'react-native';

import type { InFlightLock } from '@/lib/asyncGuard';
import { PurchaseCancelledError, purchaseCoinPack } from '@/lib/billing';
import { MIN_PAYOUT_CENTS, coinsToCents, formatCoins, formatEur, moneyErrorText } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { InsufficientCreditsError, buyCreditsDev } from '@/lib/shop';
import { tierLabelKey, type Tier } from '@/lib/tiers';
import {
  type Gift,
  GiftNotFoundError,
  InsufficientEarnedError,
  KycRequiredError,
  ManagedByStoreError,
  NoPayoutAccountError,
  type PayoutAccount,
  PayoutWeeklyLimitError,
  RecipientNotFoundError,
  SelfSendError,
  BelowMinPayoutError,
  requestPayout,
  sendGift,
  setPayoutAccount,
  startStripeKyc,
  startWebTopup,
  subscribeWithCoins,
} from '@/lib/wallet';
import { savedPayoutAccount, subscriptionMonths } from '@/lib/walletCardOps';

/** a pénztárca-akciók bemenete: a render-kori állapot + a setterek (a WalletCard gyökeréből) */
export interface WalletActionDeps {
  t: TFunction;
  busy: boolean;
  /** szinkron „egyszerre egy” zár (a gyökér egyszer hozza létre) — a dupla koppintás ellen */
  inFlight: InFlightLock;
  setBusy: (v: boolean) => void;
  setBalance: (b: number) => void;
  setAccount: Dispatch<SetStateAction<PayoutAccount | null>>;
  setSubKey: Dispatch<SetStateAction<number>>;
  setSendTo: (v: string) => void;
  setPayoutCoins: (v: string) => void;
  refresh: () => void;
  subTier: Exclude<Tier, 'free' | 'business'>;
  annual: boolean;
  sendTo: string;
  payoutEmail: string;
  payoutCoins: string;
}

/**
 * 🪙 A pénztárca hook nélküli akciói (a WalletCard.tsx-ből kiemelve, szó szerint): dev-jóváírás,
 * Coin-csomag (áruház / web), előfizetés Coinból, ajándék, kifizetési fiók, KYC, kifizetés.
 * Minden pénzmozgató akció a `guard`-on át fut (egyszerre egy): a render-kori `busy` csak a
 * UI-t tiltja, a tényleges kizárást a szinkron `inFlight` zár adja (két koppintás ugyanabban a
 * renderben is csak EGY pénzmozgató hívást indít).
 */
export function createWalletActions(d: WalletActionDeps) {
  const { t, busy, inFlight, setBusy, setBalance, setAccount, setSubKey, setSendTo, setPayoutCoins, refresh } = d;
  const { subTier, annual, sendTo, payoutEmail, payoutCoins } = d;

  const guard = async (fn: () => Promise<void>) => {
    if (busy || !inFlight.tryAcquire()) {
      return;
    }
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.release();
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
        const months = subscriptionMonths(annual);
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
        setAccount((a) => savedPayoutAccount(a, payoutEmail.trim()));
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

  return { guard, toShop, onBuyDev, onBuyPack, onSubscribe, sendTheGift, onPickGift, onSaveAccount, onKyc, onCashout };
}
