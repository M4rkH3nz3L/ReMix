import {
  isStrongPassword,
  isValidUsername,
  looksLikeEmail,
  MIN_PASSWORD_LENGTH,
} from '@/lib/accountValidation';

describe('accountValidation — isStrongPassword (08)', () => {
  it(`a minimum ${MIN_PASSWORD_LENGTH} karakter`, () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('11 karakter → gyenge; 12 → erős', () => {
    expect(isStrongPassword('a'.repeat(11))).toBe(false);
    expect(isStrongPassword('a'.repeat(12))).toBe(true);
  });

  it('a régi 6-karakteres minimum ELBUKIK (ez a hardening lényege)', () => {
    expect(isStrongPassword('hatkar')).toBe(false); // 6 kar
  });

  it('hosszú jelszó átmegy', () => {
    expect(isStrongPassword('EgySzuperHosszuJelszo!123')).toBe(true);
  });
});

// a már létező (korábban tesztelt lefedetlen) validátorok minimál-smoke-ja
describe('accountValidation — alap-validátorok', () => {
  it('looksLikeEmail', () => {
    expect(looksLikeEmail('te@pelda.hu')).toBe(true);
    expect(looksLikeEmail('nincs-kukac')).toBe(false);
  });
  it('isValidUsername: betűvel kezdődik, 3–20 kar', () => {
    expect(isValidUsername('anna_k')).toBe(true);
    expect(isValidUsername('ReMix')).toBe(true);
    expect(isValidUsername('_x')).toBe(false); // nem betűvel kezdődik
    expect(isValidUsername('ab')).toBe(false); // túl rövid
  });
});
