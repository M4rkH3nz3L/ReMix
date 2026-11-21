/**
 * 🔐 A bejelentkezés / regisztráció képernyő (src/app/auth.tsx) tiszta, expo-mentes magja:
 * a mező-hibák, a beküldhetőség és a swipe-lap → mód leképezés. A képernyőből kiemelve
 * (REFACTOR) — a feltételek szó szerint az eredetiek.
 */
import {
  isNonEmpty,
  isValidBirthday,
  isValidFullName,
  isValidPhone,
  isValidUsername,
  isStrongPassword,
  looksLikeEmail,
} from '@/lib/accountValidation';
import { isSendablePhone } from '@/lib/phoneAuth';

export type AuthMode = 'signIn' | 'signUp';
/** 📲 Regisztrációs csatorna: a fiók e-mailre VAGY telefonszámra jön létre. */
export type SignUpVia = 'email' | 'phone';

export interface AuthFormInput {
  mode: AuthMode;
  signUpVia: SignUpVia;
  email: string;
  password: string;
  fullName: string;
  username: string;
  phone: string;
  birthday: string;
  country: string;
  city: string;
  accepted: boolean;
  configured: boolean;
  busy: boolean;
}

export interface AuthFormState {
  isSignUp: boolean;
  /** 📲 telefonos regisztráció: a fiók a SZÁMRA jön létre, SMS-kóddal aktiválva */
  viaPhone: boolean;
  nameError: boolean;
  usernameError: boolean;
  phoneError: boolean;
  birthdayError: boolean;
  signUpFieldsValid: boolean;
  identifierValid: boolean;
  canSubmit: boolean;
}

/** a beírt mezőkből a mező-hibák és a beküldhetőség */
export function authFormState({
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
}: AuthFormInput): AuthFormState {
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
    // 🔒 08: regisztrációnál erős jelszó (12+); belépésnél marad a régi minimum
    // (a meglévő, rövidebb jelszavú fiókokat nem zárjuk ki)
    (isSignUp ? isStrongPassword(password) : password.length >= 6) &&
    (!isSignUp || (signUpFieldsValid && accepted));

  return {
    isSignUp,
    viaPhone,
    nameError,
    usernameError,
    phoneError,
    birthdayError,
    signUpFieldsValid,
    identifierValid,
    canSubmit,
  };
}

/** swipe vége: a vízszintes eltolásból a látható lap módja (0 = belépés, 1 = regisztráció) */
export function pagerPageMode(offsetX: number, width: number): AuthMode {
  const page = Math.round(offsetX / width);
  return page === 1 ? 'signUp' : 'signIn';
}
