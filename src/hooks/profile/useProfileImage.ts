import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Alert } from 'react-native';

import {
  type AccountProfile,
  pickAndUploadProfileImage,
  pickProfileImageLocal,
  saveProfile,
  uploadProfileImage,
} from '@/lib/profile';
import { logCaught } from '@/lib/logCaught';

/**
 * 🖼️ Profil-/borítókép választás + a borító-igazító folyamat (REFACTOR: a useProfile-ból).
 * Szorosan csatolt (közös `imgBusy` + a `profile` élő-state azonnali mentése) → EGY hookban.
 */
export function useProfileImage({
  profile,
  setProfile,
  t,
}: {
  profile: AccountProfile;
  setProfile: Dispatch<SetStateAction<AccountProfile>>;
  t: TFunction;
}) {
  // 🖼️ profil-/borítókép: választás + feltöltés → azonnal mentjük a profilhoz
  const [imgBusy, setImgBusy] = useState(false);
  // a borítóhoz kiválasztott NYERS kép — ha van, nyitva az igazító-modal
  const [coverDraftUri, setCoverDraftUri] = useState<string | null>(null);
  const onPickProfileImage = async (kind: 'avatar' | 'cover') => {
    if (imgBusy) {
      return;
    }
    // borító: előbb kiválasztás, majd igazító-modal — a feltöltés a „Kész" után
    if (kind === 'cover') {
      try {
        const local = await pickProfileImageLocal();
        if (local) {
          setCoverDraftUri(local);
        }
      } catch (e) {
        logCaught('hooks/useProfile.ts:onPickProfileImage', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      }
      return;
    }
    setImgBusy(true);
    try {
      const url = await pickAndUploadProfileImage();
      if (!url) {
        return; // a felhasználó mégse választott
      }
      const next: AccountProfile = { ...profile, avatarUrl: url };
      setProfile(next);
      await saveProfile(next);
    } catch (e) {
      logCaught('hooks/useProfile.ts:onPickProfileImage', e);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  };

  // a borító-igazító „Kész" után: a bevágott képet feltöltjük + mentjük
  const commitCover = async (croppedUri: string) => {
    if (imgBusy) {
      return;
    }
    setImgBusy(true);
    try {
      const url = await uploadProfileImage(croppedUri);
      const next: AccountProfile = { ...profile, coverUrl: url };
      setProfile(next);
      await saveProfile(next);
      setCoverDraftUri(null); // csak sikeres mentés után zárjuk
    } catch (e) {
      logCaught('hooks/useProfile.ts:commitCover', e);
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  };

  return { imgBusy, coverDraftUri, setCoverDraftUri, onPickProfileImage, commitCover };
}
