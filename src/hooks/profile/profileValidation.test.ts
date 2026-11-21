import { emptyProfile } from '@/lib/profile';
import { profileFieldErrors } from '@/hooks/profile/profileValidation';

/** 🧾 A profil-űrlap mező-hibái (REFACTOR: a useProfile.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const valid = {
  ...emptyProfile(),
  fullName: 'Teszt Elek',
  username: 'tesztelek',
  phone: '+36 30 123 4567',
  birthday: '1990-01-01',
  country: 'HU',
  city: 'Budapest',
};

describe('profileFieldErrors', () => {
  it('érvényes profil: nincs hiba, menthető', () => {
    expect(profileFieldErrors(valid)).toEqual({
      nameError: false,
      usernameError: false,
      phoneError: false,
      birthdayError: false,
      profileValid: true,
    });
  });
  it('üres mezőn NINCS mező-hiba, de a profil nem menthető', () => {
    expect(profileFieldErrors(emptyProfile())).toEqual({
      nameError: false,
      usernameError: false,
      phoneError: false,
      birthdayError: false,
      profileValid: false,
    });
  });
  it.each([
    ['fullName', 'egyszó', 'nameError'],
    ['username', 'A B', 'usernameError'],
    ['phone', '12', 'phoneError'],
    ['birthday', '2026-02-31', 'birthdayError'],
  ] as const)('hibás %s (%p) → %s, nem menthető', (key, value, err) => {
    const r = profileFieldErrors({ ...valid, [key]: value });
    expect(r[err]).toBe(true);
    expect(r.profileValid).toBe(false);
  });
  it.each(['country', 'city'] as const)('üres %s → nincs mező-hiba, de nem menthető', (key) => {
    const r = profileFieldErrors({ ...valid, [key]: '   ' });
    expect(r).toMatchObject({ nameError: false, usernameError: false, phoneError: false, birthdayError: false, profileValid: false });
  });
});
