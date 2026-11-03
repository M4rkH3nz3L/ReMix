import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';

/**
 * 💶 A webes Coin-feltöltés visszatérési oldala (PRO-CASH C1.5): a Stripe Checkout ide küld
 * vissza `?status=ok|cancel`-lel. A jóváírást a Stripe webhook végzi (nem ez az oldal), ezért
 * itt csak tájékoztatunk, és a pénztárcához irányítunk.
 */
export default function CoinsReturnScreen() {
  const { t } = useTranslation();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const ok = status === 'ok';
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.box}>
        <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={56} color={ok ? palette.accent : palette.textDim} />
        <Text style={styles.title}>{ok ? t('wallet.topup.webOkTitle') : t('wallet.topup.webCancelTitle')}</Text>
        <Text style={styles.body}>{ok ? t('wallet.topup.webOkMsg') : t('wallet.topup.webCancelMsg')}</Text>
        <PrimaryButton icon="wallet" label={t('wallet.topup.toWallet')} onPress={() => router.replace('/profile')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg, justifyContent: 'center', padding: 16 },
  box: { alignItems: 'center', gap: 12, maxWidth: 420, width: '100%', alignSelf: 'center' },
  title: { color: palette.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: palette.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
