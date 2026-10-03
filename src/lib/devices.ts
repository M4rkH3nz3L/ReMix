import { getInstallId } from '@/lib/deviceInfo';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 📱 Bejelentkezett eszközök listája/kezelése (08 — session/device-management).
 *
 * A sorok a `user_devices` táblából jönnek (RLS: csak a saját). A „sor törlése"
 * a telemetria-sort veszi ki (`devices_delete_own`). ⚠️ Megjegyzés: a Supabase
 * nem ad per-session (per-eszköz) token-visszavonást a kliensről — a TÉNYLEGES
 * kiléptetés a „többi munkamenet kiléptetése" (`signOutOtherSessions`, scope:'others')
 * bulk-művelet. Ez a lista a LÁTHATÓSÁGOT adja (mely eszköz, mikor), + a sor-törlést.
 */
export interface UserDevice {
  fingerprint: string;
  label: string;
  platform: string | null;
  osName: string | null;
  osVersion: string | null;
  appVersion: string | null;
  lastSeen: string | null;
  isCurrent: boolean;
}

interface RawDevice {
  fingerprint: string;
  platform: string | null;
  device_name: string | null;
  model_name: string | null;
  product_name: string | null;
  os_name: string | null;
  os_version: string | null;
  app_version: string | null;
  last_seen: string | null;
}

export async function listMyDevices(): Promise<UserDevice[]> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  if (!uid) {
    return [];
  }
  const current = await getInstallId();
  const { data, error } = await sb
    .from('user_devices')
    .select('fingerprint, platform, device_name, model_name, product_name, os_name, os_version, app_version, last_seen')
    .eq('user_id', uid)
    .order('last_seen', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as RawDevice[]).map((d) => ({
    fingerprint: d.fingerprint,
    label: d.device_name || d.model_name || d.product_name || d.platform || d.fingerprint.slice(0, 8),
    platform: d.platform,
    osName: d.os_name,
    osVersion: d.os_version,
    appVersion: d.app_version,
    lastSeen: d.last_seen,
    isCurrent: d.fingerprint === current,
  }));
}

/** A kijelölt eszköz telemetria-sorának törlése (a jelenlegi eszköz nem törölhető). */
export async function removeDeviceEntry(fingerprint: string): Promise<void> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { error } = await sb
    .from('user_devices')
    .delete()
    .eq('user_id', uid)
    .eq('fingerprint', fingerprint);
  if (error) {
    throw new Error(error.message);
  }
}
