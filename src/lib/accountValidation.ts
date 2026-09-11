/**
 * ✅ Regisztrációs mezők validálása — tiszta függvények, UI nélkül.
 *
 * A tényleges e-mail/jelszó-ellenőrzést a Supabase is elvégzi; ezek a
 * kliens-oldali, azonnali visszajelzéshez (gomb-tiltás + mező-hibák) kellenek.
 */

/** A signUp-hoz begyűjtött profil-mezők. */
export interface SignUpProfile {
  fullName: string;
  phone: string;
  /** ISO dátum: YYYY-MM-DD */
  birthday: string;
  country: string;
  city: string;
}

/** Egyszerű e-mail-alakiság (a valódi ellenőrzést a Supabase végzi). */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Teljes név: legalább 2 szó (kell szóköz) ÉS legalább 2 nagybetű.
 * Pl. „Kiss Anna" ✔, „anna" ✗ (nincs szóköz), „AB" ✗ (nincs szóköz).
 */
export function isValidFullName(value: string): boolean {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return false; // kell a szóköz → legalább kételemű név
  }
  const uppercaseCount = (trimmed.match(/\p{Lu}/gu) ?? []).length;
  return uppercaseCount >= 2; // minimum 2 nagybetű
}

/** Telefonszám: opcionális +, 7–15 számjegy, közte szóköz/kötőjel/zárójel megengedett. */
export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Szülinap: YYYY-MM-DD, valós naptári dátum, múltban, 1900 és ma között,
 * és legalább 13 éves kor (a legtöbb social platform alsó határa).
 */
export function isValidBirthday(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // valós dátum? (kiszűri pl. a 2026-02-31-et, amit a Date átgörget)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const now = new Date();
  if (date.getTime() > now.getTime()) {
    return false; // nem lehet a jövőben
  }
  const age =
    (now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return age >= 13 && age <= 120;
}

/** Nem üres (ország/város). */
export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** Az egész signUp-profil érvényes-e (a gomb engedélyezéséhez). */
export function isSignUpProfileValid(profile: SignUpProfile): boolean {
  return (
    isValidFullName(profile.fullName) &&
    isValidPhone(profile.phone) &&
    isValidBirthday(profile.birthday) &&
    isNonEmpty(profile.country) &&
    isNonEmpty(profile.city)
  );
}
