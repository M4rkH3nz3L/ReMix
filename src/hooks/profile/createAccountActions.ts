import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { exportMyData, softDeleteAccount } from '@/lib/account';
import type { AuthResult } from '@/store/authStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 🔐 Fiók / GDPR handlerek (REFACTOR: a useProfile-ból) — hook-mentes csoport, minden renderben
 * újra létrehozva: adat-export, fiók-törlés, kijelentkezés (itt / mindenhol máshol).
 */
export function createAccountActions({
  t,
  signOut,
  signOutOtherSessions,
}: {
  t: TFunction;
  signOut: () => Promise<void>;
  signOutOtherSessions: () => Promise<AuthResult>;
}) {
  // 📤 GDPR adat-export: az összes saját adat JSON-ban, megosztva
  const onExportData = () => {
    exportMyData().catch((e: unknown) =>
      { logCaught('hooks/useProfile.ts:onExportData', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); }
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
              { logCaught('hooks/useProfile.ts:onDeleteAccount', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); }
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

  return { onSignOut, onSignOutOthers, onDeleteAccount, onExportData };
}
