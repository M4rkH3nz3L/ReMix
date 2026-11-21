import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';

import type { SignUpProfile } from '@/lib/accountValidation';
import type { AuthMode } from '@/lib/authForm';
import { logCaught } from '@/lib/logCaught';
import { isValidOtp } from '@/lib/phoneAuth';
import { isUsernameAvailable } from '@/lib/profile';
import { type AuthResult, useAuth } from '@/store/authStore';

/**
 * A bejelentkezés / regisztráció képernyő hook nélküli akció-gyára (REFACTOR: a
 * src/app/auth.tsx-ből): minden renderben újra készül (mint eddig a képernyő sima
 * függvényei). A logCaught-címkék az eredeti fájl ujjlenyomatai — változatlanok.
 */
export interface AuthActionDeps {
  t: TFunction;
  signIn: (identifier: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, profile: SignUpProfile) => Promise<AuthResult>;
  signUpWithPhone: (phone: string, password: string, profile: SignUpProfile) => Promise<AuthResult>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<AuthResult>;
  resendPhoneOtp: (phone: string) => Promise<AuthResult>;
  resendEmailConfirm: (email: string) => Promise<AuthResult>;
  verifyMfaLogin: (code: string) => Promise<AuthResult>;
  isSignUp: boolean;
  viaPhone: boolean;
  canSubmit: boolean;
  busy: boolean;
  otpPhone: string | null;
  otpCode: string;
  mfaCode: string;
  email: string;
  password: string;
  fullName: string;
  username: string;
  phone: string;
  birthday: string;
  country: string;
  city: string;
  setMode: Dispatch<SetStateAction<AuthMode>>;
  setOtpPhone: Dispatch<SetStateAction<string | null>>;
  setOtpCode: Dispatch<SetStateAction<string>>;
  setMfaChallenge: Dispatch<SetStateAction<boolean>>;
  setMfaCode: Dispatch<SetStateAction<string>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
  setEmailSent: Dispatch<SetStateAction<boolean>>;
}

export function createAuthActions({
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
}: AuthActionDeps) {
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
      logCaught('app/auth.tsx:submitOtp', e);
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
      logCaught('app/auth.tsx:resendOtp', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** ✉️ e-mail-megerősítő link újraküldése a „nézd meg a postaládád" képernyőről */
  const resendEmail = async () => {
    if (busy || !email.trim()) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resendEmailConfirm(email.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setNotice(t('auth.resendEmailSent'));
      }
    } catch (e) {
      logCaught('app/auth.tsx:resendEmail', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 🔐 a login-kori TOTP-kód ellenőrzése (needsMfa után) */
  const submitMfa = async () => {
    if (busy || !isValidOtp(mfaCode)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await verifyMfaLogin(mfaCode);
      if (result.error) {
        setError(result.error);
      }
      // siker: a guard reaktívan a projektekhez vált (mfaPending=false)
    } catch (e) {
      logCaught('app/auth.tsx:submitMfa', e);
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
    setNotice(null);
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
      } else if (result.needsMfa) {
        // 🔐 jelszó OK, de kell a TOTP-kód → MFA-challenge képernyő
        setMfaChallenge(true);
        setMfaCode('');
      }
      // siker (session): a guard reaktívan a projektekhez vált, itt nincs teendő
    } catch (e) {
      logCaught('app/auth.tsx:submit', e);
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
    setMfaChallenge(false);
    setMfaCode('');
    setNotice(null);
  };

  /** 🔐 MFA-lapról vissza a belépéshez (a félkész session kiléptetésével) */
  const backFromMfa = () => {
    setMfaChallenge(false);
    setMfaCode('');
    setError(null);
    void useAuth.getState().signOut();
  };

  /** 📲 SMS-kód lapról vissza: másik szám */
  const changeOtpNumber = () => {
    setOtpPhone(null);
    setOtpCode('');
    setError(null);
  };

  return { submitOtp, resendOtp, resendEmail, submitMfa, submit, switchMode, backFromMfa, changeOtpNumber };
}
