import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text } from 'react-native';

import { EarningsCard } from '@/components/profile/EarningsCard';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { SubscriptionManageCard } from '@/components/profile/SubscriptionManageCard';
import { CashoutSection } from '@/components/profile/wallet/CashoutSection';
import { CoinSubscriptionSection } from '@/components/profile/wallet/CoinSubscriptionSection';
import { GiftSection } from '@/components/profile/wallet/GiftSection';
import { WalletBalanceSection } from '@/components/profile/wallet/WalletBalanceSection';
import { WalletHistory } from '@/components/profile/wallet/WalletHistory';
import { createWalletActions } from '@/components/profile/wallet/walletActions';
import { styles } from '@/components/profile/wallet/walletStyles';
import { palette } from '@/constants/editor';
import { billingClientAvailable } from '@/lib/billing';
import {
  webTopupAvailable,
  EMPTY_WALLET,
  coinsToCents,
  subscriptionCostCents,
  type WalletBreakdown,
} from '@/lib/coins';
import type { Tier } from '@/lib/tiers';
import {
  type CreditTx,
  type Gift,
  type GiftEvent,
  type PayoutAccount,
  type PayoutRequest,
  creditHistory,
  fetchPayoutAccount,
  fetchWallet,
  listGifts,
  myPayoutRequests,
  receivedGifts,
} from '@/lib/wallet';
import { subscriptionMonths } from '@/lib/walletCardOps';
import { logCaught } from '@/lib/logCaught';
import { useWalletEvents } from '@/store/walletEvents';

/**
 * 🪙 A pénztárca-kártya: a gyökér az állapotot (eredeti hook-sorrendben), a frissítést és a
 * kompozíciót tartja; az akciók a wallet/walletActions.ts-ben, a szekciók a wallet/ alatt.
 */
export function WalletCard() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne (a try/finally-s guard a walletActions-be
  // került), de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS). Addig szándékosan kimarad.
  'use no memo';
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

  // a dev-admin és a vásárlások után újratöltünk (a jelzőt a walletEvents store adja)
  const walletTick = useWalletEvents((s) => s.tick);
  useEffect(() => {
    refresh();
  }, [refresh, walletTick]);

  const { onBuyDev, onBuyPack, onSubscribe, onPickGift, onSaveAccount, onKyc, onCashout } = createWalletActions({
    t,
    busy,
    setBusy,
    setBalance,
    setAccount,
    setSubKey,
    setSendTo,
    setPayoutCoins,
    refresh,
    subTier,
    annual,
    sendTo,
    payoutEmail,
    payoutCoins,
  });

  const storeTopup = billingClientAvailable();
  const webTopup = webTopupAvailable(Platform.OS, process.env.EXPO_PUBLIC_WEB_TOPUP_LINKOUT);

  const cashoutCents = coinsToCents(payoutCoins);
  const subCost = subscriptionCostCents(subTier, subscriptionMonths(annual));

  return (
    <>
      <WalletBalanceSection
        wallet={wallet}
        balance={balance}
        loading={loading}
        busy={busy}
        storeTopup={storeTopup}
        webTopup={webTopup}
        onBuyDev={onBuyDev}
        onBuyPack={onBuyPack}
      />

      {/* céges fiók (Vállalati, PRO-CASH 5.) */}
      <Pressable onPress={() => router.push('/org')} style={styles.linkBtn} accessibilityRole="button">
        <Ionicons name="business-outline" size={15} color={palette.accent} />
        <Text style={styles.linkText}>{t('org.entry')}</Text>
      </Pressable>

      {/* az előfizetésem: lejárat, lemondás, add-onok */}
      <SubscriptionManageCard onChanged={refresh} refreshKey={subKey + walletTick} />

      {/* előfizetés Coinból: szint + havi/éves */}
      <CoinSubscriptionSection
        subTier={subTier}
        setSubTier={setSubTier}
        annual={annual}
        setAnnual={setAnnual}
        subCost={subCost}
        busy={busy}
        onSubscribe={onSubscribe}
      />

      {/* bevételi panel */}
      <EarningsCard refreshKey={subKey + walletTick} />

      {/* ajánlói program */}
      <ReferralCard />

      {/* ajándék küldése (TikTok-modell): címzett + gift-katalógus */}
      <GiftSection
        sendTo={sendTo}
        setSendTo={setSendTo}
        gifts={gifts}
        received={received}
        busy={busy}
        onPickGift={onPickGift}
      />

      {/* kiváltás pénzre */}
      <CashoutSection
        payoutEmail={payoutEmail}
        setPayoutEmail={setPayoutEmail}
        account={account}
        busy={busy}
        onSaveAccount={onSaveAccount}
        onKyc={onKyc}
        payoutCoins={payoutCoins}
        setPayoutCoins={setPayoutCoins}
        cashoutCents={cashoutCents}
        onCashout={onCashout}
        payouts={payouts}
      />

      {/* előzmények */}
      {history.length > 0 ? <WalletHistory history={history} /> : null}
    </>
  );
}
