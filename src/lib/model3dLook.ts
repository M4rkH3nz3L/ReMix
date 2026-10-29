/**
 * 🎛️ A 3D-modell „megjelenése" és szerkesztése — pure (expo-mentes → tesztelhető).
 *
 * A natív néző, az állókép, a forgó videó és a fájl-export ugyanazt a megjelenést kapja
 * (`lookOptionsJson`): a modell forgatása (a befoglaló doboz KÖZEPE körül) + fény-preset +
 * expozíció. A padló-levágás és az egyszerűsítés a natív `processMesh`-szel új hálót ad;
 * ilyenkor a forgatás BEÉG a hálóba (`bakeProcessedMesh`), a mérések is átszámolódnak.
 */
import { boundsCenter, boundsCorners, boundsFromPoints, boundsRadius, quatFromAxisAngle, quatIdentity, quatMultiply, quatNormalize, rotateVec, sub, add } from '@/lib/model3d';
import type { Bounds3, Model3DDoc, Model3DMesh, Quat, Vec3 } from '@/types/model3d';

/** a dokumentum (első csomópontjának) forgatása — a stúdió egy modellt mutat */
export function modelRotation(doc: Model3DDoc | undefined): Quat {
  return doc?.nodes[0]?.transform.rotation ?? quatIdentity();
}

/** a natív `optionsJson` (néző-paritás az állóképnél / videónál / exportnál) */
export function lookOptionsJson(doc: Model3DDoc | undefined): string {
  const q = modelRotation(doc);
  return JSON.stringify({
    rotation: [q.x, q.y, q.z, q.w],
    preset: doc?.environment.preset ?? 'studio',
    exposure: doc?.environment.exposure ?? 1,
  });
}

export type RotationAxis = 'x' | 'y' | 'z';

const AXES: Record<RotationAxis, Vec3> = { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };

/** +90° forgatás a (megjelenítési) tengely körül — a ferdén szkennelt modell talpra állítása */
export function rotate90(doc: Model3DDoc, axis: RotationAxis): Model3DDoc {
  const node = doc.nodes[0];
  if (!node || node.locked) {
    return doc;
  }
  const step = quatFromAxisAngle(AXES[axis], Math.PI / 2);
  const rotation = quatNormalize(quatMultiply(step, node.transform.rotation));
  return { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, transform: { ...n.transform, rotation } } : n)) };
}

/** a forgatás alaphelyzetbe */
export function resetRotation(doc: Model3DDoc): Model3DDoc {
  const node = doc.nodes[0];
  if (!node || node.locked) {
    return doc;
  }
  return { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, transform: { ...n.transform, rotation: quatIdentity() } } : n)) };
}

export function hasRotation(doc: Model3DDoc | undefined): boolean {
  return Math.abs(modelRotation(doc).w) < 0.99999;
}

/** pont forgatása a `center` körül (a natív `wrapContent` / `rotated` konvenciója) */
export function rotateAbout(p: Vec3, center: Vec3, q: Quat): Vec3 {
  return add(center, rotateVec(q, sub(p, center)));
}

/** a háló befoglalója a MEGJELENÍTÉSI térben (a forgatás után) — a vágósík tartományához */
export function displayBounds(bounds: Bounds3, q: Quat): Bounds3 {
  const c = boundsCenter(bounds);
  return boundsFromPoints(boundsCorners(bounds).map((p) => rotateAbout(p, c, q))) ?? bounds;
}

/** a padló-levágás csúszkájának tartománya: az alsó 40% (méter, megjelenítési tér) */
export function cutRange(bounds: Bounds3, q: Quat): { min: number; max: number } {
  const b = displayBounds(bounds, q);
  return { min: b.min.y, max: b.min.y + (b.max.y - b.min.y) * 0.4 };
}

export type SimplifyLevel = 'light' | 'strong';

/** a klaszterezés rácsmérete: a befoglaló átló törtrésze (enyhe ≈ finom, erős ≈ durva) */
export function simplifyCell(bounds: Bounds3, level: SimplifyLevel): number {
  const diag = boundsRadius(bounds) * 2;
  return diag / (level === 'light' ? 300 : 120);
}

/**
 * A feldolgozott (forgatás-beégetett) háló átvétele: a csomópont forgatása alaphelyzetbe,
 * a mérések az új koordinátákba (a RÉGI háló közepe körül forgatva — a natív `rotated`-del
 * egyezően), a háló-statisztika az újból.
 */
export function bakeProcessedMesh(
  doc: Model3DDoc,
  oldMesh: Pick<Model3DMesh, 'bounds'>,
  q: Quat
): Pick<Model3DDoc, 'measurements' | 'annotations'> & { nodes: Model3DDoc['nodes'] } {
  const c = boundsCenter(oldMesh.bounds);
  const move = (p: Vec3) => rotateAbout(p, c, q);
  return {
    nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, transform: { ...n.transform, rotation: quatIdentity() } } : n)),
    measurements: doc.measurements.map((m) => ({ ...m, points: m.points.map(move) })),
    annotations: doc.annotations.map((a) => ({ ...a, at: move(a.at) })),
  };
}
