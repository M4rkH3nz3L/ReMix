/**
 * 📡 Eszköz-képességek a 3D Stúdióhoz — a LiDAR-kapu EGYETLEN forrása
 * (3D-Studio.md §1.1: „ha nincs LiDAR, meg se jelenjen az appon belül").
 *
 * Pure + modul-szintű cache: a natív lekérdezést a `deviceCapsClient` végzi
 * indításkor, és ide írja be; minden belépési pont (fajta-választó, projektlista,
 * ⌘K, útvonal-guard, tutorial) innen olvas. Amíg nincs natív modul (Expo Go,
 * Android, web, Jest), az alapállapot: SEMMI nem támogatott → a stúdió rejtve.
 */
export interface Device3DCaps {
  hasLiDAR: boolean;
  supportsObjectCapture: boolean;
  supportsRoomPlan: boolean;
  supportsSceneReconstruction: boolean;
}

export const NO_3D_CAPS: Device3DCaps = Object.freeze({
  hasLiDAR: false,
  supportsObjectCapture: false,
  supportsRoomPlan: false,
  supportsSceneReconstruction: false,
});

let current: Device3DCaps = NO_3D_CAPS;

/** a natív lekérdezés eredménye (vagy teszt) — a hiányzó mező = false */
export function setDevice3DCaps(caps: Partial<Device3DCaps> | null | undefined): void {
  current = {
    hasLiDAR: !!caps?.hasLiDAR,
    supportsObjectCapture: !!caps?.supportsObjectCapture,
    supportsRoomPlan: !!caps?.supportsRoomPlan,
    supportsSceneReconstruction: !!caps?.supportsSceneReconstruction,
  };
}

export function device3DCaps(): Device3DCaps {
  return current;
}

/** a 3D Stúdió létezik-e ezen az eszközön (LiDAR + valós idejű háló-rekonstrukció) */
export function has3DStudio(caps: Device3DCaps = current): boolean {
  return caps.hasLiDAR && caps.supportsSceneReconstruction;
}

export type CaptureModeId = 'object' | 'room' | 'freeform' | 'pointcloud';

/**
 * A módválasztóban megjelenő rögzítési módok — a nem támogatott mód NEM látszik
 * (rejtés, nem tiltás — a user-döntés szellemében). LiDAR nélkül üres.
 */
export function availableCaptureModes(caps: Device3DCaps = current): CaptureModeId[] {
  if (!has3DStudio(caps)) {
    return [];
  }
  const out: CaptureModeId[] = [];
  if (caps.supportsObjectCapture) out.push('object');
  if (caps.supportsRoomPlan) out.push('room');
  out.push('freeform', 'pointcloud');
  return out;
}
