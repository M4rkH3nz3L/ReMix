import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
import { isSendablePhone, isValidOtp, maskPhone, sanitizeOtpInput } from '@/lib/phoneAuth';
import { isUsernameAvailable } from '@/lib/profile';
import { useAuth } from '@/store/authStore';

type Mode = 'signIn' | 'signUp';
/** 📲 Regisztrációs csatorna: a fiók e-mailre VAGY telefonszámra jön létre. */
type SignUpVia = 'email' | 'phone';

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
  const signUpWithPhone = useAuth((s) => s.signUpWithPhone);
  const verifyPhoneOtp = useAuth((s) => s.verifyPhoneOtp);
  const resendPhoneOtp = useAuth((s) => s.resendPhoneOtp);

  const [mode, setMode] = useState<Mode>('signIn');
  const [signUpVia, setSignUpVia] = useState<SignUpVia>('email');
  /** a beírt kód + a szám, amire az SMS elment (E.164) — ha van, az OTP-lap megy */
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
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
  /** 📲 telefonos regisztráció: a fiók a SZÁMRA jön létre, SMS-kóddal aktiválva */
  const viaPhone = isSignUp && signUpVia === 'phone';

  // mező-hibák csak akkor látszanak, ha már írt bele (üresen ne piroskodjon)
  const nameError = isSignUp && fullName.length > 0 && !isValidFullName(fullName);
  const usernameError = isSignUp && username.length > 0 && !isValidUsername(username);
  // telefonos úton SZIGORÚBB: E.164-re normalizálható ÉS engedett országhívószám
  // (SMS-pumping ellen — a Brevo-kredit valódi pénz)
  const phoneError =
    isSignUp &&
    phone.length > 0 &&
    (viaPhone ? !isSendablePhone(phone) : !isValidPhone(phone));
  const birthdayError =
    isSignUp && birthday.length > 0 && !isValidBirthday(birthday);

  const signUpFieldsValid =
    isValidFullName(fullName) &&
    isValidUsername(username) &&
    (viaPhone ? isSendablePhone(phone) : isValidPhone(phone)) &&
    isValidBirthday(birthday) &&
    isNonEmpty(country) &&
    isNonEmpty(city);

  // belépéskor az azonosító e-mail / felhasználónév / telefon (elég nem üresnek lennie);
  // e-mailes regisztrációkor az e-mail KÖTELEZŐ (a fiók arra jön létre) —
  // telefonos úton viszont a SZÁM az azonosító, az e-mail elhagyható
  const identifierValid = isSignUp
    ? viaPhone
      ? isSendablePhone(phone)
      : looksLikeEmail(email)
    : email.trim().length > 0;

  const canSubmit =
    configured &&
    !busy &&
    identifierValid &&
    password.length >= 6 &&
    (!isSignUp || (signUpFieldsValid && accepted));

  /** 📲 SMS-kód ellenőrzése → session (a guard tovább visz) */
  const submitOtp = async () => {
    if (!otpPhone || busy || !isValidOtp(otpCode)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPhoneOtp(otpPhone, otpCode);
      if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 📲 kód újraküldése (a Supabase rate-limitje alá esik) */
  const resendOtp = async () => {
    if (!otpPhone || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await resendPhoneOtp(otpPhone);
      if (result.error) {
        setError(result.error);
      } else {
        setOtpCode('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 🔑 regisztrációnál előbb a felhasználónév-foglaltság (beszédes hiba a
      // nyers DB-unique-violation helyett); a DB-index amúgy is véd
      if (isSignUp && !(await isUsernameAvailable(username.trim()))) {
        setError(t('profile.usernameTaken'));
        setBusy(false);
        return;
      }
      const profile = { fullName, username, phone, birthday, country, city };
      const result = isSignUp
        ? viaPhone
          ? await signUpWithPhone(phone, password, profile)
          : await signUp(email.trim(), password, profile)
        : await signIn(email.trim(), password);
      if (result.error) {
        setError(result.error);
      } else if (result.needsEmailConfirm) {
        // regisztráció megerősítendő e-maillel — a session majd megerősítés után jön
        setEmailSent(true);
      } else if (result.needsSmsOtp && result.phone) {
        // 📲 elment az SMS — a normalizált E.164-számmal ellenőrzünk
        setOtpPhone(result.phone);
        setOtpCode('');
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
    setOtpPhone(null);
    setOtpCode('');
  };

  // ── Swipe-pager: a belépés és a regisztráció KÉT vízszintes lap, amelyek között
  //    swipe-pal (és a lenti linkkel / pontokkal) lehet váltani. A `mode` és a lap
  //    pozíciója szinkronban: a swipe állítja a módot, a mód-váltás görgeti a lapot.
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView | null>(null);

  /** a megadott lapra görget (0 = belépés, 1 = regisztráció) */
  const goToPage = useCallback(
    (page: number) => {
      if (width > 0) {
        pagerRef.current?.scrollTo({ x: page * width, animated: true });
      }
    },
    [width],
  );

  // a mód PROGRAMATIKUS váltásakor (switch-link, OTP-visszalépés) a pager odaugrik
  useEffect(() => {
    goToPage(isSignUp ? 1 : 0);
  }, [isSignUp, goToPage]);

  /** swipe vége → a látható laphoz igazítjuk a módot (ez vezérli a címet + submitet) */
  const onPagerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) {
      return;
    }
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    const next: Mode = page === 1 ? 'signUp' : 'signIn';
    if (next !== mode) {
      setMode(next);
      setError(null);
    }
  };

  // ── 1. LAP: BELÉPÉS ───────────────────────────────────────────────────────
  const signInCard = (
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

  // ── 2. LAP: REGISZTRÁCIÓ ──────────────────────────────────────────────────
  const signUpCard = (
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
      <Text style={styles.hint}>{t('auth.passwordHint')}</Text>

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
        <View style={styles.brand}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logoBadge}
            contentFit="cover"
            accessibilityLabel={t('home.appName')}
          />
          <Text style={styles.appName}>{t('home.appName')}</Text>
        </View>

        {otpPhone ? (
          /* 📲 SMS-kód lap — a telefonos regisztráció második lépése */
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.card}>
            <Ionicons name="chatbox-ellipses-outline" size={40} color={palette.accent} />
            <Text style={styles.title}>{t('auth.smsCodeTitle')}</Text>
            <Text style={styles.subtitle}>
              {t('auth.smsCodeBody', { phone: maskPhone(otpPhone) })}
            </Text>

            <Text style={styles.fieldLabel}>{t('auth.smsCodeLabel')}</Text>
            <TextInput
              value={otpCode}
              onChangeText={(v) => setOtpCode(sanitizeOtpInput(v))}
              placeholder="123456"
              placeholderTextColor={palette.textDim}
              style={[styles.input, styles.otpInput]}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              editable={!busy}
              autoFocus
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton
              label={t('auth.smsVerifyAction')}
              onPress={submitOtp}
              disabled={busy || !isValidOtp(otpCode)}
            />

            <Pressable onPress={resendOtp} style={styles.switchRow} disabled={busy}>
              <Text style={styles.switchAction}>{t('auth.smsResendAction')}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setOtpPhone(null);
                setOtpCode('');
                setError(null);
              }}
              style={styles.switchRow}
              disabled={busy}
            >
              <Text style={styles.switchAction}>{t('auth.smsChangeNumber')}</Text>
            </Pressable>
          </View>
          </ScrollView>
        ) : emailSent ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.card}>
            <Ionicons name="mail-unread-outline" size={40} color={palette.accent} />
            <Text style={styles.title}>{t('auth.checkEmailTitle')}</Text>
            <Text style={styles.subtitle}>{t('auth.checkEmailBody', { email: email.trim() })}</Text>
            <Pressable onPress={switchMode} style={styles.switchRow}>
              <Text style={styles.switchAction}>{t('auth.backToSignIn')}</Text>
            </Pressable>
          </View>
          </ScrollView>
        ) : (
          <>
            {/* lap-jelző pontok: koppintásra is vált, a swipe mellett */}
            <View style={styles.dotsRow}>
              <Pressable onPress={() => goToPage(0)} hitSlop={10}>
                <View style={[styles.dot, !isSignUp && styles.dotActive]} />
              </Pressable>
              <Pressable onPress={() => goToPage(1)} hitSlop={10}>
                <View style={[styles.dot, isSignUp && styles.dotActive]} />
              </Pressable>
            </View>
            {/* 👉 SWIPE: a belépés és a regisztráció két vízszintes lap */}
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              onMomentumScrollEnd={onPagerScrollEnd}
              style={styles.flex}
            >
              <View style={{ width }}>
                <ScrollView
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  directionalLockEnabled
                >
                  {signInCard}
                </ScrollView>
              </View>
              <View style={{ width }}>
                <ScrollView
                  contentContainerStyle={styles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  directionalLockEnabled
                >
                  {signUpCard}
                </ScrollView>
              </View>
            </ScrollView>
          </>
        )}
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
  /* az SMS-kód mező: nagy, ritkított számjegyek */
  otpInput: {
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
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
  // 👉 Swipe-pager lap-jelző pontok
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4, // `gap` helyett (RNW-kompatibilis)
    flexShrink: 0, // fix méret flex-sorban (ne zsugorodjon 0-ra)
    backgroundColor: 'rgba(255,255,255,0.28)', // látható inaktív a sötét háttéren
  },
  dotActive: {
    backgroundColor: palette.accent,
    width: 22,
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
