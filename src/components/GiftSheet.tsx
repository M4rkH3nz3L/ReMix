import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { InsufficientCreditsError, creditBalance } from '@/lib/shop';
import {
  type Gift,
  GiftNotFoundError,
  RecipientNotFoundError,
  SelfSendError,
  listGifts,
  sendGift,
} from '@/lib/wallet';

/**
 * 🎁 Ajándék-lap (TikTok-modell): egy ISMERT címzettnek (creator / poszt szerzője)
 * küldünk ajándékot a katalógusból. A koin-küldés csak így megy (nincs közvetlen,
 * tetszőleges összegű átutalás). A `postId` opcionálisan rögzíti, melyik poszton
 * ment (feed). Újrahasznosítható: feed-sáv, creator-csatorna, később élő.
 */
export function GiftSheet({
  visible,
  toUsername,
  toName,
  postId,
  onClose,
  onSent,
}: {
  visible: boolean;
  toUsername: string;
  toName?: string;
  postId?: string | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    listGifts().then(setGifts).catch(() => {});
    creditBalance().then(setBalance).catch(() => {});
  }, [visible]);

  const onPick = (gift: Gift) => {
    if (busy || !toUsername) {
      return;
    }
    Alert.alert(
      t('wallet.gift.confirmTitle'),
      t('wallet.gift.confirmMsg', {
        icon: gift.icon,
        name: gift.name,
        coins: gift.costCoins,
        user: toName || toUsername,
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('wallet.gift.send'),
          onPress: async () => {
            setBusy(true);
            try {
              const res = await sendGift(toUsername, gift.id, { postId: postId ?? null });
              setBalance(res.balance);
              onSent?.();
              onClose();
              Alert.alert(
                t('wallet.gift.sentTitle'),
                t('wallet.gift.sentMsg', { icon: gift.icon, name: gift.name, user: toName || toUsername })
              );
            } catch (e) {
              if (e instanceof InsufficientCreditsError) {
                Alert.alert(t('wallet.notEnoughTitle'), t('wallet.notEnoughMsg'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('wallet.goToShop'), onPress: () => router.push('/profile') },
                ]);
              } else if (e instanceof RecipientNotFoundError) {
                Alert.alert(t('common.error'), t('wallet.recipientNotFound'));
              } else if (e instanceof SelfSendError) {
                Alert.alert(t('common.error'), t('wallet.cannotSendToSelf'));
              } else if (e instanceof GiftNotFoundError) {
                Alert.alert(t('common.error'), t('wallet.gift.notFound'));
              } else {
                Alert.alert(t('common.error'), (e as Error).message);
              }
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} />
        <View style={styles.card}>
          <Text style={styles.title}>{t('wallet.gift.sendTo', { user: toName || toUsername })}</Text>
          <Text style={styles.balance}>
            {t('wallet.balance')}: {balance} 🪙
          </Text>
          {gifts.length === 0 ? (
            <ActivityIndicator color={palette.accent} style={{ marginVertical: 16 }} />
          ) : (
            <View style={styles.grid}>
              {gifts.map((g) => (
                <Pressable key={g.id} onPress={() => onPick(g)} disabled={busy} style={styles.chip}>
                  <Text style={styles.icon}>{g.icon}</Text>
                  <Text style={styles.cost}>{g.costCoins} 🪙</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable onPress={onClose} style={styles.dismiss}>
            <Text style={styles.dismissText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  balance: { color: palette.textDim, fontSize: 12, marginTop: 2, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    gap: 2,
  },
  icon: { fontSize: 26 },
  cost: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  dismiss: { alignItems: 'center', paddingTop: 14 },
  dismissText: { color: palette.textDim, fontSize: 14, fontWeight: '600' },
});
