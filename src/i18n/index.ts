/**
 * 🌍 i18n — a többnyelvűsítés indítása (Angol · Német · Magyar).
 *
 * - Eszköz-nyelv felismerése `expo-localization`-nal (első indításkor),
 * - a felhasználó kézi választása AsyncStorage-ban marad (mint a többi store),
 * - a `t('kulcs')` sima stringet ad vissza, így beültethető a meglévő
 *   `<Text>` / `label=` mintába JSX-átalakítás nélkül.
 *
 * A modult a gyökér-layout (`src/app/_layout.tsx`) importálja legelőször, így
 * az init lefut minden `useTranslation()` előtt. A mentett választást a
 * `hydrateLanguage()` tölti be indításkor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n, { changeLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import hu from './locales/hu.json';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  isSupportedLanguage,
  type LanguageCode,
} from './languages';

const STORAGE_KEY = 'remix.lang.v1';

export const resources = {
  en: { translation: en },
  de: { translation: de },
  hu: { translation: hu },
} as const;

/** Eszköz-nyelv → támogatott nyelv (első találat), különben az alap-nyelv. */
function detectDeviceLanguage(): LanguageCode {
  try {
    for (const loc of getLocales()) {
      const code = loc.languageCode?.toLowerCase();
      if (isSupportedLanguage(code)) {
        return code;
      }
    }
  } catch {
    // a locale-lekérés best-effort; hiba esetén az alap-nyelv marad
  }
  return DEFAULT_LANGUAGE;
}

if (!i18n.isInitialized) {
  // i18next dual-export idiom: az `i18n.use(...)` a helyes hívás; a named `use`
  // a React 19 `use`-hook szabályába ütközne (rules-of-hooks).
  // eslint-disable-next-line import/no-named-as-default-member
  void i18n.use(initReactI18next).init({
    resources,
    lng: detectDeviceLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGE_CODES],
    interpolation: {
      // A React/React Native maga kezeli a megjelenítést; nincs HTML-escaping.
      escapeValue: false,
    },
    returnNull: false,
  });
}

/** Mentett nyelvválasztás betöltése (app-indításkor, egyszer). */
export async function hydrateLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupportedLanguage(saved) && saved !== i18n.language) {
      await changeLanguage(saved);
    }
  } catch {
    // sérült/hiányzó mentés — a felismert eszköz-nyelv marad
  }
}

/** Nyelv váltása + perzisztálás (a nyelvválasztó hívja). */
export async function setLanguage(code: LanguageCode): Promise<void> {
  await changeLanguage(code);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, code);
  } catch {
    // best-effort; a memóriabeli váltás akkor is megtörtént
  }
}

/** A jelenlegi (támogatott) nyelvkód — store-on kívüli logikához. */
export function currentLanguage(): LanguageCode {
  return isSupportedLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

export default i18n;
