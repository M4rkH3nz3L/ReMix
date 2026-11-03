import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { supabase } from '@/lib/supabase';
import { claimReferral, myReferralStats } from '@/lib/wallet';
import { useAuth } from '@/store/authStore';

const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 🤝 Ajánlói program (PRO-CASH 6.1, C3.6): a meghívó-név a felhasználónév; a meghívott Coinból
 * fizetett előfizetéséből az első hónapra 50%, utána 12 hónapig 10% jár (megkeresett Coin,
 * 30 nap tartással). Az ajánló a regisztrációt követő 7 napon belül egyszer adható meg.
 */
export function ReferralCard() {
  const { t } = useTranslation();
  const userId = useAuth((s) => s.user?.id ?? null);
  const userCreatedAt = useAuth((s) => s.user?.created_at ?? null);
  const [username, setUsername] = useState<string | null>(null);
  const [stats, setStats] = useState({ invited: 0, earnedCents: 0 });
  const [code, setCode] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  // a 7 napos ablak a megjelenéskor dől el (a regisztráció ideje nem változik)
  const [inWindow] = useState(() => {
    const createdAt = userCreatedAt ? Date.parse(userCreatedAt) : NaN;
    return Number.isFinite(createdAt) && Date.now() - createdAt < CLAIM_WINDOW_MS;
  });

  const load = useCallback(() => {
    if (!supabase || !userId) {
      return;
    }
    supabase
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setUsername((data as { username?: string } | null)?.username ?? null));
    supabase
      .from('referrals')
      .select('referred_id')
      .eq('referred_id', userId)
      .maybeSingle()
      .then(({ data }) => setClaimed(!!data));
    myReferralStats().then(setStats).catch((caught) => { logCaught('components/profile/ReferralCard.tsx:load', caught); });
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const canClaim = !claimed && inWindow;

  const onClaim = () => {
    if (busy || !code.trim()) {
      return;
    }
    setBusy(true);
    claimReferral(code)
      .then(() => {
        setClaimed(true);
        Alert.alert(t('wallet.referral.claimedTitle'), t('wallet.referral.claimedMsg'));
      })
      .catch((e: unknown) => {
        logCaught('components/profile/ReferralCard.tsx:onClaim', e);
        const key = e instanceof Error ? e.message : '';
        Alert.alert(t('common.error'), t(`wallet.referral.error.${key}`, { defaultValue: key }));
      })
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('wallet.referral.title')}</Text>
      <Text style={styles.dim}>{t('wallet.referral.hint')}</Text>
      {username ? <Text style={styles.code}>@{username}</Text> : null}
      <Text style={styles.dim}>
        {t('wallet.referral.stats', { n: stats.invited, coins: formatCoins(stats.earnedCents) })}
      </Text>
      {canClaim ? (
        <View style={styles.claim}>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder={t('wallet.referral.placeholder')}
            placeholderTextColor={palette.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Pressable onPress={onClaim} disabled={busy} style={styles.btn} accessibilityRole="button">
            <Text style={styles.btnText}>{t('wallet.referral.claim')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14, marginBottom: 10, gap: 8 },
  title: { color: palette.text, fontSize: 14, fontWeight: '800' },
  dim: { color: palette.textDim, fontSize: 12 },
  code: { color: palette.accent, fontSize: 18, fontWeight: '900' },
  claim: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 14,
  },
  btn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.accent, justifyContent: 'center' },
  btnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
