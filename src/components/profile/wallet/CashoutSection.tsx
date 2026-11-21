import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/profile/wallet/walletStyles';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { COIN_PAYOUT_EUR, MIN_PAYOUT_CENTS, formatCoins, formatEur, payoutEur } from '@/lib/coins';
import type { PayoutAccount, PayoutRequest } from '@/lib/wallet';

/** 💶 kiváltás pénzre: PayPal-fiók, KYC, összeg, korábbi kifizetések (a WalletCard.tsx-ből kiemelve) */
export function CashoutSection({
  payoutEmail,
  setPayoutEmail,
  account,
  busy,
  onSaveAccount,
  onKyc,
  payoutCoins,
  setPayoutCoins,
  cashoutCents,
  onCashout,
  payouts,
}: {
  payoutEmail: string;
  setPayoutEmail: (v: string) => void;
  account: PayoutAccount | null;
  busy: boolean;
  onSaveAccount: () => void;
  onKyc: () => void;
  payoutCoins: string;
  setPayoutCoins: (v: string) => void;
  cashoutCents: number;
  onCashout: () => void;
  payouts: PayoutRequest[];
}) {
  const { t } = useTranslation();
  return (
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
  );
}
