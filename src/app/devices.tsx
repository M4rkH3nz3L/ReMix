import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { listMyDevices, removeDeviceEntry, type UserDevice } from '@/lib/devices';
import { useAuth } from '@/store/authStore';

/** 📱 Bejelentkezett eszközök (08 — session/device-management). */
export default function DevicesScreen() {
  const { t } = useTranslation();
  const signOutOtherSessions = useAuth((s) => s.signOutOtherSessions);
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setDevices(await listMyDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDevices([]);
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listMyDevices();
        if (active) {
          setDevices(list);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setDevices([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onRemove = (d: UserDevice) => {
    Alert.alert(t('auth.deviceRemove'), d.label, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.deviceRemove'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await removeDeviceEntry(d.fingerprint);
            await reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const onSignOutOthers = () => {
    Alert.alert(t('auth.signOutOthers'), t('auth.signOutOthersConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOutOthers'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const result = await signOutOtherSessions();
          setBusy(false);
          Alert.alert(t('auth.signOutOthers'), result.error ?? t('auth.signOutOthersDone'));
          await reload();
        },
      },
    ]);
  };

  const fmt = (iso: string | null): string => {
    if (!iso) {
      return '—';
    }
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('auth.devicesTitle')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>{t('auth.devicesSubtitle')}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {devices == null ? (
          <ActivityIndicator color={palette.accent} style={styles.loading} />
        ) : devices.length === 0 ? (
          <Text style={styles.hint}>{t('auth.devicesEmpty')}</Text>
        ) : (
          devices.map((d) => (
            <View key={d.fingerprint} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.rowCenter}>
                  <Ionicons
                    name={d.platform === 'ios' ? 'phone-portrait-outline' : 'hardware-chip-outline'}
                    size={18}
                    color={palette.text}
                  />
                  <Text style={styles.deviceLabel}>{d.label}</Text>
                  {d.isCurrent ? <Text style={styles.currentBadge}>{t('auth.deviceCurrent')}</Text> : null}
                </View>
              </View>
              <Text style={styles.meta}>
                {[d.platform, d.osName, d.osVersion].filter(Boolean).join(' · ')}
                {d.appVersion ? ` · v${d.appVersion}` : ''}
              </Text>
              <Text style={styles.meta}>{`${t('auth.deviceLastSeen')}: ${fmt(d.lastSeen)}`}</Text>
              {!d.isCurrent ? (
                <Pressable onPress={() => onRemove(d)} disabled={busy} style={styles.removeBtn}>
                  <Text style={styles.removeText}>{t('auth.deviceRemove')}</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}

        <Pressable onPress={onSignOutOthers} disabled={busy} style={styles.signOutOthers}>
          <Ionicons name="log-out-outline" size={18} color={palette.danger} />
          <Text style={styles.signOutOthersText}>{t('auth.signOutOthers')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 },
  content: { padding: 16, gap: 12 },
  subtitle: { color: palette.textDim, fontSize: 14, lineHeight: 20 },
  error: { color: palette.danger, fontSize: 14 },
  loading: { marginTop: 24 },
  hint: { color: palette.textDim, fontSize: 13 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  deviceLabel: { color: palette.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  currentBadge: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
    backgroundColor: palette.bg,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  meta: { color: palette.textDim, fontSize: 12 },
  removeBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
  removeText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
  signOutOthers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 10,
  },
  signOutOthersText: { color: palette.danger, fontSize: 15, fontWeight: '700' },
});
