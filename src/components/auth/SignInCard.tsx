import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';

import { authStyles as styles } from './authStyles';

/** ── 1. LAP: BELÉPÉS — a swipe-pager első lapja (REFACTOR: a src/app/auth.tsx-ből) */
export function SignInCard({
  email,
  setEmail,
  password,
  setPassword,
  busy,
  error,
  isSignUp,
  configured,
  canSubmit,
  submit,
  goToPage,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  busy: boolean;
  error: string | null;
  isSignUp: boolean;
  configured: boolean;
  canSubmit: boolean;
  submit: () => Promise<void>;
  goToPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('auth.signInTitle')}</Text>
      <Text style={styles.subtitle}>{t('auth.signInSubtitle')}</Text>

      <Text style={styles.fieldLabel}>{t('auth.identifierLabel')}</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.identifierPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        autoComplete="username"
        editable={!busy}
      />

      <Text style={styles.fieldLabel}>{t('auth.passwordLabel')}</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.passwordPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password"
        textContentType="password"
        editable={!busy}
        onSubmitEditing={() => {
          void submit();
        }}
      />
      <Text style={styles.hint}>{t('auth.passwordHint')}</Text>

      {error && !isSignUp ? <Text style={styles.error}>{error}</Text> : null}
      {!configured ? <Text style={styles.error}>{t('auth.notConfigured')}</Text> : null}

      <View style={styles.submitWrap}>
        {busy && !isSignUp ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={palette.text} />
          </View>
        ) : (
          <PrimaryButton
            icon="log-in"
            label={t('auth.signInAction')}
            disabled={!canSubmit || isSignUp}
            onPress={() => {
              void submit();
            }}
          />
        )}
      </View>

      <Pressable onPress={() => goToPage(1)} style={styles.switchRow} disabled={busy}>
        <Text style={styles.switchText}>
          {t('auth.noAccount')}{' '}
          <Text style={styles.switchAction}>{t('auth.signUpAction')} ›</Text>
        </Text>
      </Pressable>
    </View>
  );
}
