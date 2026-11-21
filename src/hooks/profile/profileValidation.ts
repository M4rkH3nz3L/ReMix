import {
  isNonEmpty,
  isValidBirthday,
  isValidFullName,
  isValidPhone,
  isValidUsername,
} from '@/lib/accountValidation';
import type { AccountProfile } from '@/lib/profile';

/** a személyes adatok mező-hibái + az egész űrlap érvényessége (REFACTOR: a useProfile-ból) */
export function profileFieldErrors(profile: AccountProfile) {
  const nameError = profile.fullName.length > 0 && !isValidFullName(profile.fullName);
  const usernameError = profile.username.length > 0 && !isValidUsername(profile.username);
  const phoneError = profile.phone.length > 0 && !isValidPhone(profile.phone);
  const birthdayError = profile.birthday.length > 0 && !isValidBirthday(profile.birthday);
  const profileValid =
    isValidUsername(profile.username) &&
    isValidFullName(profile.fullName) &&
    isValidPhone(profile.phone) &&
    isValidBirthday(profile.birthday) &&
    isNonEmpty(profile.country) &&
    isNonEmpty(profile.city);
  return { nameError, usernameError, phoneError, birthdayError, profileValid };
}
