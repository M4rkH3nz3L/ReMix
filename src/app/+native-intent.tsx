import { incomingModelRoute } from '@/lib/model3dIncoming';

/**
 * 📲 Rendszer-URL-ek átirányítása (expo-router native intent): a „Megnyitás a
 * ReMix-szel" 3D-fájl (`file://…`) az import-útvonalra megy; minden más út változatlan.
 * Hiba esetén sosem dobunk (a router dokumentációja szerint az összeomlást okozna).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return incomingModelRoute(path) ?? path;
  } catch {
    return path;
  }
}
