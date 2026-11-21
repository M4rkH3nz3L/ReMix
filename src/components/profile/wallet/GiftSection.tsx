import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { styles } from '@/components/profile/wallet/walletStyles';
import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';
import type { Gift, GiftEvent } from '@/lib/wallet';
import { giftIcon } from '@/lib/walletCardOps';

/** 🎁 ajándék küldése (TikTok-modell): címzett + gift-katalógus (a WalletCard.tsx-ből kiemelve) */
export function GiftSection({
  sendTo,
  setSendTo,
  gifts,
  received,
  busy,
  onPickGift,
}: {
  sendTo: string;
  setSendTo: (v: string) => void;
  gifts: Gift[];
  received: GiftEvent[];
  busy: boolean;
  onPickGift: (gift: Gift) => void;
}) {
  const { t } = useTranslation();
  return (
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
  );
}
