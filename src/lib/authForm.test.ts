import { authFormState, pagerPageMode, type AuthFormInput } from '@/lib/authForm';

/** egy hiánytalan, érvényes e-mailes regisztráció — a tesztek ebből térnek el */
const VALID_SIGNUP: AuthFormInput = {
  mode: 'signUp',
  signUpVia: 'email',
  email: 'elek@example.com',
  password: 'NagyonErosJelszo1',
  fullName: 'Teszt Elek',
  username: 'teszt_elek',
  phone: '+36 30 123 4567',
  birthday: '1990-05-06',
  country: 'Magyarország',
  city: 'Budapest',
  accepted: true,
  configured: true,
  busy: false,
};
const SIGNIN: AuthFormInput = { ...VALID_SIGNUP, mode: 'signIn', password: 'jelszo', accepted: false };

describe('authFormState — belépés (kirögzítve)', () => {
  it('belépésnél elég a nem üres azonosító és a 6+ karakteres jelszó; a regisztrációs mezők nem számítanak', () => {
    const s = authFormState({ ...SIGNIN, fullName: '', username: '', phone: 'x', birthday: 'x' });
    expect(s).toEqual({
      isSignUp: false,
      viaPhone: false,
      nameError: false,
      usernameError: false,
      phoneError: false,
      birthdayError: false,
      signUpFieldsValid: false,
      identifierValid: true,
      canSubmit: true,
    });
  });

  it('5 karakteres jelszóval nem küldhető, 6-tal igen (a régi fiókok minimuma)', () => {
    expect(authFormState({ ...SIGNIN, password: '12345' }).canSubmit).toBe(false);
    expect(authFormState({ ...SIGNIN, password: '123456' }).canSubmit).toBe(true);
  });

  it('csak szóközből álló azonosító érvénytelen', () => {
    const s = authFormState({ ...SIGNIN, email: '   ' });
    expect(s.identifierValid).toBe(false);
    expect(s.canSubmit).toBe(false);
  });

  it('a hozzájárulás belépésnél nem kell', () => {
    expect(authFormState({ ...SIGNIN, accepted: false }).canSubmit).toBe(true);
  });

  it('beállítatlan backenddel vagy futó kérés közben nem küldhető', () => {
    expect(authFormState({ ...SIGNIN, configured: false }).canSubmit).toBe(false);
    expect(authFormState({ ...SIGNIN, busy: true }).canSubmit).toBe(false);
  });
});

describe('authFormState — regisztráció (kirögzítve)', () => {
  it('a hiánytalan e-mailes regisztráció küldhető', () => {
    const s = authFormState(VALID_SIGNUP);
    expect(s.isSignUp).toBe(true);
    expect(s.viaPhone).toBe(false);
    expect(s.signUpFieldsValid).toBe(true);
    expect(s.identifierValid).toBe(true);
    expect(s.canSubmit).toBe(true);
  });

  it('📜 GDPR: hozzájárulás nélkül NEM küldhető', () => {
    expect(authFormState({ ...VALID_SIGNUP, accepted: false }).canSubmit).toBe(false);
  });

  it('🔒 regisztrációnál 12 karakter a jelszó-minimum', () => {
    expect(authFormState({ ...VALID_SIGNUP, password: '12345678901' }).canSubmit).toBe(false);
    expect(authFormState({ ...VALID_SIGNUP, password: '123456789012' }).canSubmit).toBe(true);
  });

  it('e-mailes úton az e-mail kötelező és alakhelyes', () => {
    expect(authFormState({ ...VALID_SIGNUP, email: '' }).identifierValid).toBe(false);
    expect(authFormState({ ...VALID_SIGNUP, email: 'nem-email' }).canSubmit).toBe(false);
  });

  it('üres mezők nem piroslanak, a hibás kitöltés igen', () => {
    const empty = authFormState({ ...VALID_SIGNUP, fullName: '', username: '', phone: '', birthday: '' });
    expect([empty.nameError, empty.usernameError, empty.phoneError, empty.birthdayError]).toEqual([false, false, false, false]);
    expect(empty.canSubmit).toBe(false);
    const bad = authFormState({ ...VALID_SIGNUP, fullName: 'anna', username: '1abc', phone: '12', birthday: '2099-01-01' });
    expect([bad.nameError, bad.usernameError, bad.phoneError, bad.birthdayError]).toEqual([true, true, true, true]);
  });

  it('az ország és a város nem lehet csak szóköz', () => {
    expect(authFormState({ ...VALID_SIGNUP, country: '  ' }).signUpFieldsValid).toBe(false);
    expect(authFormState({ ...VALID_SIGNUP, city: '' }).signUpFieldsValid).toBe(false);
  });

  it('📲 telefonos úton a szám az azonosító, az e-mail elhagyható', () => {
    const s = authFormState({ ...VALID_SIGNUP, signUpVia: 'phone', email: '' });
    expect(s.viaPhone).toBe(true);
    expect(s.identifierValid).toBe(true);
    expect(s.canSubmit).toBe(true);
  });

  it('📲 telefonos úton szigorúbb: nem engedett országhívószám hibás (e-mailes úton nem)', () => {
    const foreign = '+1 555 010 0000';
    expect(authFormState({ ...VALID_SIGNUP, phone: foreign }).phoneError).toBe(false);
    const viaPhone = authFormState({ ...VALID_SIGNUP, signUpVia: 'phone', phone: foreign });
    expect(viaPhone.phoneError).toBe(true);
    expect(viaPhone.identifierValid).toBe(false);
    expect(viaPhone.canSubmit).toBe(false);
  });

  it('a telefonos csatorna belépés-módban nem számít', () => {
    expect(authFormState({ ...SIGNIN, signUpVia: 'phone' }).viaPhone).toBe(false);
  });
});

describe('pagerPageMode — swipe-lap → mód', () => {
  it('a kerekített lap-index 1 → regisztráció, minden más → belépés', () => {
    expect(pagerPageMode(0, 400)).toBe('signIn');
    expect(pagerPageMode(199, 400)).toBe('signIn');
    expect(pagerPageMode(200, 400)).toBe('signUp');
    expect(pagerPageMode(400, 400)).toBe('signUp');
    expect(pagerPageMode(599, 400)).toBe('signUp');
    expect(pagerPageMode(600, 400)).toBe('signIn');
    expect(pagerPageMode(1200, 400)).toBe('signIn');
  });
});
