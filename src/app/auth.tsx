import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { createAuthActions } from '@/components/auth/authActions';
import { authStyles } from '@/components/auth/authStyles';
import { CheckEmailCard, MfaChallengeCard, SmsOtpCard } from '@/components/auth/AuthStepCards';
import { SignInCard } from '@/components/auth/SignInCard';
import { SignUpCard } from '@/components/auth/SignUpCard';
import { palette } from '@/constants/editor';
import { type AuthMode, authFormState, pagerPageMode, type SignUpVia } from '@/lib/authForm';
import { useAuth } from '@/store/authStore';

/**
 * 🔐 Bejelentkezés / Regisztráció — az app első képernyője, amíg nincs session.
 * A `Stack.Protected` gondoskodik róla, hogy csak kijelentkezve látszódjon;
 * sikeres be-/regisztráció után a guard automatikusan a projektekhez vezet.
 *
 * REFACTOR: a gyökér az állapotot, a swipe-pagert és a lap-választást tartja; a lapok a
 * src/components/auth/ alatt, a mező-validáció a src/lib/authForm.ts-ben, a beküldő
 * akciók a createAuthActions()-ben.
 */
export default function AuthScreen() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt), de a
  // memoizálás bekapcsolása viselkedés-változás → külön döntés (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t } = useTranslation();
  const configured = useAuth((s) => s.configured);
  const signIn = useAuth((s) => s.signIn);
  const signUp = useAuth((s) => s.signUp);
  const signUpWithPhone = useAuth((s) => s.signUpWithPhone);
  const verifyPhoneOtp = useAuth((s) => s.verifyPhoneOtp);
  const resendPhoneOtp = useAuth((s) => s.resendPhoneOtp);
  const resendEmailConfirm = useAuth((s) => s.resendEmailConfirm);
  const verifyMfaLogin = useAuth((s) => s.verifyMfaLogin);

  const [mode, setMode] = useState<AuthMode>('signIn');
  const [signUpVia, setSignUpVia] = useState<SignUpVia>('email');
  /** a beírt kód + a szám, amire az SMS elment (E.164) — ha van, az OTP-lap megy */
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
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
  const [notice, setNotice] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const {
    isSignUp,
    viaPhone,
    nameError,
    usernameError,
    phoneError,
    birthdayError,
    canSubmit,
  } = authFormState({
    mode,
    signUpVia,
    email,
    password,
    fullName,
    username,
    phone,
    birthday,
    country,
    city,
    accepted,
    configured,
    busy,
  });

  const {
    submitOtp,
    resendOtp,
    resendEmail,
    submitMfa,
    submit,
    switchMode,
    backFromMfa,
    changeOtpNumber,
  } = createAuthActions({
    t,
    signIn,
    signUp,
    signUpWithPhone,
    verifyPhoneOtp,
    resendPhoneOtp,
    resendEmailConfirm,
    verifyMfaLogin,
    isSignUp,
    viaPhone,
    canSubmit,
    busy,
    otpPhone,
    otpCode,
    mfaCode,
    email,
    password,
    fullName,
    username,
    phone,
    birthday,
    country,
    city,
    setMode,
    setOtpPhone,
    setOtpCode,
    setMfaChallenge,
    setMfaCode,
    setBusy,
    setError,
    setNotice,
    setEmailSent,
  });

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
    const next: AuthMode = pagerPageMode(e.nativeEvent.contentOffset.x, width);
    if (next !== mode) {
      setMode(next);
      setError(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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

        {mfaChallenge ? (
          <MfaChallengeCard
            mfaCode={mfaCode}
            setMfaCode={setMfaCode}
            busy={busy}
            error={error}
            submitMfa={submitMfa}
            backFromMfa={backFromMfa}
          />
        ) : otpPhone ? (
          <SmsOtpCard
            otpPhone={otpPhone}
            otpCode={otpCode}
            setOtpCode={setOtpCode}
            busy={busy}
            error={error}
            submitOtp={submitOtp}
            resendOtp={resendOtp}
            changeOtpNumber={changeOtpNumber}
          />
        ) : emailSent ? (
          <CheckEmailCard
            email={email}
            notice={notice}
            error={error}
            busy={busy}
            resendEmail={resendEmail}
            switchMode={switchMode}
          />
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
                  contentContainerStyle={authStyles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  directionalLockEnabled
                >
                  <SignInCard
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    busy={busy}
                    error={error}
                    isSignUp={isSignUp}
                    configured={configured}
                    canSubmit={canSubmit}
                    submit={submit}
                    goToPage={goToPage}
                  />
                </ScrollView>
              </View>
              <View style={{ width }}>
                <ScrollView
                  contentContainerStyle={authStyles.scrollContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  directionalLockEnabled
                >
                  <SignUpCard
                    signUpVia={signUpVia}
                    setSignUpVia={setSignUpVia}
                    viaPhone={viaPhone}
                    fullName={fullName}
                    setFullName={setFullName}
                    nameError={nameError}
                    username={username}
                    setUsername={setUsername}
                    usernameError={usernameError}
                    email={email}
                    setEmail={setEmail}
                    phone={phone}
                    setPhone={setPhone}
                    phoneError={phoneError}
                    birthday={birthday}
                    setBirthday={setBirthday}
                    birthdayError={birthdayError}
                    country={country}
                    setCountry={setCountry}
                    city={city}
                    setCity={setCity}
                    password={password}
                    setPassword={setPassword}
                    accepted={accepted}
                    setAccepted={setAccepted}
                    busy={busy}
                    error={error}
                    setError={setError}
                    isSignUp={isSignUp}
                    configured={configured}
                    canSubmit={canSubmit}
                    submit={submit}
                    goToPage={goToPage}
                  />
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
});
