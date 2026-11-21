import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { type AccountProfile, saveProfile } from '@/lib/profile';
import { profileFieldErrors } from '@/hooks/profile/profileValidation';
import { logCaught } from '@/lib/logCaught';

/**
 * ✏️ A személyes adatok szerkesztése (REFACTOR: a useProfile-ból) — hook-mentes csoport, minden
 * renderben újra létrehozva: mező-setterek, validáció, mentés, időzóna-felismerés.
 */
export function createProfileEditActions({
  profile,
  setProfile,
  savingProfile,
  setSavingProfile,
  t,
}: {
  profile: AccountProfile;
  setProfile: Dispatch<SetStateAction<AccountProfile>>;
  savingProfile: boolean;
  setSavingProfile: Dispatch<SetStateAction<boolean>>;
  t: TFunction;
}) {
  // — személyes adatok —
  const setField = (key: keyof AccountProfile, value: string) =>
    setProfile((prev) => ({ ...prev, [key]: value }));
  // — tömb-mezők (creator-típusok, készségek, érdeklődés, nyelvek) —
  const setArr = (key: 'creatorTypes' | 'skills' | 'interests' | 'languages', value: string[]) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const { nameError, usernameError, phoneError, birthdayError, profileValid } =
    profileFieldErrors(profile);

  const saveProfileAsync = async () => {
    if (!profileValid || savingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      await saveProfile(profile);
      Alert.alert(t('profile.savedTitle'), t('profile.profileSaved'));
    } catch (e) {
      logCaught('hooks/useProfile.ts:saveProfileAsync', e);
      const msg = e instanceof Error ? e.message : String(e);
      // beszédes üzenet a username-hibákra (a lib sentinel-kódot dob)
      const friendly =
        msg === 'USERNAME_TAKEN'
          ? t('profile.usernameTaken')
          : msg === 'USERNAME_REQUIRED'
            ? t('auth.usernameHint')
            : msg;
      Alert.alert(t('common.error'), friendly);
    } finally {
      setSavingProfile(false);
    }
  };
  // a mentés a UI-nak szinkron (void) handler — a floating-promise a hookban nyel el
  const onSaveProfile = () => {
    void saveProfileAsync();
  };

  // időzóna automatikus kitöltése az eszközről (Intl; ha nincs, csendben kihagyjuk)
  const detectTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        setField('timezone', tz);
      }
    } catch (caught) {
      logCaught('hooks/useProfile.ts:detectTimezone', caught);
      /* Intl/timeZone nem elérhető — marad a kézi bevitel */
    }
  };

  return {
    setField,
    setArr,
    nameError,
    usernameError,
    phoneError,
    birthdayError,
    profileValid,
    onSaveProfile,
    detectTimezone,
  };
}
