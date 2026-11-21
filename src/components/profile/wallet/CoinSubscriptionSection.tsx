import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/profile/wallet/walletStyles';
import { PrimaryButton } from '@/components/ui/controls';
import { formatCoins } from '@/lib/coins';
import { tierLabelKey, type Tier } from '@/lib/tiers';
import { COIN_TIERS } from '@/lib/walletCardOps';

/** 🚀 előfizetés Coinból: szint + havi/éves (a WalletCard.tsx-ből kiemelve) */
export function CoinSubscriptionSection({
  subTier,
  setSubTier,
  annual,
  setAnnual,
  subCost,
  busy,
  onSubscribe,
}: {
  subTier: Exclude<Tier, 'free' | 'business'>;
  setSubTier: (tier: Exclude<Tier, 'free' | 'business'>) => void;
  annual: boolean;
  setAnnual: (v: boolean) => void;
  subCost: number;
  busy: boolean;
  onSubscribe: () => void;
}) {
  const { t } = useTranslation();
  return (
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
  );
}
