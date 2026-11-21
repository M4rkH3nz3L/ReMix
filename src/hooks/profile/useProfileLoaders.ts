import { useFocusEffect } from 'expo-router';
import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';

import { type AiProvider, type AiTask, listAiProviders, listTaskAssignments } from '@/lib/aiProviders';
import { type AccountProfile, fetchProfile } from '@/lib/profile';
import { fetchSubscriptionDetails, type SubscriptionDetails } from '@/lib/subscription';
import { logCaught } from '@/lib/logCaught';
import type { Tier } from '@/lib/tiers';

/**
 * 🔄 A profil-adatok betöltése (fókuszkor) + az előfizetés részletei (REFACTOR: a useProfile-ból,
 * az eredeti hook- és effekt-sorrendben). Visszaadja a `refresh`-t.
 */
export function useProfileLoaders({
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
}: {
  configured: boolean;
  t: TFunction;
  userId: string | null;
  isPro: boolean;
  tierNow: Tier;
  proUntil: string | null;
  setProfile: Dispatch<SetStateAction<AccountProfile>>;
  setProviders: Dispatch<SetStateAction<AiProvider[]>>;
  setTaskAssign: Dispatch<SetStateAction<Partial<Record<AiTask, string>>>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setSub: Dispatch<SetStateAction<SubscriptionDetails | null>>;
  setProMeta: Dispatch<SetStateAction<{ untilText: string; updatedText: string | null }>>;
}) {
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
      logCaught('hooks/useProfile.ts:refresh', e);
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [configured, t, setProfile, setProviders, setTaskAssign, setLoading]);

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
      .catch((caught) => { logCaught('hooks/useProfile.ts:useProfile', caught); });
  }, [userId, isPro, tierNow, proUntil, t, setSub, setProMeta]);

  return refresh;
}
