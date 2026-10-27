import { requireOptionalNativeModule } from 'expo';

import { setDevice3DCaps, type Device3DCaps } from '@/lib/deviceCaps';

/**
 * 📡 A 3D-képességek natív lekérdezése (3D-Studio.md §1.1, §5) — indításkor EGYSZER.
 *
 * A `Remix3D` natív modul (modules/remix-3d) csak a 3D-1 fázistól létezik; addig
 * — és Expo Go-ban, Androidon, weben — a `requireOptionalNativeModule` `null`-t ad,
 * így a képesség-cache az alapállapotban marad (nincs LiDAR → a stúdió rejtve).
 * Hiba esetén is a biztonságos „nincs" irány érvényes.
 */
interface Remix3DNative {
  capabilities(): Promise<Partial<Device3DCaps>>;
}

export async function loadDevice3DCaps(): Promise<void> {
  try {
    const native = requireOptionalNativeModule<Remix3DNative>('Remix3D');
    if (!native) {
      return;
    }
    setDevice3DCaps(await native.capabilities());
  } catch {
    setDevice3DCaps(null);
  }
}
