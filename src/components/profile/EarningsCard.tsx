import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatCoins, formatEur, payoutEur, type EarningsMonth } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { downloadEarningsStatement, fetchEarnings } from '@/lib/wallet';

const KINDS = ['sale', 'gift', 'commission', 'referral', 'fund'] as const;

/**
 * 📊 Bevételi panel (PRO-CASH 6.3, C3.5): az utolsó hónapok megkeresett Coinja forrásonként,
 * euróban is (a beváltási áron), és az éves kimutatás letöltése az adóbevalláshoz.
 */
export function EarningsCard({ refreshKey }: { refreshKey: number }) {
  const { t } = useTranslation();
  const [months, setMonths] = useState<EarningsMonth[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchEarnings(6)
      .then(setMonths)
      .catch((caught) => { logCaught('components/profile/EarningsCard.tsx:load', caught); });
  }, [refreshKey]);

  if (months.length === 0) {
    return null;
  }

  const year = Number(months[0].month.slice(0, 4));
  const onStatement = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    downloadEarningsStatement(year)
      .catch((e: unknown) => {
        logCaught('components/profile/EarningsCard.tsx:statement', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('wallet.earnings.title')}</Text>
      {months.map((m) => (
        <View key={m.month} style={styles.month}>
          <View style={styles.row}>
            <Text style={styles.monthName}>{m.month}</Text>
            <Text style={styles.total}>
              {formatCoins(m.totalCents)} 🪙 ≈ {formatEur(payoutEur(m.totalCents))}
            </Text>
          </View>
          <Text style={styles.dim}>
            {KINDS.filter((k) => m.byKind[k])
              .map((k) => `${t(`wallet.earnings.kind.${k}`)} ${formatCoins(m.byKind[k] ?? 0)}`)
              .join(' · ')}
          </Text>
        </View>
      ))}
      <Pressable onPress={onStatement} disabled={busy} style={styles.link} accessibilityRole="button">
        <Ionicons name="document-text-outline" size={15} color={palette.accent} />
        <Text style={styles.linkText}>{t('wallet.earnings.statement', { year })}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14, marginBottom: 10, gap: 8 },
  title: { color: palette.text, fontSize: 14, fontWeight: '800' },
  month: { gap: 2, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  monthName: { color: palette.text, fontSize: 13, fontWeight: '700' },
  total: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  dim: { color: palette.textDim, fontSize: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: palette.accent, fontSize: 13, fontWeight: '700' },
});
