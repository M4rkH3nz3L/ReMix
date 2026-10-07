import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  type ConnectedProvider,
  type ExternalProviderType,
  type OAuthProviderType,
  EXTERNAL_PROVIDERS,
  connectManualProvider,
  connectOAuthProvider,
  disconnectProvider,
  fetchConnectedProviders,
  listProviderFiles,
  setDefaultStorage,
} from '@/lib/externalStorage';
import { InsufficientCreditsError, creditBalance } from '@/lib/shop';
import type { StorageEntry } from '@/lib/storageProviders';
import {
  STORAGE_COIN_PER_GB_MONTH,
  type StorageUsage,
  buyStorageBoost,
  fetchStorageUsage,
  formatBytes,
} from '@/lib/storageQuota';
import { useEntitlement } from '@/store/entitlementStore';

/** A manuális (nem-OAuth) források mezői — a config a workeren tárolódik. */
const MANUAL_FIELDS: Record<'webdav' | 's3', { key: string; label: string; secret?: boolean }[]> = {
  webdav: [
    { key: 'baseUrl', label: 'https://nas.otthon:5005' },
    { key: 'path', label: '/videok' },
    { key: 'username', label: 'user' },
    { key: 'password', label: '••••••', secret: true },
  ],
  s3: [
    { key: 'bucket', label: 'media' },
    { key: 'prefix', label: 'nyersanyag/' },
    { key: 'region', label: 'auto' },
    { key: 'endpoint', label: 'https://…r2.cloudflarestorage.com' },
    { key: 'accessKeyId', label: 'ACCESS_KEY' },
    { key: 'secretAccessKey', label: 'SECRET_KEY', secret: true },
  ],
};

export function StorageCard() {
  const { t } = useTranslation();
  const isPro = useEntitlement((s) => s.isPro());

  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [boostGb, setBoostGb] = useState(1);
  const [boostMonths, setBoostMonths] = useState(1);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [files, setFiles] = useState<StorageEntry[] | null>(null);
  const [manualType, setManualType] = useState<'webdav' | 's3' | null>(null);
  const [manualLabel, setManualLabel] = useState('');
  const [manualCfg, setManualCfg] = useState<Record<string, string>>({});

  // a setState a promise-callbackben történik (halasztott) — így nem „szinkron
  // setState az effektben", és a lista-frissítés akciók után is újrahasználható
  const refresh = useCallback(() => {
    fetchStorageUsage()
      .then((u) => {
        setUsage(u);
        setLoading(false);
      })
      .catch(() => {
        setUsage(null);
        setLoading(false);
      });
    fetchConnectedProviders().then(setProviders).catch(() => {});
    creditBalance().then(setBalance).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const cost = boostGb * boostMonths * STORAGE_COIN_PER_GB_MONTH;
  const pct = usage && usage.quotaBytes > 0 ? Math.min(1, usage.usedBytes / usage.quotaBytes) : 0;
  const barColor = pct >= 0.9 ? palette.danger : palette.accent;
  // az aktív cél: a kijelölt provider, vagy null (= ReMix-tárhely az alap)
  const defaultId = providers.find((p) => p.isDefault)?.id ?? null;

  const onBuy = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const res = await buyStorageBoost(boostGb, boostMonths);
      setBalance(res.balance);
      setUsage(res.usage);
      Alert.alert(t('profile.storage.boostDoneTitle'), t('profile.storage.boostDoneMsg', { gb: boostGb, months: boostMonths }));
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        Alert.alert(t('profile.storage.notEnoughTitle'), t('profile.storage.notEnoughMsg'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('profile.storage.goToShop'), onPress: () => router.push('/shop') },
        ]);
      } else {
        Alert.alert(t('common.error'), (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const onConnectOAuth = async (provider: OAuthProviderType) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ok = await connectOAuthProvider(provider);
      if (ok) {
        await refresh();
      }
    } catch (e) {
      Alert.alert(t('profile.storage.connectFailedTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onConnectManual = async () => {
    if (!manualType || busy) {
      return;
    }
    setBusy(true);
    try {
      await connectManualProvider(manualType, manualLabel || manualType, manualCfg);
      setManualType(null);
      setManualLabel('');
      setManualCfg({});
      await refresh();
    } catch (e) {
      Alert.alert(t('profile.storage.connectFailedTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = (p: ConnectedProvider) => {
    Alert.alert(t('profile.storage.disconnectTitle'), t('profile.storage.disconnectMsg', { label: p.label }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.storage.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectProvider(p.id);
            await refresh();
          } catch (e) {
            Alert.alert(t('common.error'), (e as Error).message);
          }
        },
      },
    ]);
  };

  const onSelectTarget = async (sourceId: string | null) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setDefaultStorage(sourceId);
      await refresh();
    } catch (e) {
      Alert.alert(t('common.error'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onToggleFiles = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setFiles(null);
      return;
    }
    setExpanded(id);
    setFiles(null);
    try {
      setFiles(await listProviderFiles(id));
    } catch {
      setFiles([]);
    }
  };

  const startConnect = (type: ExternalProviderType, oauth: boolean) => {
    if (oauth) {
      onConnectOAuth(type as OAuthProviderType);
    } else {
      setManualType(type as 'webdav' | 's3');
      setManualLabel('');
      setManualCfg({});
    }
  };

  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.storage.section')}</Text>
      <Text style={styles.sectionHint}>{t('profile.storage.sectionHint')}</Text>
      <View style={styles.card}>
        {loading ? (
          <ActivityIndicator color={palette.accent} />
        ) : !usage ? (
          <Text style={styles.dim}>{t('profile.storage.unavailable')}</Text>
        ) : (
          <>
            {/* használat-sáv */}
            <View style={styles.usageRow}>
              <Text style={styles.usageText}>
                {formatBytes(usage.usedBytes)} / {formatBytes(usage.quotaBytes)}
              </Text>
              <Text style={[styles.usagePct, { color: barColor }]}>{Math.round(pct * 100)}%</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.breakdown}>
              {t('profile.storage.baseLabel', { plan: isPro ? 'Pro' : 'Free' })}: {formatBytes(usage.baseBytes)}
              {usage.bonusBytes > 0 ? ` · ${t('profile.storage.bonusLabel')}: ${formatBytes(usage.bonusBytes)}` : ''}
            </Text>
            {usage.bonusExpiresAt ? (
              <Text style={styles.dim}>
                {t('profile.storage.bonusExpires', {
                  date: new Date(usage.bonusExpiresAt).toLocaleDateString(),
                })}
              </Text>
            ) : null}

            {/* koinos bővítés */}
            <View style={styles.boostBox}>
              <Text style={styles.boostTitle}>{t('profile.storage.boostTitle')}</Text>
              <Stepper label={t('profile.storage.gb')} value={boostGb} min={1} max={10} onChange={setBoostGb} />
              <Stepper label={t('profile.storage.months')} value={boostMonths} min={1} max={12} onChange={setBoostMonths} />
              <View style={styles.costRow}>
                <Text style={styles.costText}>
                  <Ionicons name="server" size={13} color={palette.accent} /> +{boostGb} GB · {boostMonths}{' '}
                  {t('profile.storage.monthsShort')}
                </Text>
                <Text style={styles.costCoins}>
                  {cost} 🪙 · {t('profile.storage.balance')}: {balance}
                </Text>
              </View>
              <PrimaryButton
                icon="add-circle"
                label={busy ? t('profile.storage.working') : t('profile.storage.buyBoost')}
                onPress={onBuy}
                disabled={busy}
              />
            </View>
          </>
        )}
      </View>

      {/* külső tárhelyek */}
      <Text style={styles.sectionTitle}>{t('profile.storage.externalSection')}</Text>
      <Text style={styles.sectionHint}>{t('profile.storage.externalHint')}</Text>
      <View style={styles.card}>
        {/* aktív tárhely-cél: ide ment minden studio, és innen olvas vissza */}
        <Text style={styles.addTitle}>{t('profile.storage.activeTarget')}</Text>
        <Text style={[styles.dim, { marginBottom: 8 }]}>{t('profile.storage.activeTargetHint')}</Text>
        <Pressable onPress={() => onSelectTarget(null)} disabled={busy} style={styles.providerRow}>
          <Ionicons
            name={!defaultId ? 'radio-button-on' : 'radio-button-off'}
            size={20}
            color={!defaultId ? palette.accent : palette.textDim}
          />
          <Ionicons name="cloud-done-outline" size={18} color={palette.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.providerLabel}>ReMix</Text>
            <Text style={styles.dim}>{t('profile.storage.remixTarget')}</Text>
          </View>
        </Pressable>

        {providers.length === 0 ? null : (
          providers.map((p) => {
            const meta = EXTERNAL_PROVIDERS.find((m) => m.type === p.type);
            return (
              <View key={p.id} style={styles.providerBlock}>
                <View style={styles.providerRow}>
                  <Pressable onPress={() => onSelectTarget(p.id)} disabled={busy} hitSlop={8}>
                    <Ionicons
                      name={p.isDefault ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={p.isDefault ? palette.accent : palette.textDim}
                    />
                  </Pressable>
                  <Ionicons name={(meta?.icon ?? 'cloud-outline') as never} size={18} color={palette.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.providerLabel} numberOfLines={1}>
                      {p.label}
                    </Text>
                    <Text style={styles.dim}>{meta?.label ?? p.type}</Text>
                  </View>
                  <Pressable onPress={() => onToggleFiles(p.id)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name={expanded === p.id ? 'chevron-up' : 'folder-open-outline'} size={19} color={palette.textDim} />
                  </Pressable>
                  <Pressable onPress={() => onDisconnect(p)} hitSlop={8} style={styles.iconBtn}>
                    <Ionicons name="unlink-outline" size={19} color={palette.danger} />
                  </Pressable>
                </View>
                {expanded === p.id ? (
                  files === null ? (
                    <ActivityIndicator color={palette.accent} style={{ marginVertical: 8 }} />
                  ) : files.length === 0 ? (
                    <Text style={[styles.dim, { marginTop: 6 }]}>{t('profile.storage.emptyFolder')}</Text>
                  ) : (
                    <View style={styles.fileList}>
                      {files.slice(0, 20).map((f) => (
                        <Text key={f.id} style={styles.fileRow} numberOfLines={1}>
                          {f.kind === 'video' ? '🎬' : f.kind === 'audio' ? '🎵' : '🖼️'} {f.name}
                          {f.size ? ` · ${formatBytes(f.size)}` : ''}
                        </Text>
                      ))}
                      {files.length > 20 ? (
                        <Text style={styles.dim}>{t('profile.storage.andMore', { n: files.length - 20 })}</Text>
                      ) : null}
                    </View>
                  )
                ) : null}
              </View>
            );
          })
        )}

        <Text style={[styles.addTitle, { marginTop: providers.length ? 14 : 0 }]}>
          {t('profile.storage.addProvider')}
        </Text>
        <View style={styles.addRow}>
          {EXTERNAL_PROVIDERS.map((m) => (
            <Pressable
              key={m.type}
              onPress={() => startConnect(m.type, m.oauth)}
              disabled={busy}
              style={styles.addChip}
            >
              <Ionicons name={m.icon as never} size={16} color={palette.text} />
              <Text style={styles.addChipText}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* manuális (WebDAV/S3) bekötő űrlap */}
      <Modal visible={!!manualType} transparent animationType="slide" onRequestClose={() => setManualType(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('profile.storage.connect')} · {manualType === 's3' ? 'S3 / MinIO / R2' : 'WebDAV / NAS'}
            </Text>
            <TextInput
              value={manualLabel}
              onChangeText={setManualLabel}
              placeholder={t('profile.storage.labelPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
            />
            {(manualType ? MANUAL_FIELDS[manualType] : []).map((fld) => (
              <TextInput
                key={fld.key}
                value={manualCfg[fld.key] ?? ''}
                onChangeText={(v) => setManualCfg((prev) => ({ ...prev, [fld.key]: v }))}
                placeholder={fld.label}
                placeholderTextColor={palette.textDim}
                secureTextEntry={fld.secret}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            ))}
            <View style={{ gap: 8, marginTop: 6 }}>
              <PrimaryButton
                icon="link"
                label={busy ? t('profile.storage.working') : t('profile.storage.connect')}
                onPress={onConnectManual}
                disabled={busy}
              />
              <Pressable onPress={() => setManualType(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="remove" size={16} color={palette.text} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} hitSlop={8} style={styles.stepBtn}>
        <Ionicons name="add" size={16} color={palette.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '800', marginTop: 22, marginBottom: 4 },
  sectionHint: { color: palette.textDim, fontSize: 12, marginBottom: 8 },
  card: { backgroundColor: palette.surface, borderRadius: 14, borderWidth: 1, borderColor: palette.border, padding: 14 },
  dim: { color: palette.textDim, fontSize: 12 },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 },
  usageText: { color: palette.text, fontSize: 15, fontWeight: '700' },
  usagePct: { fontSize: 13, fontWeight: '800' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: palette.surfaceHigh, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  breakdown: { color: palette.textDim, fontSize: 12, marginTop: 8 },
  boostBox: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: palette.border, gap: 8 },
  boostTitle: { color: palette.text, fontSize: 13, fontWeight: '700' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperLabel: { color: palette.textDim, fontSize: 13, flex: 1 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { color: palette.text, fontSize: 15, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  costText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  costCoins: { color: palette.textDim, fontSize: 12 },
  providerBlock: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  providerLabel: { color: palette.text, fontSize: 14, fontWeight: '600' },
  iconBtn: { padding: 4 },
  fileList: { marginTop: 8, gap: 4, paddingLeft: 30 },
  fileRow: { color: palette.textDim, fontSize: 12 },
  addTitle: { color: palette.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  addChipText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  modalCard: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  modalTitle: { color: palette.text, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: palette.textDim, fontSize: 14, fontWeight: '600' },
});
