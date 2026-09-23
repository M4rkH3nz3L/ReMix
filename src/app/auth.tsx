import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  isNonEmpty,
  isValidBirthday,
  isValidFullName,
  isValidPhone,
  isValidUsername,
  looksLikeEmail,
} from '@/lib/accountValidation';
import { useAuth } from '@/store/authStore';

type Mode = 'signIn' | 'signUp';

/**
 * 🔐 Bejelentkezés / Regisztráció — az app első képernyője, amíg nincs session.
 * A `Stack.Protected` gondoskodik róla, hogy csak kijelentkezve látszódjon;
 * sikeres be-/regisztráció után a guard automatikusan a projektekhez vezet.
 */
export default function AuthScreen() {
  const { t } = useTranslation();
  const configured = useAuth((s) => s.configured);
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // regisztrációs profil-mezők
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [birthday, setBirthday] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false); // 📜 GDPR: feltételek + adatkezelés elfogadva
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const isSignUp = mode === 'signUp';

  // mező-hibák csak akkor látszanak, ha már írt bele (üresen ne piroskodjon)
  const nameError = isSignUp && fullName.length > 0 && !isValidFullName(fullName);
  const usernameError = isSignUp && username.length > 0 && !isValidUsername(username);
  const phoneError = isSignUp && phone.length > 0 && !isValidPhone(phone);
  const birthdayError =
    isSignUp && birthday.length > 0 && !isValidBirthday(birthday);

  const signUpFieldsValid =
    isValidFullName(fullName) &&
    isValidUsername(username) &&
    isValidPhone(phone) &&
    isValidBirthday(birthday) &&
    isNonEmpty(country) &&
    isNonEmpty(city);

  // belépéskor az azonosító e-mail / felhasználónév / telefon (elég nem üresnek lennie);
  // regisztrációkor az e-mail KÖTELEZŐ (a fiók arra jön létre)
  const identifierValid = isSignUp ? looksLikeEmail(email) : email.trim().length > 0;

  const canSubmit =
    configured &&
    !busy &&
    identifierValid &&
    password.length >= 6 &&
    (!isSignUp || (signUpFieldsValid && accepted));

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = isSignUp
        ? await signUp(email.trim(), password, {
            fullName,
            username,
            phone,
            birthday,
            country,
            city,
          })
        : await signIn(email.trim(), password);
      if (result.error) {
        setError(result.error);
      } else if (result.needsEmailConfirm) {
        // regisztráció megerősítendő e-maillel — a session majd megerősítés után jön
        setEmailSent(true);
      }
      // siker (session): a guard reaktívan a projektekhez vált, itt nincs teendő
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isSignUp ? 'signIn' : 'signUp');
    setError(null);
    setEmailSent(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => setLangOpen(true)}
          hitSlop={8}
          style={styles.langButton}
          accessibilityRole="button"
          accessibilityLabel={t('language.title')}
        >
          <Ionicons name="language-outline" size={18} color={palette.textDim} />
          <Text style={styles.langLabel}>{t('language.title')}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.brand}>
          <View style={styles.logoBadge}>
            <Ionicons name="shuffle" size={26} color="#fff" />
          </View>
          <Text style={styles.appName}>{t('home.appName')}</Text>
        </View>

        {emailSent ? (
          <View style={styles.card}>
            <Ionicons name="mail-unread-outline" size={40} color={palette.accent} />
            <Text style={styles.title}>{t('auth.checkEmailTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.checkEmailBody', { email: email.trim() })}</Text>
            <Pressable onPress={switchMode} style={styles.switchRow}>
              <Text style={styles.switchAction}>{t('auth.backToSignIn')}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.title}>
              {isSignUp ? t('auth.signUpTitle') : t('auth.signInTitle')}
            </Text>
            <Text style={styles.subtitle}>
              {isSignUp ? t('auth.signUpSubtitle') : t('auth.signInSubtitle')}
            </Text>

            {isSignUp ? (
              <>
                <Text style={styles.fieldLabel}>{t('auth.nameLabel')}</Text>
                <TextInput
                  value={fullName}
                  onChangeText={setFullName}
                  placeholder={t('auth.namePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={[styles.input, nameError && styles.inputError]}
                  autoCapitalize="words"
                  autoCorrect={false}
                  textContentType="name"
                  autoComplete="name"
                  editable={!busy}
                />
                <Text style={nameError ? styles.error : styles.hint}>
                  {t('auth.nameHint')}
                </Text>

                <Text style={styles.fieldLabel}>{t('auth.usernameLabel')}</Text>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t('auth.usernamePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={[styles.input, usernameError && styles.inputError]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="username"
                  autoComplete="username-new"
                  editable={!busy}
                />
                <Text style={usernameError ? styles.error : styles.hint}>
                  {t('auth.usernameHint')}
                </Text>
              </>
            ) : null}

            <Text style={styles.fieldLabel}>
              {isSignUp ? t('auth.emailLabel') : t('auth.identifierLabel')}
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={isSignUp ? t('auth.emailPlaceholder') : t('auth.identifierPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={isSignUp ? 'email-address' : 'default'}
              textContentType={isSignUp ? 'emailAddress' : 'username'}
              autoComplete={isSignUp ? 'email' : 'username'}
              editable={!busy}
            />

            {isSignUp ? (
              <>
                <Text style={styles.fieldLabel}>{t('auth.phoneLabel')}</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder={t('auth.phonePlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={[styles.input, phoneError && styles.inputError]}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  editable={!busy}
                />
                {phoneError ? (
                  <Text style={styles.error}>{t('auth.phoneInvalid')}</Text>
                ) : null}

                <Text style={styles.fieldLabel}>{t('auth.birthdayLabel')}</Text>
                <TextInput
                  value={birthday}
                  onChangeText={setBirthday}
                  placeholder={t('auth.birthdayPlaceholder')}
                  placeholderTextColor={palette.textDim}
                  style={[styles.input, birthdayError && styles.inputError]}
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  editable={!busy}
                />
                {birthdayError ? (
                  <Text style={styles.error}>{t('auth.birthdayInvalid')}</Text>
                ) : null}

                <Text style={styles.fieldLabel}>{t('auth.locationLabel')}</Text>
                <View style={styles.locationRow}>
                  <TextInput
                    value={country}
                    onChangeText={setCountry}
                    placeholder={t('auth.countryPlaceholder')}
                    placeholderTextColor={palette.textDim}
                    style={[styles.input, styles.locationInput]}
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="countryName"
                    editable={!busy}
                  />
                  <TextInput
                    value={city}
                    onChangeText={setCity}
                    placeholder={t('auth.cityPlaceholder')}
                    placeholderTextColor={palette.textDim}
                    style={[styles.input, styles.locationInput]}
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="addressCity"
                    editable={!busy}
                  />
                </View>
              </>
            ) : null}

            <Text style={styles.fieldLabel}>{t('auth.passwordLabel')}</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.passwordPlaceholder')}
              placeholderTextColor={palette.textDim}
              style={styles.input}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              editable={!busy}
              onSubmitEditing={() => {
                void submit();
              }}
            />
            <Text style={styles.hint}>{t('auth.passwordHint')}</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!configured ? <Text style={styles.error}>{t('auth.notConfigured')}</Text> : null}

            {isSignUp ? (
              <Pressable
                onPress={() => setAccepted((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}
              >
                <Ionicons
                  name={accepted ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={accepted ? palette.accent : palette.border}
                />
                <Text style={{ flex: 1, color: palette.textDim, fontSize: 13, lineHeight: 18 }}>
                  {t('auth.consentPrefix')}{' '}
                  <Text
                    style={{ color: palette.accent, fontWeight: '700' }}
                    onPress={() => router.push('/legal?doc=terms')}
                  >
                    {t('auth.consentTerms')}
                  </Text>
                  {t('auth.consentAnd')}
                  <Text
                    style={{ color: palette.accent, fontWeight: '700' }}
                    onPress={() => router.push('/legal?doc=privacy')}
                  >
                    {t('auth.consentPrivacy')}
                  </Text>
                  .
                </Text>
              </Pressable>
            ) : null}

            <View style={styles.submitWrap}>
              {busy ? (
                <View style={styles.busyBox}>
                  <ActivityIndicator color={palette.text} />
                </View>
              ) : (
                <PrimaryButton
                  icon={isSignUp ? 'person-add' : 'log-in'}
                  label={isSignUp ? t('auth.signUpAction') : t('auth.signInAction')}
                  disabled={!canSubmit}
                  onPress={() => {
                    void submit();
                  }}
                />
              )}
            </View>

            <Pressable onPress={switchMode} style={styles.switchRow} disabled={busy}>
              <Text style={styles.switchText}>
                {isSignUp ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
                <Text style={styles.switchAction}>
                  {isSignUp ? t('auth.signInAction') : t('auth.signUpAction')}
                </Text>
              </Text>
            </Pressable>
          </View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>

      <LanguageSwitcher visible={langOpen} onClose={() => setLangOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: palette.surface,
  },
  langLabel: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 24,
  },
  brand: {
    alignItems: 'center',
    gap: 12,
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.accent,
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  appName: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -1,
  },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 22,
    gap: 8,
  },
  title: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.textDim,
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 18,
  },
  fieldLabel: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    padding: 12,
    fontSize: 15,
  },
  inputError: {
    borderColor: palette.danger,
  },
  locationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  locationInput: {
    flex: 1,
  },
  hint: {
    color: palette.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  error: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  submitWrap: {
    marginTop: 14,
  },
  busyBox: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 2,
  },
  switchText: {
    color: palette.textDim,
    fontSize: 13,
  },
  switchAction: {
    color: palette.accent,
    fontWeight: '700',
  },
});
