import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatEur } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { listOpenInvoices, listPendingOrgs, markInvoicePaid, reviewOrg, type OpenInvoice, type PendingOrg } from '@/lib/org';

/**
 * 🏢 Pénzügyi admin (`finance.manage`, PRO-CASH C4.2/C4.4): a cégek kézi jóváhagyása a VIES- és
 * domain-eredménnyel, és a beérkezett átutalások „fizetve” jelölése (ez aktiválja az előfizetést).
 */
export function FinanceReviewList() {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<PendingOrg[]>([]);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listPendingOrgs().then(setOrgs).catch((caught) => { logCaught('components/admin/FinanceReviewList.tsx:orgs', caught); });
    listOpenInvoices().then(setInvoices).catch((caught) => { logCaught('components/admin/FinanceReviewList.tsx:invoices', caught); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = (fn: () => Promise<unknown>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    fn()
      .then(load)
      .catch((e: unknown) => {
        logCaught('components/admin/FinanceReviewList.tsx:act', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => setBusy(false));
  };
  const mark = (v: boolean | null) => (v == null ? '—' : v ? '✓' : '✗');

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('admin.orgs.title')}</Text>
      {orgs.length === 0 ? <Text style={styles.dim}>{t('admin.orgs.empty')}</Text> : null}
      {orgs.map((o) => (
        <View key={o.id} style={styles.card}>
          <Text style={styles.line}>{o.name} · {o.country}</Text>
          <Text style={styles.dim}>
            {o.vatId ?? '—'} · {o.regNumber ?? '—'} · VIES {mark(o.vies)} · {t('admin.orgs.domain')} {mark(o.domainOk)}
          </Text>
          <View style={styles.row}>
            <Pressable onPress={() => act(() => reviewOrg(o.id, true))} disabled={busy} style={[styles.btn, styles.ok]}>
              <Text style={styles.btnText}>{t('admin.payouts.approve')}</Text>
            </Pressable>
            <Pressable onPress={() => act(() => reviewOrg(o.id, false))} disabled={busy} style={styles.btn}>
              <Text style={styles.btnText}>{t('admin.payouts.reject')}</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Text style={[styles.title, { marginTop: 10 }]}>{t('admin.orgs.invoicesTitle')}</Text>
      {invoices.length === 0 ? <Text style={styles.dim}>{t('admin.orgs.invoicesEmpty')}</Text> : null}
      {invoices.map((i) => (
        <View key={i.id} style={styles.card}>
          <Text style={styles.line}>{i.number} · {i.orgName} · {formatEur(i.grossCents / 100)}</Text>
          <Text style={styles.dim}>{t('admin.orgs.due', { date: new Date(i.dueAt).toLocaleDateString() })}</Text>
          <Pressable onPress={() => act(() => markInvoicePaid(i.id))} disabled={busy} style={[styles.btn, styles.ok]}>
            <Text style={styles.btnText}>{t('admin.orgs.markPaid')}</Text>
          </Pressable>
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
