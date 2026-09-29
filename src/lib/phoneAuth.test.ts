import {
  brevoRecipient,
  dialCodeOf,
  isAllowedPhone,
  isGsm7,
  isSendablePhone,
  isValidOtp,
  maskPhone,
  normalizeE164,
  normalizeSmsSender,
  sanitizeOtpInput,
  SMS_GSM7_LIMIT,
  smsOtpMessage,
  smsSegments,
  toGsm7,
} from '@/lib/phoneAuth';

describe('phoneAuth — E.164 normalizálás', () => {
  it('nemzetközi formák', () => {
    expect(normalizeE164('+36301234567')).toBe('+36301234567');
    expect(normalizeE164('+36 30 123 4567')).toBe('+36301234567');
    expect(normalizeE164('+36-30-123-4567')).toBe('+36301234567');
    expect(normalizeE164('+36 (30) 123.4567')).toBe('+36301234567');
  });

  it('00 nemzetközi kilépő', () => {
    expect(normalizeE164('0036301234567')).toBe('+36301234567');
  });

  it('belföldi trönk-nulla az alap-országkóddal', () => {
    expect(normalizeE164('06 30 123 4567')).toBe('+36301234567');
    expect(normalizeE164('0301234567')).toBe('+36301234567');
  });

  it('előtag nélküli helyi szám az alap-országkóddal', () => {
    expect(normalizeE164('301234567')).toBe('+36301234567');
  });

  it('más alap-országkód is adható', () => {
    expect(normalizeE164('0301234567', '43')).toBe('+43301234567');
  });

  it('érvénytelen bemenetek → null', () => {
    expect(normalizeE164('')).toBeNull();
    expect(normalizeE164('   ')).toBeNull();
    expect(normalizeE164('nem szám')).toBeNull();
    expect(normalizeE164('+36abc')).toBeNull();
    expect(normalizeE164('+1234')).toBeNull(); // túl rövid (<8 jegy)
    expect(normalizeE164('+3630123456789012345')).toBeNull(); // túl hosszú (>15)
  });
});

describe('phoneAuth — országkód / allowlist (SMS-pumping védelem)', () => {
  it('dialCodeOf leghosszabb egyezés', () => {
    expect(dialCodeOf('+36301234567')).toBe('36');
    expect(dialCodeOf('+420123456789')).toBe('420');
    expect(dialCodeOf('+12025550123')).toBe('1');
    expect(dialCodeOf('36301234567')).toBeNull(); // nincs +
  });

  it('alapból CSAK +36 engedélyezett', () => {
    expect(isAllowedPhone('+36301234567')).toBe(true);
    expect(isAllowedPhone('+12025550123')).toBe(false); // USA — drága SMS
    expect(isAllowedPhone('+8801712345678')).toBe(false); // gyakori pumping-cél
  });

  it('egyedi allowlist', () => {
    expect(isAllowedPhone('+43301234567', ['36', '43'])).toBe(true);
    expect(isAllowedPhone('+36301234567', ['43'])).toBe(false);
  });

  it('üres allowlist = minden engedélyezett (kifejezett feloldás)', () => {
    expect(isAllowedPhone('+12025550123', [])).toBe(true);
  });

  it('isSendablePhone a UI gomb-tiltáshoz (normalizálás + allowlist együtt)', () => {
    expect(isSendablePhone('06 30 123 4567')).toBe(true);
    expect(isSendablePhone('+1 202 555 0123')).toBe(false); // nem engedett ország
    expect(isSendablePhone('hibás')).toBe(false);
  });
});

describe('phoneAuth — OTP', () => {
  it('isValidOtp pontosan 6 számjegy', () => {
    expect(isValidOtp('123456')).toBe(true);
    expect(isValidOtp('12 34 56')).toBe(true); // szóközök eldobva
    expect(isValidOtp('12345')).toBe(false);
    expect(isValidOtp('1234567')).toBe(false);
    expect(isValidOtp('12345a')).toBe(false);
    expect(isValidOtp('')).toBe(false);
  });

  it('sanitizeOtpInput csak számjegy, max 6', () => {
    expect(sanitizeOtpInput('12a3-4b56789')).toBe('123456');
    expect(sanitizeOtpInput('')).toBe('');
  });
});

describe('phoneAuth — SMS kódolás / hossz (GSM-7 vs UCS-2)', () => {
  it('toGsm7 leszedi a magyar ékezeteket', () => {
    expect(toGsm7('ReMix aktiváló kód: őrült űrhajó')).toBe('ReMix aktivalo kod: orult urhajo');
    expect(toGsm7('áéíóöőúüű')).toBe('aeiooouuu');
  });

  it('isGsm7 felismeri az ékezetet', () => {
    expect(isGsm7('ReMix aktivalo kod: 123456')).toBe(true);
    expect(isGsm7('ReMix aktiváló kód')).toBe(false);
  });

  it('smsSegments: ékezet nélkül 160, ékezettel 70 a limit', () => {
    expect(smsSegments('')).toBe(0);
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
    // ékezetes → UCS-2, 70 karakteres szegmens
    expect(smsSegments('ő'.repeat(70))).toBe(1);
    expect(smsSegments('ő'.repeat(71))).toBe(2);
  });

  it('smsOtpMessage ékezet-mentes és EGY szegmens', () => {
    const msg = smsOtpMessage('123456');
    expect(msg).toBe('ReMix aktivalo kod: 123456. Ne add meg senkinek!');
    expect(isGsm7(msg)).toBe(true);
    expect(smsSegments(msg)).toBe(1);
  });

  it('smsOtpMessage az ékezetes márkanevet is normalizálja', () => {
    expect(smsOtpMessage('123456', 'Fényképező')).toBe(
      'Fenykepezo aktivalo kod: 123456. Ne add meg senkinek!'
    );
  });

  it('extrém hosszú márkanév sem lép túl egy szegmenst (az OTP nem csonkul)', () => {
    const msg = smsOtpMessage('123456', 'X'.repeat(300));
    expect(msg.length).toBeLessThanOrEqual(SMS_GSM7_LIMIT);
    expect(smsSegments(msg)).toBe(1);
    expect(msg).toContain('123456');
    expect(msg).toContain('Ne add meg senkinek!');
  });
});

describe('phoneAuth — Brevo mezők / UI', () => {
  it('normalizeSmsSender: alfanumerikus, max 11', () => {
    expect(normalizeSmsSender('ReMix')).toBe('ReMix');
    expect(normalizeSmsSender('Re-Mix Stúdió!')).toBe('ReMixStudio'); // ékezet le, pont 11 kar
    expect(normalizeSmsSender('')).toBe('ReMix');
    expect(normalizeSmsSender('###')).toBe('ReMix'); // csak szemét → fallback
    expect(normalizeSmsSender('A'.repeat(50)).length).toBe(11);
  });

  it('brevoRecipient: + nélküli számjegyek', () => {
    expect(brevoRecipient('+36301234567')).toBe('36301234567');
  });

  it('maskPhone', () => {
    expect(maskPhone('+36301234567')).toBe('+3630***4567');
    expect(maskPhone('+123')).toBe('+123'); // túl rövid → változatlan
  });
});
