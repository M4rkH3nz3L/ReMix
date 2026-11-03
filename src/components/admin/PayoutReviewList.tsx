import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatCoins, formatEur } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { listPayoutsUnderReview, reviewPayout, type PayoutReviewRow } from '@/lib/wallet';

/**
 * 💸 Kifizetések kézi ellenőrzése (PRO-CASH C3.4) — `payout.review` jogú adminnak. A lista a
 * csalásszűrő jelzőit mutatja (gyűrű, friss fiókok, koncentráció, közös eszköz, ellenőrzésre
 * jelölt fiók); a döntést a DB `review_payout` hozza (a saját kérését senki nem bírálhatja el).
 */
export function PayoutReviewList() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PayoutReviewRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listPayoutsUnderReview()
      .then(setRows)
      .catch((caught) => { logCaught('components/admin/PayoutReviewList.tsx:load', caught); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = (row: PayoutReviewRow, approve: boolean) => {
    if (busy) {
      return;
    }
    setBusy(true);
    reviewPayout(row.id, approve)
      .then(load)
      .catch((e: unknown) => {
        logCaught('components/admin/PayoutReviewList.tsx:decide', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('admin.payouts.title')}</Text>
      {rows.length === 0 ? <Text style={styles.dim}>{t('admin.payouts.empty')}</Text> : null}
      {rows.map((r) => (
        <View key={r.id} style={styles.card}>
          <Text style={styles.line}>
            @{r.username ?? '—'} · {formatCoins(r.cents)} 🪙 → {formatEur(r.amountEurCents / 100)}
          </Text>
          <Text style={styles.dim}>
            {r.riskFlags.map((f) => t(`admin.payouts.flag.${f}`, { defaultValue: f })).join(' · ')}
          </Text>
          <View style={styles.row}>
            <Pressable onPress={() => decide(r, true)} disabled={busy} style={[styles.btn, styles.ok]} accessibilityRole="button">
              <Text style={styles.btnText}>{t('admin.payouts.approve')}</Text>
            </Pressable>
            <Pressable onPress={() => decide(r, false)} disabled={busy} style={styles.btn} accessibilityRole="button">
              <Text style={styles.btnText}>{t('admin.payouts.reject')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 18 },
  title: { color: palette.text, fontSize: 15, fontWeight: '800' },
  dim: { color: palette.textDim, fontSize: 12 },
  card: { backgroundColor: palette.surface, borderRadius: 12, borderWidth: 1, borderColor: palette.border, padding: 12, gap: 6 },
  line: { color: palette.text, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  ok: { borderColor: palette.accent },
  btnText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});
