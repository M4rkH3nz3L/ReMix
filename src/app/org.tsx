import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { formatCoins, formatEur } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { goBackOrHome } from '@/lib/nav';
import {
  addMember,
  createOrganization,
  downloadInvoice,
  fetchMyOrg,
  listInvoices,
  removeMember,
  requestInvoice,
  setSeats,
  subscribeOrgWithCoins,
  verifyOrg,
  type MyOrg,
  type OrgInvoice,
} from '@/lib/org';
import { formatBytes } from '@/lib/storageQuota';

/**
 * 🏢 Vállalati konzol (PRO-CASH 5., C4.5) — telefonon, tableten és weben. Szervezet létrehozása,
 * cégellenőrzés (VIES + domain, utána kézi jóváhagyás), előfizetés Coinból vagy átutalásos
 * számlával, ülésszám, tagok, közös tárhely. Az írásokat a DB a szerepkör szerint engedi.
 */
export default function OrgScreen() {
  const { t } = useTranslation();
  const [org, setOrg] = useState<MyOrg | null>(null);
  const [invoices, setInvoices] = useState<OrgInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', country: 'HU', vatId: '', regNumber: '', domain: '', billingEmail: '', billingAddress: '' });
  const [newMember, setNewMember] = useState('');
  const [seats, setSeatsInput] = useState(2);
  const [annual, setAnnual] = useState(false);

  const load = useCallback(() => {
    fetchMyOrg()
      .then((o) => {
        setOrg(o);
        if (o) {
          setSeatsInput(Math.max(o.seats, o.members.length, 2));
          listInvoices().then(setInvoices).catch((caught) => { logCaught('app/org.tsx:invoices', caught); });
        }
      })
      .catch((caught) => { logCaught('app/org.tsx:load', caught); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = (fn: () => Promise<unknown>, done?: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    fn()
      .then(() => {
        if (done) {
          Alert.alert(t('org.title'), done);
        }
        load();
      })
      .catch((e: unknown) => {
        logCaught('app/org.tsx:run', e);
        const key = e instanceof Error ? e.message : String(e);
        Alert.alert(t('common.error'), t(`org.error.${key.replace(/\s/g, '_')}`, { defaultValue: key }));
      })
      .finally(() => setBusy(false));
  };

  const isAdmin = org?.myRole === 'owner' || org?.myRole === 'admin';
  const field = (key: keyof typeof form, label: string, opts: { autoCapitalize?: 'none' | 'characters' } = {}) => (
    <TextInput
      key={key}
      value={form[key]}
      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
      placeholder={label}
      placeholderTextColor={palette.textDim}
      autoCapitalize={opts.autoCapitalize ?? 'sentences'}
      autoCorrect={false}
      style={styles.input}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={styles.back} accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('org.title')}</Text>
        <View style={styles.back} />
      </View>
      {loading ? (
        <ActivityIndicator color={palette.accent} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {!org ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('org.createTitle')}</Text>
              <Text style={styles.dim}>{t('org.createHint')}</Text>
              {field('name', t('org.field.name'))}
              {field('country', t('org.field.country'), { autoCapitalize: 'characters' })}
              {field('vatId', t('org.field.vatId'), { autoCapitalize: 'characters' })}
              {field('regNumber', t('org.field.regNumber'), { autoCapitalize: 'none' })}
              {field('domain', t('org.field.domain'), { autoCapitalize: 'none' })}
              {field('billingEmail', t('org.field.billingEmail'), { autoCapitalize: 'none' })}
              {field('billingAddress', t('org.field.billingAddress'))}
              <PrimaryButton
                icon="business"
                label={t('org.createCta')}
                disabled={busy || form.name.trim().length < 2 || !/^[A-Za-z]{2}$/.test(form.country)}
                onPress={() => run(() => createOrganization(form), t('org.created'))}
              />
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{org.name}</Text>
                <Text style={styles.dim}>
                  {org.country} · {org.vatId ?? '—'} · {t(`org.status.${org.status}`)}
                </Text>
                <Text style={styles.dim}>
                  {t('org.vies')}: {org.vies == null ? '—' : org.vies ? '✓' : '✗'} · {t('org.domain')}: {org.domainOk == null ? '—' : org.domainOk ? '✓' : '✗'}
                </Text>
                {isAdmin && org.status === 'pending' ? (
                  <Pressable onPress={() => run(verifyOrg, t('org.verifySent'))} disabled={busy} style={styles.link}>
                    <Ionicons name="shield-checkmark-outline" size={15} color={palette.accent} />
                    <Text style={styles.linkText}>{t('org.verifyCta')}</Text>
                  </Pressable>
                ) : null}
                {org.status === 'pending' ? <Text style={styles.dim}>{t('org.pendingHint')}</Text> : null}
              </View>

              {/* előfizetés és ülések */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('org.planTitle')}</Text>
                <Text style={styles.dim}>
                  {org.active
                    ? t('org.activeUntil', { date: org.until ? new Date(org.until).toLocaleDateString() : '—', seats: org.seats })
                    : t('org.inactive')}
                  {org.pendingSeats ? ` · ${t('org.pendingSeats', { n: org.pendingSeats })}` : ''}
                </Text>
                <Text style={styles.dim}>{t('org.seatPrice', { coins: formatCoins(org.seatPriceCents), eur: formatEur((org.seatPriceCents / 100) * 5) })}</Text>
                <Text style={styles.dim}>
                  {t('org.storage', { used: formatBytes(org.storageUsedBytes), quota: formatBytes(org.storageQuotaBytes) })}
                </Text>
                {isAdmin && org.status === 'verified' ? (
                  <>
                    <View style={styles.row}>
                      <Text style={styles.label}>{t('org.seats')}</Text>
                      <Pressable onPress={() => setSeatsInput((n) => Math.max(2, n - 1))} hitSlop={8} style={styles.step}>
                        <Ionicons name="remove" size={16} color={palette.text} />
                      </Pressable>
                      <Text style={styles.stepValue}>{seats}</Text>
                      <Pressable onPress={() => setSeatsInput((n) => n + 1)} hitSlop={8} style={styles.step}>
                        <Ionicons name="add" size={16} color={palette.text} />
                      </Pressable>
                    </View>
                    {org.active ? (
                      <PrimaryButton icon="people" label={t('org.setSeatsCta')} disabled={busy || seats === org.seats}
                        onPress={() => run(() => setSeats(org.id, seats), t('org.seatsSaved'))} />
                    ) : (
                      <>
                        <View style={styles.row}>
                          {[false, true].map((a) => (
                            <Pressable key={String(a)} onPress={() => setAnnual(a)} style={[styles.chip, annual === a && styles.chipOn]}>
                              <Text style={styles.chipText}>{a ? t('wallet.annual') : t('wallet.monthly')}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <PrimaryButton icon="wallet" label={t('org.payCoinsCta', { coins: formatCoins(org.seatPriceCents * seats * (annual ? 10 : 1)) })}
                          disabled={busy} onPress={() => run(() => subscribeOrgWithCoins(org.id, annual ? 12 : 1, seats), t('org.subscribed'))} />
                        <Pressable onPress={() => run(() => requestInvoice(annual ? 12 : 1, seats), t('org.invoiceRequested'))} disabled={busy} style={styles.link}>
                          <Ionicons name="document-text-outline" size={15} color={palette.accent} />
                          <Text style={styles.linkText}>{t('org.invoiceCta')}</Text>
                        </Pressable>
                      </>
                    )}
                  </>
                ) : null}
              </View>

              {/* tagok */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('org.membersTitle', { n: org.members.length, seats: org.seats })}</Text>
                {org.members.map((m) => (
                  <View key={m.userId} style={styles.memberRow}>
                    <Text style={styles.memberName}>
                      @{m.username ?? '—'} · {t(`org.role.${m.role}`)}
                      {m.storageLimitGb != null ? ` · ${m.storageLimitGb} GB` : ''}
                    </Text>
                    {isAdmin && m.role !== 'owner' ? (
                      <Pressable onPress={() => run(() => removeMember(org.id, m.userId))} disabled={busy} hitSlop={10}
                        accessibilityLabel={t('org.removeMember')}>
                        <Ionicons name="remove-circle-outline" size={20} color={palette.textDim} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {isAdmin ? (
                  <View style={styles.row}>
                    <TextInput value={newMember} onChangeText={setNewMember} placeholder={t('org.addPlaceholder')}
                      placeholderTextColor={palette.textDim} autoCapitalize="none" autoCorrect={false} style={[styles.input, { flex: 1 }]} />
                    <Pressable onPress={() => run(async () => { await addMember(org.id, newMember); setNewMember(''); })}
                      disabled={busy || !newMember.trim()} style={styles.chip}>
                      <Text style={styles.chipText}>{t('org.addCta')}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>

              {/* számlák */}
              {invoices.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>{t('org.invoicesTitle')}</Text>
                  {invoices.map((inv) => (
                    <Pressable key={inv.id} onPress={() => run(() => downloadInvoice(inv))} style={styles.memberRow}>
                      <Text style={styles.memberName}>
                        {inv.number} · {formatEur(inv.grossCents / 100)} · {t(`org.invoiceStatus.${inv.status}`)}
                      </Text>
                      <Ionicons name="download-outline" size={18} color={palette.accent} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: palette.text, fontSize: 17, fontWeight: '800' },
  scroll: { padding: 16, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14, gap: 8 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '800' },
  dim: { color: palette.textDim, fontSize: 12 },
  input: {
    backgroundColor: palette.surfaceHigh, borderRadius: 10, borderWidth: 1, borderColor: palette.border,
    color: palette.text, paddingHorizontal: 12, minHeight: 44, fontSize: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: palette.text, fontSize: 13, flex: 1 },
  step: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  stepValue: { color: palette.text, fontSize: 16, fontWeight: '800', minWidth: 32, textAlign: 'center' },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: palette.border, justifyContent: 'center' },
  chipOn: { borderColor: palette.accent },
  chipText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: palette.accent, fontSize: 13, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  memberName: { color: palette.text, fontSize: 13, flexShrink: 1 },
});
