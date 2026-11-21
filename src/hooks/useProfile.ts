import { createAccountActions } from '@/hooks/profile/createAccountActions';
import { createAiProviderActions } from '@/hooks/profile/createAiProviderActions';
import { createProfileEditActions } from '@/hooks/profile/createProfileEditActions';
import { useProfileImage } from '@/hooks/profile/useProfileImage';
import { useProfileLoaders } from '@/hooks/profile/useProfileLoaders';
import { useProfilePerformance } from '@/hooks/profile/useProfilePerformance';
import { useProfileSession } from '@/hooks/profile/useProfileSession';
import { useProfileState } from '@/hooks/profile/useProfileState';
import { useProfileSubscription } from '@/hooks/profile/useProfileSubscription';
import type { ProxyQuality } from '@/store/editorStore';

export { EMPTY_FORM, type ProviderForm } from '@/hooks/profile/providerForm';

/**
 * 🧠 A PROFIL-képernyő NEM-prezentációs logikája (Health/02.4): a profil/creator-adat
 * betöltése/mentése + a szerkesztés-állapot, az előfizetés (Pro) részletei, az AI-provider
 * CRUD + feladat-hozzárendelések + űrlap-állapot, a teljesítmény/gyorsítótár, a kép-/
 * borító-feltöltés folyamat, valamint a GDPR/fiók/kijelentkezés handlerek. A képernyő JSX-e
 * CSAK az itt visszaadott állapotból + handlerekből olvas — a háló/Supabase/store hívások
 * VÁLTOZATLANOK.
 *
 * SZÁNDÉKOSAN EGY hookban marad a kép-választás + a borító-igazító folyamat: ezek szorosan
 * csatoltak (közös `imgBusy` + a `profile` élő-state azonnali mentése), a szétvágásuk
 * viselkedés-driftet kockáztatna.
 *
 * REFACTOR: a részek a `hooks/profile/` alatt élnek, de a hook-hívások és az effektek
 * SORRENDJE változatlan (a kép-folyamat egyben a `useProfileImage`-ben).
 */
export function useProfile() {
  'use no memo'; // a bontás után fordítható lenne, de a handlerek renderenként új identitása marad, mint előtte — a memoizálás külön döntés
  const {
    t,
    i18n,
    configured,
    email,
    userId,
    signOut,
    signOutOtherSessions,
    isPro,
    tierNow,
    canAdmin,
    proUntil,
  } = useProfileSession();
  const {
    sub,
    setSub,
    proMeta,
    setProMeta,
    loading,
    setLoading,
    profile,
    setProfile,
    savingProfile,
    setSavingProfile,
    providers,
    setProviders,
    taskAssign,
    setTaskAssign,
    form,
    setForm,
    editorOpen,
    setEditorOpen,
    savingProvider,
    setSavingProvider,
  } = useProfileState(configured);

  // 🎯 teljesítmény / gyorsítótár
  const { proxyEnabled, proxyQuality, setProxyEnabled, setProxyQuality, cacheInfo, onClearCache } =
    useProfilePerformance();

  const refresh = useProfileLoaders({
    configured,
    t,
    userId,
    isPro,
    tierNow,
    proUntil,
    setProfile,
    setProviders,
    setTaskAssign,
    setLoading,
    setSub,
    setProMeta,
  });

  const {
    setField,
    setArr,
    nameError,
    usernameError,
    phoneError,
    birthdayError,
    profileValid,
    onSaveProfile,
    detectTimezone,
  } = createProfileEditActions({ profile, setProfile, savingProfile, setSavingProfile, t });

  const { imgBusy, coverDraftUri, setCoverDraftUri, onPickProfileImage, commitCover } =
    useProfileImage({ profile, setProfile, t });

  const { onSubscribe, devBusy, onDevActivate, onDevDeactivate, onRestore } =
    useProfileSubscription(t);

  const {
    openNew,
    openEdit,
    kindMeta,
    formValid,
    onSaveProvider,
    onDeleteProvider,
    onSetDefault,
    pickTask,
    generateFormPersona,
  } = createAiProviderActions({
    form,
    setForm,
    setEditorOpen,
    savingProvider,
    setSavingProvider,
    setTaskAssign,
    refresh,
    t,
  });

  const { onSignOut, onSignOutOthers, onDeleteAccount, onExportData } = createAccountActions({
    t,
    signOut,
    signOutOtherSessions,
  });

  return {
    // i18n
    t,
    i18n,
    // alap-állapot
    configured,
    email,
    userId,
    loading,
    canAdmin,
    // profil + szerkesztés
    profile,
    setField,
    setArr,
    savingProfile,
    profileValid,
    nameError,
    usernameError,
    phoneError,
    birthdayError,
    onSaveProfile,
    detectTimezone,
    // kép / borító
    imgBusy,
    coverDraftUri,
    setCoverDraftUri,
    onPickProfileImage,
    commitCover,
    // előfizetés (Pro)
    isPro,
    sub,
    proMeta,
    onSubscribe,
    onRestore,
    devBusy,
    onDevActivate,
    onDevDeactivate,
    // AI-modellek
    providers,
    taskAssign,
    pickTask,
    onSetDefault,
    onDeleteProvider,
    openNew,
    openEdit,
    // provider-szerkesztő modal
    form,
    setForm,
    editorOpen,
    setEditorOpen,
    savingProvider,
    formValid,
    kindMeta,
    onSaveProvider,
    generateFormPersona,
    // teljesítmény / gyorsítótár
    proxyEnabled,
    proxyQuality,
    setProxyEnabled,
    setProxyQuality,
    cacheInfo,
    onClearCache,
    // fiók / GDPR
    onSignOut,
    onSignOutOthers,
    onDeleteAccount,
    onExportData,
  };
}

export type { ProxyQuality };
