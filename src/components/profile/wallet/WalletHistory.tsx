import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/profile/wallet/walletStyles';
import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';
import type { CreditTx } from '@/lib/wallet';
import { KIND_ICON } from '@/lib/walletCardOps';

/** 🧾 a Coin-tranzakciók előzménye (a WalletCard.tsx-ből kiemelve) */
export function WalletHistory({ history }: { history: CreditTx[] }) {
  const { t } = useTranslation();
  return (
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
  );
}
