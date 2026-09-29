/**
 * 📱 Telefonos auth mag (Brevo SMS OTP) — pure, expo-mentes.
 *
 * A regisztráció ma e-maillel megy; ez a mag a TELEFONSZÁMOS út logikája:
 * E.164-normalizálás, országkód-engedélyezés, OTP-ellenőrzés és az SMS-szöveg
 * összeállítása. A hálózati oldal a Supabase `auth.signUp`/`verifyOtp` (kliens)
 * és a `supabase/functions/send-sms` Edge Function (Brevo) — ez a fájl CSAK a
 * matematika/szabályok, hogy tesztelhető legyen.
 *
 * Két szabály a `devs/source/BREVO.md`-ből, amit itt kényszerítünk ki:
 *  1. **SMS-pumping ellen** országkód-allowlist (alapból csak +36) — a bot-
 *     regisztrációk drága SMS-eket égetnének el az előre fizetett kreditből.
 *  2. **GSM-7 / 160 karakter**: ékezetes betű (ő/ű) UCS-2-re váltja a kódolást,
 *     ott csak 70 karakter fér egy SMS-be → az OTP-szöveg ÉKEZET NÉLKÜLI.
 */

/** Engedélyezett országkódok (hívószám-előtag, `+` nélkül). Alap: Magyarország. */
export const DEFAULT_ALLOWED_DIAL_CODES = ['36'] as const;

/** Ismert hívószám-előtagok a normalizáláshoz (leghosszabb-egyezés szerint). */
const KNOWN_DIAL_CODES = [
  '1', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45',
  '46', '47', '48', '49', '51', '52', '54', '55', '56', '57', '58', '60', '61', '62', '63',
  '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
  '212', '213', '216', '218', '220', '221', '233', '234', '254', '255', '256', '351',
  '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373',
  '374', '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387',
  '389', '420', '421', '423', '500', '501', '502', '503', '504', '505', '506', '507',
  '508', '509', '590', '591', '592', '593', '595', '598', '599', '670', '673', '674',
  '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687',
  '688', '689', '690', '691', '692', '850', '852', '853', '855', '856', '880', '886',
  '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972',
  '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998',
];

/** OTP: pontosan ennyi számjegy (Supabase Phone provider alapja). */
export const OTP_LENGTH = 6;
/** Egy GSM-7 SMS hossza; ékezettel (UCS-2) csak 70. */
export const SMS_GSM7_LIMIT = 160;
export const SMS_UCS2_LIMIT = 70;
/** Brevo: a feladó-név legfeljebb 11 alfanumerikus karakter. */
export const SMS_SENDER_MAX = 11;

/**
 * Telefonszám → E.164 (`+36301234567`), vagy `null` ha nem értelmezhető.
 *
 * Elfogad: `+36 30 123 4567`, `0036301234567`, `06 30 123 4567` (magyar belföldi
 * trönk-nulla), `30 123 4567` (előtag nélkül, a `defaultDialCode`-dal). A
 * formázó karakterek (szóköz/kötőjel/zárójel/pont) eldobva.
 */
export function normalizeE164(raw: string, defaultDialCode = '36'): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !/^[+\d\s\-().]+$/.test(trimmed)) {
    return null;
  }
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  const hasPlus = trimmed.startsWith('+');

  if (!hasPlus) {
    // belföldi trönk-prefix: HU = "06", a legtöbb más országban egyetlen "0"
    const trunk = defaultDialCode === '36' ? '06' : '0';
    if (digits.startsWith('00')) {
      digits = digits.slice(2); // nemzetközi kilépő (00…)
    } else if (digits.startsWith(trunk)) {
      digits = defaultDialCode + digits.slice(trunk.length);
    } else if (digits.startsWith('0')) {
      digits = defaultDialCode + digits.slice(1);
    } else if (!digits.startsWith(defaultDialCode)) {
      // Előtag nélküli HELYI szám → az alap-országkód. (Szándékosan NEM
      // találgatunk idegen országkódot: a `301234567` magyar mobil, nem görög
      // szám — a `+` nélküli bemenetet belföldinek tekintjük.)
      digits = defaultDialCode + digits;
    }
  }

  // E.164: 8–15 számjegy (országkód + előfizetői szám)
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return `+${digits}`;
}

/** E.164-számból a hívószám-előtag (leghosszabb ismert egyezés), vagy null. */
export function dialCodeOf(e164: string): string | null {
  if (!e164.startsWith('+')) {
    return null;
  }
  const digits = e164.slice(1);
  const matches = KNOWN_DIAL_CODES.filter((c) => digits.startsWith(c));
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Engedélyezett-e a szám országa? (SMS-pumping elleni védelem — a kredit valódi
 * pénz.) Üres allowlist = minden engedélyezett (kifejezett feloldás).
 */
export function isAllowedPhone(
  e164: string,
  allowed: readonly string[] = DEFAULT_ALLOWED_DIAL_CODES
): boolean {
  if (allowed.length === 0) {
    return true;
  }
  const code = dialCodeOf(e164);
  return code != null && allowed.includes(code);
}

/** Érvényes, ENGEDÉLYEZETT telefonszám-e (a UI gomb-tiltáshoz). */
export function isSendablePhone(
  raw: string,
  allowed: readonly string[] = DEFAULT_ALLOWED_DIAL_CODES,
  defaultDialCode = '36'
): boolean {
  const e164 = normalizeE164(raw, defaultDialCode);
  return e164 != null && isAllowedPhone(e164, allowed);
}

/** OTP-kód: pontosan `OTP_LENGTH` számjegy (szóközök eldobva). */
export function isValidOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test((code ?? '').replace(/\s/g, ''));
}

/** OTP-bemenet tisztítása (csak számjegy, max hossz) — beviteli mezőhöz. */
export function sanitizeOtpInput(raw: string): string {
  return (raw ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH);
}

/**
 * Ékezet-eltávolítás + GSM-7-re szűkítés: így az SMS 160 karakteres marad. A
 * magyar ő/ű (és minden más ékezet) alapbetűre egyszerűsödik.
 */
export function toGsm7(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // kombináló diakritikák (ő → o)
    .replace(/[^\x20-\x7E]/g, ''); // maradék nem-ASCII eldobva
}

/** Csak GSM-7 (ASCII) karaktereket tartalmaz-e? (Ha nem → UCS-2, 70 kar/SMS.) */
export function isGsm7(text: string): boolean {
  return /^[\x20-\x7E]*$/.test(text ?? '');
}

/** Hány SMS-szegmensre esik szét a szöveg (a kredit-fogyás ezen alapul). */
export function smsSegments(text: string): number {
  const t = text ?? '';
  if (t.length === 0) {
    return 0;
  }
  const limit = isGsm7(t) ? SMS_GSM7_LIMIT : SMS_UCS2_LIMIT;
  return Math.ceil(t.length / limit);
}

/**
 * Az OTP-SMS szövege — ÉKEZET NÉLKÜL (GSM-7), garantáltan EGY szegmens. A
 * márkanév is normalizálódik; ha a szöveg túl hosszú lenne, a márkanevet vágjuk
 * (az OTP és a figyelmeztetés soha nem csonkul).
 */
export function smsOtpMessage(otp: string, brand = 'ReMix'): string {
  const safeBrand = toGsm7(brand).trim() || 'ReMix';
  const build = (b: string) => `${b} aktivalo kod: ${otp}. Ne add meg senkinek!`;
  let text = build(safeBrand);
  if (text.length > SMS_GSM7_LIMIT) {
    const overflow = text.length - SMS_GSM7_LIMIT;
    text = build(safeBrand.slice(0, Math.max(1, safeBrand.length - overflow)));
  }
  return text;
}

/** Brevo feladó-név szabályosítása: alfanumerikus, max 11 karakter. */
export function normalizeSmsSender(raw: string, fallback = 'ReMix'): string {
  const cleaned = toGsm7(raw ?? '').replace(/[^A-Za-z0-9]/g, '');
  return (cleaned || fallback).slice(0, SMS_SENDER_MAX);
}

/**
 * Brevo `recipient`: csak számjegy, `+` nélkül (pl. `36301234567`) — a
 * transactionalSMS API így várja.
 */
export function brevoRecipient(e164: string): string {
  return (e164 ?? '').replace(/\D/g, '');
}

/** Maszkolt telefonszám a UI-hoz: `+3630***4567`. */
export function maskPhone(e164: string): string {
  const digits = (e164 ?? '').replace(/\D/g, '');
  if (digits.length < 6) {
    return e164 ?? '';
  }
  const head = digits.slice(0, 4);
  const tail = digits.slice(-4);
  return `+${head}***${tail}`;
}
