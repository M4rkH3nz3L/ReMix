import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Alert } from 'react-native';

import { activateProDev, deactivateProDev, restorePurchases } from '@/lib/billing';
import { usePaywall } from '@/store/paywallStore';
import { logCaught } from '@/lib/logCaught';

/** 💳 Előfizetés-handlerek: paywall, DEV Pro be/ki, vásárlás-visszaállítás (REFACTOR: a useProfile-ból). */
export function useProfileSubscription(t: TFunction) {
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
      logCaught('hooks/useProfile.ts:onDevActivate', e);
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
      logCaught('hooks/useProfile.ts:onDevDeactivate', e);
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
        { logCaught('hooks/useProfile.ts:onRestore', e); return Alert.alert(t('paywallSheet.errorTitle'), e instanceof Error ? e.message : String(e)); }
      );
  };

  return { onSubscribe, devBusy, onDevActivate, onDevDeactivate, onRestore };
}
