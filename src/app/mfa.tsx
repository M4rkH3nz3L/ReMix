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
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  confirmTotp,
  enrollTotp,
  listTotpFactors,
  removeFactor,
  type MfaFactor,
  type TotpEnrollment,
} from '@/lib/mfa';
import { isValidOtp, sanitizeOtpInput } from '@/lib/phoneAuth';

/**
 * 🔐 Kétlépcsős hitelesítés (TOTP) beállítása/kezelése. Additív: a login-oldali
 * enforcement a `authStore` `mfaPending`-jén át megy, csak verifikált faktor esetén.
 * ⚠️ Éles bekapcsolás előtt valódi authenticator-appal tesztelni + a Supabase-
 * projektben az MFA-t engedélyezni.
 */
export default function MfaScreen() {
  const { t } = useTranslation();
  const [factors, setFactors] = useState<MfaFactor[] | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    try {
      setFactors(await listTotpFactors());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFactors([]);
    }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const f = await listTotpFactors();
        if (active) {
          setFactors(f);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setFactors([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const verified = (factors ?? []).find((f) => f.status === 'verified');

  const startEnroll = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setEnrollment(await enrollTotp());
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enrollment || !isValidOtp(code)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmTotp(enrollment.factorId, code);
      setEnrollment(null);
      setCode('');
      setNotice(t('auth.mfaEnrolledOk'));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (factorId: string) => {
    Alert.alert(t('auth.mfaRemove'), t('auth.mfaManageTitle'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.mfaRemove'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await removeFactor(factorId);
            setNotice(null);
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('auth.mfaManageTitle')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>{t('auth.mfaManageSubtitle')}</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {factors == null ? (
          <ActivityIndicator color={palette.accent} style={styles.loading} />
        ) : verified ? (
          <View style={styles.card}>
            <View style={styles.rowCenter}>
              <Ionicons name="shield-checkmark" size={22} color={palette.accent} />
              <Text style={styles.enabled}>{t('auth.mfaEnabled')}</Text>
            </View>
            <Text style={styles.hint}>{t('auth.mfaEnabledHint')}</Text>
            <PrimaryButton label={t('auth.mfaRemove')} onPress={() => remove(verified.id)} disabled={busy} />
          </View>
        ) : enrollment ? (
          <View style={styles.card}>
            <Text style={styles.label}>{t('auth.mfaSecretLabel')}</Text>
            <Text selectable style={styles.secret}>
              {enrollment.secret}
            </Text>
            <Text style={styles.hint}>{t('auth.mfaUriHint')}</Text>
            <Text selectable style={styles.uri}>
              {enrollment.uri}
            </Text>
            <Text style={styles.label}>{t('auth.mfaLabel')}</Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(sanitizeOtpInput(v))}
              placeholder="123456"
              placeholderTextColor={palette.textDim}
              style={styles.input}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={6}
              editable={!busy}
            />
            <PrimaryButton label={t('auth.mfaConfirmCta')} onPress={confirm} disabled={busy || !isValidOtp(code)} />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.hint}>{t('auth.mfaNoFactors')}</Text>
            <PrimaryButton label={t('auth.mfaEnrollCta')} onPress={startEnroll} disabled={busy} />
          </View>
        )}
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
  notice: { color: palette.accent, fontSize: 14 },
  error: { color: palette.danger, fontSize: 14 },
  loading: { marginTop: 24 },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  enabled: { color: palette.text, fontSize: 16, fontWeight: '700' },
  label: { color: palette.text, fontSize: 13, fontWeight: '700' },
  hint: { color: palette.textDim, fontSize: 13, lineHeight: 19 },
  secret: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  uri: { color: palette.textDim, fontSize: 11, fontFamily: 'monospace' },
  input: {
    backgroundColor: palette.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    color: palette.text,
    fontSize: 20,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: 12,
  },
});
