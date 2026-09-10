/**
 * 🌍 Támogatott nyelvek — a többnyelvűsítés EGYETLEN forrása.
 *
 * A `native` nevet mutatjuk a nyelvválasztóban (mindig a saját nyelvén), a
 * `flag` csak vizuális támpont. Új nyelv hozzáadása: vegyél fel egy sort ide,
 * és tegyél mellé egy `locales/<code>.json` fájlt (lásd `@/i18n`).
 */

export type LanguageCode = 'en' | 'de' | 'hu';

export interface LanguageDef {
  code: LanguageCode;
  /** angol név (belső/hibakeresési célra) */
  label: string;
  /** a nyelv saját neve — ezt látja a felhasználó a választóban */
  native: string;
  flag: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageDef[] = [
  { code: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'German', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'hu', label: 'Hungarian', native: 'Magyar', flag: '🇭🇺' },
];

/** Alap/tartalék nyelv — ismeretlen eszköz-locale esetén ez lép életbe. */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const LANGUAGE_CODES: readonly LanguageCode[] = SUPPORTED_LANGUAGES.map(
  (l) => l.code
);

export function isSupportedLanguage(code: string | undefined | null): code is LanguageCode {
  return !!code && LANGUAGE_CODES.includes(code as LanguageCode);
}

export function languageDef(code: LanguageCode): LanguageDef {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0];
}
