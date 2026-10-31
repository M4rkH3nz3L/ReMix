import { importExtOf } from '@/lib/model3dImport';

/**
 * 📲 „Megnyitás a ReMix-szel" (Fájlok, AirDrop, Mail, más appok) — pure.
 * Az iOS a dokumentumot `file://…/Inbox/<név>` URL-ként adja át; ha 3D-fájl, az
 * import-útvonalra irányítjuk (új 3D-projekt + import). Minden más út változatlan.
 */
export function incomingModelRoute(path: string): string | null {
  if (!/^file:\/\//i.test(path)) return null;
  if (!importExtOf(path)) return null;
  return `/import3d?uri=${encodeURIComponent(path)}`;
}
