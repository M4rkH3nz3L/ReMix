import { useTranslation } from 'react-i18next';

import { useAuth } from '@/store/authStore';
import { useEntitlement } from '@/store/entitlementStore';
import { useRoles } from '@/store/roleStore';

/** 👤 A profil-képernyő munkamenet-adatai: i18n, auth, Pro-állapot, admin-jog (REFACTOR: a useProfile-ból). */
export function useProfileSession() {
  const { t, i18n } = useTranslation();
  const configured = useAuth((s) => s.configured);
  const email = useAuth((s) => s.user?.email ?? '');
  const userId = useAuth((s) => s.user?.id ?? null);
  const signOut = useAuth((s) => s.signOut);
  const signOutOtherSessions = useAuth((s) => s.signOutOtherSessions);
  // 💳 Pro-állapot reaktívan (aktiválás után azonnal frissül a szekció)
  const isPro = useEntitlement((s) => s.isPro());
  const tierNow = useEntitlement((s) => s.effectiveTier());
  // 🛡️ admin-belépő: csak szerep-/user-kezelő jog birtokosának látszik
  const canAdmin = useRoles(
    (s) => s.permissions.includes('role.manage') || s.permissions.includes('user.manage')
  );
  const proUntil = useEntitlement((s) => s.proUntil);
  return {
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
  };
}
