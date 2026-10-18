import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { type CacheReport, cacheReport, clearCaches } from '@/lib/cacheManager';
import { type ProxyQuality, useEditorStore } from '@/store/editorStore';
import {
  isNonEmpty,
  isValidBirthday,
  isValidFullName,
  isValidPhone,
  isValidUsername,
} from '@/lib/accountValidation';
import {
  AI_PROVIDER_KINDS,
  type AiProvider,
  type AiProviderKind,
  type AiTask,
  createAiProvider,
  deleteAiProvider,
  listAiProviders,
  listTaskAssignments,
  setDefaultAiProvider,
  setTaskAssignment,
  updateAiProvider,
} from '@/lib/aiProviders';
import { DEFAULT_AVATAR, randomAvatar, type AvatarConfig } from '@/lib/avatar';
import { generatePersona } from '@/lib/aiPersona';
import { activateProDev, deactivateProDev, restorePurchases } from '@/lib/billing';
import { syncMyPostsAvatar } from '@/lib/feed';
import {
  type AccountProfile,
  emptyProfile,
  fetchProfile,
  pickAndUploadProfileImage,
  pickProfileImageLocal,
  saveProfile,
  uploadProfileImage,
} from '@/lib/profile';
import { fetchSubscriptionDetails, type SubscriptionDetails } from '@/lib/subscription';
import { useAuth } from '@/store/authStore';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';
import { useRoles } from '@/store/roleStore';
import { exportMyData, softDeleteAccount } from '@/lib/account';

/** 🤖 Az AI-provider szerkesztő-űrlapja (új = `id: null`, egyébként meglévő). */
export interface ProviderForm {
  id: string | null; // null = új
  label: string;
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  personaName: string;
  personaEmoji: string;
  personaStory: string;
  capabilities: string[];
  avatar: AvatarConfig;
}

export const EMPTY_FORM: ProviderForm = {
  id: null,
  label: '',
  provider: 'openai',
  baseUrl: '',
  model: '',
  apiKey: '',
  personaName: '',
  personaEmoji: '',
  personaStory: '',
  capabilities: [],
  avatar: DEFAULT_AVATAR,
};

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
 */
export function useProfile() {
  const { t, i18n } = useTranslation();
  const configured = useAuth((s) => s.configured);
  const email = useAuth((s) => s.user?.email ?? '');
  const userId = useAuth((s) => s.user?.id ?? null);
  const signOut = useAuth((s) => s.signOut);
  const signOutOtherSessions = useAuth((s) => s.signOutOtherSessions);
  // 💳 Pro-állapot reaktívan (aktiválás után azonnal frissül a szekció)
  const isPro = useEntitlement((s) => s.isPro());
  // 🛡️ admin-belépő: csak szerep-/user-kezelő jog birtokosának látszik
  const canAdmin = useRoles(
    (s) => s.permissions.includes('role.manage') || s.permissions.includes('user.manage')
  );
  const proUntil = useEntitlement((s) => s.proUntil);
  const [sub, setSub] = useState<SubscriptionDetails | null>(null);
  // a dátum-kijelzéseket effektben számoljuk (a render TISZTA marad — react-hooks/purity)
  const [proMeta, setProMeta] = useState<{ untilText: string; updatedText: string | null }>({
    untilText: '',
    updatedText: null,
  });

  // configured=false esetén nincs mit tölteni → azonnal false (nem villog a spinner)
  const [loading, setLoading] = useState(configured);
  const [profile, setProfile] = useState<AccountProfile>(() => emptyProfile());
  const [savingProfile, setSavingProfile] = useState(false);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  // 🤖 feladat → provider hozzárendelések (a „AI-modellek feladatonként" mátrixhoz)
  const [taskAssign, setTaskAssign] = useState<Partial<Record<AiTask, string>>>({});

  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [editorOpen, setEditorOpen] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  // 🎯 teljesítmény / gyorsítótár
  const proxyEnabled = useEditorStore((s) => s.proxyEnabled);
  const proxyQuality = useEditorStore((s) => s.proxyQuality);
  const setProxyEnabled = useEditorStore((s) => s.setProxyEnabled);
  const setProxyQuality = useEditorStore((s) => s.setProxyQuality);
  const [cacheInfo, setCacheInfo] = useState<CacheReport>(() => cacheReport());
  const onClearCache = useCallback(() => {
    clearCaches();
    setCacheInfo(cacheReport());
  }, []);

  // adatok betöltése/frissítése — promise-chain (a setState .then/.finally
  // callbackben fut, nem az effekt szinkron testében), fókuszkor újratölt
  const refresh = useCallback(() => {
    if (!configured) {
      return;
    }
    Promise.all([fetchProfile(), listAiProviders(), listTaskAssignments()])
      .then(([p, list, tasks]) => {
        setProfile(p);
        setProviders(list);
        setTaskAssign(tasks);
      })
      .catch((e: unknown) => {
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [configured, t]);

  useFocusEffect(refresh);

  // 💳 az előfizetés részletei (minden adat) — betöltés + a Pro-állapot
  // változásakor (pl. aktiválás/visszaállítás után) újratöltés
  // az előfizetés részletei + a dátum-kijelzések. A setState a .then callbackben
  // fut (nem az effekt szinkron testében — react-hooks/set-state-in-effect), és a
  // Date-hívások is ott (nem renderben — react-hooks/purity).
  useEffect(() => {
    const uid = userId;
    Promise.resolve(uid ? fetchSubscriptionDetails(uid) : null)
      .then((d) => {
        setSub(d);
        let untilText = '';
        if (uid) {
          if (proUntil) {
            const days = Math.max(0, Math.ceil((Date.parse(proUntil) - Date.now()) / 86400000));
            untilText = `${new Date(proUntil).toLocaleDateString()} · ${t('profile.subDaysLeft', { count: days })}`;
          } else {
            untilText = t('profile.subForever');
          }
        }
        const updatedText = d?.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : null;
        setProMeta({ untilText, updatedText });
      })
      .catch(() => {});
  }, [userId, isPro, proUntil, t]);

  // — személyes adatok —
  const setField = (key: keyof AccountProfile, value: string) =>
    setProfile((prev) => ({ ...prev, [key]: value }));
  // — tömb-mezők (creator-típusok, készségek, érdeklődés, nyelvek) —
  const setArr = (key: 'creatorTypes' | 'skills' | 'interests' | 'languages', value: string[]) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const nameError = profile.fullName.length > 0 && !isValidFullName(profile.fullName);
  const usernameError = profile.username.length > 0 && !isValidUsername(profile.username);
  const phoneError = profile.phone.length > 0 && !isValidPhone(profile.phone);
  const birthdayError = profile.birthday.length > 0 && !isValidBirthday(profile.birthday);
  const profileValid =
    isValidUsername(profile.username) &&
    isValidFullName(profile.fullName) &&
    isValidPhone(profile.phone) &&
    isValidBirthday(profile.birthday) &&
    isNonEmpty(profile.country) &&
    isNonEmpty(profile.city);

  const saveProfileAsync = async () => {
    if (!profileValid || savingProfile) {
      return;
    }
    setSavingProfile(true);
    try {
      await saveProfile(profile);
      Alert.alert(t('profile.savedTitle'), t('profile.profileSaved'));
    } catch (e) {
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
    } catch {
      /* Intl/timeZone nem elérhető — marad a kézi bevitel */
    }
  };

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
      // a profilkép változását a KORÁBBI posztokra is átvezetjük (denormalizált feed-avatar)
      void syncMyPostsAvatar(url);
    } catch (e) {
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
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy(false);
    }
  };

  // 💳 előfizetés — feliratkozás (paywall) + korábbi vásárlás visszaállítása
  const onSubscribe = () => usePaywall.getState().open();

  // 🧪 CSAK DEV: közvetlen Pro be/ki a szerver-hiteles /billing/activate|deactivate-tel.
  // Éles buildben (__DEV__ === false) NEM renderelődik → ott kizárólag a valós IAP.
  // A kliens itt sem grantel magának: a workert kéri (service_role a subscriptions-höz).
  const [devBusy, setDevBusy] = useState(false);
  const onDevActivate = async () => {
    if (devBusy) {
      return;
    }
    setDevBusy(true);
    try {
      await activateProDev();
      Alert.alert(t('profile.devProTitle'), t('profile.devProActivated'));
    } catch (e) {
      Alert.alert(t('profile.devProTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setDevBusy(false);
    }
  };
  const onDevDeactivate = async () => {
    if (devBusy) {
      return;
    }
    setDevBusy(true);
    try {
      await deactivateProDev();
      Alert.alert(t('profile.devProTitle'), t('profile.devProDeactivated'));
    } catch (e) {
      // a deactivate/refreshEntitlement hibáját is jelezzük (szimmetria az activate-tel)
      Alert.alert(t('profile.devProTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setDevBusy(false);
    }
  };
  const onRestore = () => {
    restorePurchases()
      .then((ok) =>
        Alert.alert(
          t('paywallSheet.restoreTitle'),
          ok ? t('paywallSheet.restoreOk') : t('paywallSheet.restoreNone')
        )
      )
      .catch((e: unknown) =>
        Alert.alert(t('paywallSheet.errorTitle'), e instanceof Error ? e.message : String(e))
      );
  };

  // — AI-modellek —
  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };
  const openEdit = (p: AiProvider) => {
    setForm({
      id: p.id,
      label: p.label,
      provider: p.provider,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: p.apiKey,
      personaName: p.personaName ?? '',
      personaEmoji: p.personaEmoji ?? '',
      personaStory: p.personaStory ?? '',
      capabilities: p.capabilities ?? [],
      avatar: p.avatar ?? DEFAULT_AVATAR,
    });
    setEditorOpen(true);
  };

  const kindMeta = AI_PROVIDER_KINDS[form.provider];
  const formValid =
    form.label.trim().length > 0 &&
    form.model.trim().length > 0 &&
    (form.provider !== 'custom' || form.baseUrl.trim().length > 0) &&
    (!kindMeta.needsKey || form.apiKey.trim().length > 0);

  const saveProviderAsync = async () => {
    if (!formValid || savingProvider) {
      return;
    }
    setSavingProvider(true);
    const input = {
      label: form.label,
      provider: form.provider,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
      // EGY név: a persona neve = a modell neve (a „Név" mező), így a szerkesztő
      // asszisztens-köszönései is ugyanazt a nevet használják
      personaName: form.label,
      personaEmoji: form.personaEmoji,
      personaStory: form.personaStory,
      capabilities: form.capabilities,
      avatar: form.avatar,
    };
    try {
      if (form.id) {
        await updateAiProvider(form.id, input);
      } else {
        await createAiProvider(input);
      }
      setEditorOpen(false);
      refresh();
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProvider(false);
    }
  };
  // a provider-mentés is szinkron (void) handler a UI felé
  const onSaveProvider = () => {
    void saveProviderAsync();
  };

  const onDeleteProvider = (p: AiProvider) => {
    Alert.alert(p.label, t('profile.deleteModelConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          deleteAiProvider(p.id)
            .then(() => refresh())
            .catch((e: Error) => Alert.alert(t('common.error'), e.message));
        },
      },
    ]);
  };

  const onSetDefault = (p: AiProvider) => {
    if (p.isDefault) {
      return;
    }
    setDefaultAiProvider(p.id)
      .then(() => refresh())
      .catch((e: Error) => Alert.alert(t('common.error'), e.message));
  };

  // 🤖 feladat → provider választás (Auto = null); optimista + perzisztálva
  const pickTask = (task: AiTask, providerId: string | null) => {
    setTaskAssign((prev) => {
      const next = { ...prev };
      if (providerId) {
        next[task] = providerId;
      } else {
        delete next[task];
      }
      return next;
    });
    setTaskAssignment(task, providerId).catch((e: Error) =>
      Alert.alert(t('common.error'), e.message)
    );
  };

  // 🧑‍🎨 persona-generátor az űrlapon (a „Generálás" gombhoz)
  const generateFormPersona = () => {
    const p = generatePersona(form.capabilities);
    setForm((f) => ({
      ...f,
      // csak akkor ad nevet, ha még nincs — a beírt nevet (pl. GYP) megőrzi
      label: f.label.trim() ? f.label : p.name,
      personaStory: p.story,
      avatar: randomAvatar(),
    }));
  };

  // 📤 GDPR adat-export: az összes saját adat JSON-ban, megosztva
  const onExportData = () => {
    exportMyData().catch((e: unknown) =>
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
    );
  };

  // 🗑️ GDPR soft-delete: a fiók deaktiválása (visszaállítható), majd kijelentkezés
  const onDeleteAccount = () => {
    Alert.alert(t('gdpr.deleteTitle'), t('gdpr.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('gdpr.deleteConfirm'),
        style: 'destructive',
        onPress: () =>
          softDeleteAccount()
            .then(() => {
              void signOut();
            })
            .catch((e: unknown) =>
              Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
            ),
      },
    ]);
  };

  const onSignOut = () => {
    Alert.alert(t('auth.account'), t('auth.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  const onSignOutOthers = () => {
    Alert.alert(t('auth.signOutOthers'), t('auth.signOutOthersConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOutOthers'),
        style: 'destructive',
        onPress: async () => {
          const result = await signOutOtherSessions();
          Alert.alert(t('auth.signOutOthers'), result.error ?? t('auth.signOutOthersDone'));
        },
      },
    ]);
  };

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
