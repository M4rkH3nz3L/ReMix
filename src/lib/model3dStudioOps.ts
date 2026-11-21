/**
 * 🧊 A 3D Stúdió képernyőjének expo-mentes döntései (REFACTOR: a Model3DStudio.tsx-ből) —
 * rögzítési útmutatás, poszter-fájlnév, néző-ciklusok, mérés-vonalak, import-hibakulcs,
 * a `processMesh` opciói. Pure → önmagában tesztelhető.
 */
import { simplifyCell, type SimplifyLevel } from '@/lib/model3dLook';
import type { Bounds3, CaptureMode, Model3DCapture, Model3DMeasurement, Quat, RoomSummary } from '@/types/model3d';

/** ARKit környezeti fény alatta „kevés a fény" (normál beltér ~1000) */
export const DARK_LIGHT = 300;

/** a háttér-ciklus: sötét → világos → átlátszó (a néző a SceneKit-háttérrel) */
export const BACKGROUNDS: (string | null)[] = ['#111420', '#f2f2f5', null];

/** a ciklus következő eleme (ismeretlen aktuális → az első) */
export function nextInCycle<T>(cycle: readonly T[], current: T): T {
  const i = cycle.indexOf(current);
  return cycle[(i + 1) % cycle.length];
}

/** a rögzítés metaadata (mód, eszköz, kezdés) — a projekt-dokumentumba kerül */
export function captureMetaOf(mode: CaptureMode, device: string, startedAt: string): Model3DCapture {
  return {
    mode,
    quality: 'medium',
    status: 'ready',
    device,
    startedAt,
  };
}

/** a lista-előnézet (poszter) fájlja a projekt mappájában */
export function posterFileUri(mediaDirUri: string, assetId: string): string {
  return `${mediaDirUri.replace(/\/?$/, '/')}m3d_${assetId}_poster.png`;
}

/** a pótolt poszter ÚJ fájlnéven (a doc változik → a lista-bélyegkép frissül) */
export function refreshedPosterUri(mediaDirUri: string, assetId: string, stamp: string): string {
  return `${mediaDirUri.replace(/\/?$/, '/')}m3d_${assetId}_poster_${stamp}.png`;
}

/** a távolság-mérések szakaszai a nézőnek: 6 szám / szakasz */
export function measureLineCoords(measurements: readonly Model3DMeasurement[]): number[] {
  return measurements
    .filter((m) => m.kind === 'distance' && m.points.length >= 2)
    .flatMap((m) => [m.points[0].x, m.points[0].y, m.points[0].z, m.points[1].x, m.points[1].y, m.points[1].z]);
}

/** a natív olvasó hibaüzenete → az import i18n-kulcsa */
export function importReadErrorKey(msg: string, ext: string): string {
  return msg.includes('fbxAscii')
    ? 'model3d.import.fbxAscii'
    : msg.includes('zipNoModel')
      ? 'model3d.import.zipNoModel'
      : ext === 'gltf'
        ? 'model3d.import.gltfExternal'
        : 'model3d.import.unreadable';
}

/** a natív `processMesh` opciói: a forgatás beég, opcionális padló-vágás / egyszerűsítés */
export function processMeshOptionsJson(q: Quat, op: { cutY?: number; simplify?: SimplifyLevel }, bounds: Bounds3): string {
  return JSON.stringify({
    rotation: [q.x, q.y, q.z, q.w],
    ...(op.cutY !== undefined ? { cutY: op.cutY } : {}),
    ...(op.simplify ? { cell: simplifyCell(bounds, op.simplify) } : {}),
  });
}

/** ⏱️ elakadt inicializálás: 5 mp után „lassú indulás”, 20 mp után „elakadt” útmutatás */
export function captureStuckHintKey(state: string, initElapsed: number): string | null {
  return state === 'initializing' && initElapsed >= 20000
    ? 'model3d.capture.hint_stuck'
    : state === 'initializing' && initElapsed >= 5000
      ? 'model3d.capture.hint_slowStart'
      : null;
}

/** a rögzítés fő gombjának címkéje (null → pörgő jelző) */
export function capturePrimaryKey(state: string): string | null {
  return state === 'ready'
    ? 'model3d.capture.select'
    : state === 'detecting'
      ? 'model3d.capture.start'
      : state === 'capturing'
        ? 'model3d.capture.finish'
        : null;
}

/** a hálós szken „Kész” gombja: pontfelhőnél pont, hálónál háromszög kell */
export function meshFinishDisabled(scanMode: 'mesh' | 'points', scanState: { triangles: number; points?: number }): boolean {
  return scanMode === 'points' ? !scanState.points : scanState.triangles === 0;
}

/** a szoba-kártya darabszámai */
export function roomCounts(room: RoomSummary): { doors: number; windows: number; objects: number } {
  return {
    doors: room.openings.filter((o) => o.kind === 'door').length,
    windows: room.openings.filter((o) => o.kind === 'window').length,
    objects: room.objects.length,
  };
}
