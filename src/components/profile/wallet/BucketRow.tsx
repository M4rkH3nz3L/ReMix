import { Text, View } from 'react-native';

import { styles } from '@/components/profile/wallet/walletStyles';
import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';

/** egy alegyenleg-sor (a WalletCard.tsx-ből kiemelve) */
export function BucketRow({ label, cents, note, strong }: { label: string; cents: number; note?: string; strong?: boolean }) {
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
