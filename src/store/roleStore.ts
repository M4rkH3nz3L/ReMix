import { create } from 'zustand';

import { fetchMyPermissions, type PermissionKey } from '@/lib/roles';

/**
 * 🛡️ A bejelentkezett user GLOBÁLIS governance-jogai (RBAC). Belépéskor töltődik
 * (az authStore auth-váltás-figyelőjéből), kijelentkezéskor ürül. A TARTALOM-
 * KÖTÖTT jogokat (saját projekt/poszt) NEM ez adja — azok az ownership-ből
 * jönnek; a hívó helyek VAGY-ozzák: `saját tartalom || can(globálisJog)`.
 */
interface RoleState {
  permissions: string[];
  loaded: boolean;
  /** A jogok újratöltése a szerverről (login/auth-váltáskor). */
  refresh: () => Promise<void>;
  /** Van-e a usernek adott GLOBÁLIS joga. */
  can: (key: PermissionKey) => boolean;
}

export const useRoles = create<RoleState>((set, get) => ({
  permissions: [],
  loaded: false,
  refresh: async () => {
    try {
      const perms = await fetchMyPermissions();
      set({ permissions: perms, loaded: true });
    } catch {
      set({ permissions: [], loaded: true });
    }
  },
  can: (key) => get().permissions.includes(key),
}));

/** Komponensen kívüli, egyszeri ellenőrzés (pl. lib-ekben, feltételekben). */
export function can(key: PermissionKey): boolean {
  return useRoles.getState().permissions.includes(key);
}
