import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import type { SignUpVia } from '@/lib/authForm';

import { authStyles } from './authStyles';

/**
 * ── 2. LAP: REGISZTRÁCIÓ — csatorna-váltó, profil-mezők, jelszó, GDPR-hozzájárulás
 * (REFACTOR: a src/app/auth.tsx-ből; a mezők állapota a képernyőé marad).
 */
export function SignUpCard({
  signUpVia,
  setSignUpVia,
  viaPhone,
  fullName,
  setFullName,
  nameError,
  username,
  setUsername,
  usernameError,
  email,
  setEmail,
  phone,
  setPhone,
  phoneError,
  birthday,
  setBirthday,
  birthdayError,
  country,
  setCountry,
  city,
  setCity,
  password,
  setPassword,
  accepted,
  setAccepted,
  busy,
  error,
  setError,
  isSignUp,
  configured,
  canSubmit,
  submit,
  goToPage,
}: {
  signUpVia: SignUpVia;
  setSignUpVia: Dispatch<SetStateAction<SignUpVia>>;
  viaPhone: boolean;
  fullName: string;
  setFullName: (v: string) => void;
  nameError: boolean;
  username: string;
  setUsername: (v: string) => void;
  usernameError: boolean;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  phoneError: boolean;
  birthday: string;
  setBirthday: (v: string) => void;
  birthdayError: boolean;
  country: string;
  setCountry: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  accepted: boolean;
  setAccepted: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  isSignUp: boolean;
  configured: boolean;
  canSubmit: boolean;
  submit: () => Promise<void>;
  goToPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('auth.signUpTitle')}</Text>
      <Text style={styles.subtitle}>{t('auth.signUpSubtitle')}</Text>

      {/* 📲 Csatorna-váltó: a fiók e-mailre VAGY telefonszámra jön létre */}
      <Text style={styles.fieldLabel}>{t('auth.viaLabel')}</Text>
      <View style={styles.viaRow}>
        {(['email', 'phone'] as const).map((via) => (
          <Pressable
            key={via}
            onPress={() => {
              setSignUpVia(via);
              setError(null);
            }}
            disabled={busy}
            style={[styles.viaChip, signUpVia === via && styles.viaChipActive]}
          >
            <Ionicons
              name={via === 'email' ? 'mail-outline' : 'chatbox-ellipses-outline'}
              size={16}
              color={signUpVia === via ? palette.bg : palette.textDim}
            />
            <Text style={[styles.viaChipText, signUpVia === via && styles.viaChipTextActive]}>
              {t(via === 'email' ? 'auth.viaEmail' : 'auth.viaPhone')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>{t(viaPhone ? 'auth.viaPhoneHint' : 'auth.viaEmailHint')}</Text>

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
      <Text style={nameError ? styles.error : styles.hint}>{t('auth.nameHint')}</Text>

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
      <Text style={usernameError ? styles.error : styles.hint}>{t('auth.usernameHint')}</Text>

      <Text style={styles.fieldLabel}>
        {viaPhone ? t('auth.emailOptionalLabel') : t('auth.emailLabel')}
      </Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t('auth.emailPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
        editable={!busy}
      />

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
      {phoneError ? <Text style={styles.error}>{t('auth.phoneInvalid')}</Text> : null}

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
      {birthdayError ? <Text style={styles.error}>{t('auth.birthdayInvalid')}</Text> : null}

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

      <Text style={styles.fieldLabel}>{t('auth.passwordLabel')}</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder={t('auth.passwordPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        editable={!busy}
        onSubmitEditing={() => {
          void submit();
        }}
      />
      <Text style={styles.hint}>{t('auth.passwordHintStrong')}</Text>

      {error && isSignUp ? <Text style={styles.error}>{error}</Text> : null}
      {!configured ? <Text style={styles.error}>{t('auth.notConfigured')}</Text> : null}

      <Pressable
        onPress={() => setAccepted((v) => !v)}
        style={styles.consentRow}
      >
        <Ionicons
          name={accepted ? 'checkbox' : 'square-outline'}
          size={22}
          color={accepted ? palette.accent : palette.border}
        />
        <Text style={styles.consentText}>
          {t('auth.consentPrefix')}{' '}
          <Text
            style={styles.consentLink}
            onPress={() => router.push('/legal?doc=terms')}
          >
            {t('auth.consentTerms')}
          </Text>
          {t('auth.consentAnd')}
          <Text
            style={styles.consentLink}
            onPress={() => router.push('/legal?doc=privacy')}
          >
            {t('auth.consentPrivacy')}
          </Text>
          .
        </Text>
      </Pressable>

      <View style={styles.submitWrap}>
        {busy && isSignUp ? (
          <View style={styles.busyBox}>
            <ActivityIndicator color={palette.text} />
          </View>
        ) : (
          <PrimaryButton
            icon="person-add"
            label={t('auth.signUpAction')}
            disabled={!canSubmit || !isSignUp}
            onPress={() => {
              void submit();
            }}
          />
        )}
      </View>

      <Pressable onPress={() => goToPage(0)} style={styles.switchRow} disabled={busy}>
        <Text style={styles.switchText}>
          <Text style={styles.switchAction}>‹ {t('auth.signInAction')}</Text>{' '}
          {t('auth.haveAccount')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  ...authStyles,
  /* 📲 regisztrációs csatorna-váltó (e-mail ↔ telefon) */
  viaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  viaChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  viaChipActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  viaChipText: {
    color: palette.textDim,
    fontSize: 14,
    fontWeight: '600',
  },
  viaChipTextActive: {
    color: palette.bg,
  },
  locationRow: {
    flexDirection: 'row',
    gap: 10,
  },
  locationInput: {
    flex: 1,
  },
  // 📜 GDPR-consent sor (korábban inline stílus volt)
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  consentText: {
    flex: 1,
    color: palette.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  consentLink: {
    color: palette.accent,
    fontWeight: '700',
  },
});
