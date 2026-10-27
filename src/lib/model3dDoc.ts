/**
 * 🧊 3D-dokumentum műveletek (3D-Studio.md §4) — pure, immutábilis függvények; az
 * eredményt a `SET_MODEL3D_DOC` parancs teszi a projektbe (undo, collab, napló).
 * A `liveDoc.ts` / `imageDoc.ts` mintáját követi.
 */
import { makeId } from '@/lib/id';
import { boundsUnion, identityTransform, transformBounds } from '@/lib/model3d';
import { defaultOrbit } from '@/lib/model3dOrbit';
import type {
  Bounds3,
  Model3DAnnotation,
  Model3DCapture,
  Model3DDoc,
  Model3DEnvironment,
  Model3DMaterialOverride,
  Model3DMeasurement,
  Model3DMesh,
  Model3DNode,
  OrbitCamera,
  Transform3,
} from '@/types/model3d';

export const DEFAULT_ENVIRONMENT: Model3DEnvironment = {
  preset: 'studio',
  background: '#111420',
  shadows: true,
  exposure: 1,
};

export function createModel3DDoc(capture?: Model3DCapture): Model3DDoc {
  return {
    id: makeId('m3d'),
    nodes: [],
    meshes: [],
    materials: [],
    environment: { ...DEFAULT_ENVIRONMENT },
    camera: defaultOrbit(),
    views: [],
    measurements: [],
    annotations: [],
    ...(capture ? { capture } : {}),
  };
}

/** háló + hozzá tartozó csomópont hozzáadása (a szken eredménye vagy import) */
export function addMesh(doc: Model3DDoc, mesh: Model3DMesh, name: string): { doc: Model3DDoc; nodeId: string } {
  const node: Model3DNode = {
    id: makeId('node'),
    name,
    meshId: mesh.id,
    transform: identityTransform(),
    visible: true,
    locked: false,
  };
  return { doc: { ...doc, meshes: [...doc.meshes, mesh], nodes: [...doc.nodes, node] }, nodeId: node.id };
}

const mapNode = (doc: Model3DDoc, id: string, f: (n: Model3DNode) => Model3DNode): Model3DDoc => ({
  ...doc,
  nodes: doc.nodes.map((n) => (n.id === id ? f(n) : n)),
});

/** zárolt csomópont NEM mozgatható (a collab-zárolás és a user-zár is ezt használja) */
export function setNodeTransform(doc: Model3DDoc, nodeId: string, transform: Transform3): Model3DDoc {
  return mapNode(doc, nodeId, (n) => (n.locked ? n : { ...n, transform }));
}

export function setNodeFlags(doc: Model3DDoc, nodeId: string, flags: Partial<Pick<Model3DNode, 'visible' | 'locked' | 'name'>>): Model3DDoc {
  return mapNode(doc, nodeId, (n) => ({ ...n, ...flags }));
}

/** csomópont törlése; a már nem hivatkozott háló, anyag és ráhivatkozó adat is kiesik */
export function removeNode(doc: Model3DDoc, nodeId: string): Model3DDoc {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return doc;
  }
  const nodes = doc.nodes.filter((n) => n.id !== nodeId);
  const meshStillUsed = nodes.some((n) => n.meshId === node.meshId);
  return {
    ...doc,
    nodes,
    meshes: meshStillUsed ? doc.meshes : doc.meshes.filter((m) => m.id !== node.meshId),
    materials: doc.materials.filter((m) => m.nodeId !== nodeId),
  };
}

/** a csomóponthoz tartozó (még élő) háló asset-id-k — a média-GC/kvóta ehhez igazodik */
export function referencedAssetIds(doc: Model3DDoc): string[] {
  const used = new Set(doc.nodes.map((n) => n.meshId));
  return doc.meshes.filter((m) => used.has(m.id)).map((m) => m.assetId);
}

export function setMaterial(doc: Model3DDoc, override: Model3DMaterialOverride): Model3DDoc {
  const clamp01 = (v?: number) => (v === undefined ? undefined : Math.min(1, Math.max(0, v)));
  const clean: Model3DMaterialOverride = {
    nodeId: override.nodeId,
    ...(override.tint ? { tint: override.tint } : {}),
    ...(override.roughness !== undefined ? { roughness: clamp01(override.roughness) } : {}),
    ...(override.metallic !== undefined ? { metallic: clamp01(override.metallic) } : {}),
    ...(override.opacity !== undefined ? { opacity: clamp01(override.opacity) } : {}),
  };
  return { ...doc, materials: [...doc.materials.filter((m) => m.nodeId !== override.nodeId), clean] };
}

export function setEnvironment(doc: Model3DDoc, patch: Partial<Model3DEnvironment>): Model3DDoc {
  const exposure = patch.exposure === undefined ? doc.environment.exposure : Math.min(2, Math.max(0.25, patch.exposure));
  return { ...doc, environment: { ...doc.environment, ...patch, exposure } };
}

export function saveView(doc: Model3DDoc, name: string, camera: OrbitCamera): { doc: Model3DDoc; viewId: string } {
  const id = makeId('view');
  return { doc: { ...doc, views: [...doc.views, { id, name, camera }] }, viewId: id };
}

export function removeView(doc: Model3DDoc, viewId: string): Model3DDoc {
  return {
    ...doc,
    views: doc.views.filter((v) => v.id !== viewId),
    annotations: doc.annotations.map((a) => (a.viewId === viewId ? { ...a, viewId: undefined } : a)),
  };
}

export function addMeasurement(doc: Model3DDoc, m: Omit<Model3DMeasurement, 'id'>): Model3DDoc {
  return { ...doc, measurements: [...doc.measurements, { ...m, id: makeId('meas') }] };
}

export function removeMeasurement(doc: Model3DDoc, id: string): Model3DDoc {
  return { ...doc, measurements: doc.measurements.filter((m) => m.id !== id) };
}

export function addAnnotation(doc: Model3DDoc, a: Omit<Model3DAnnotation, 'id'>): Model3DDoc {
  return { ...doc, annotations: [...doc.annotations, { ...a, id: makeId('note') }] };
}

export function removeAnnotation(doc: Model3DDoc, id: string): Model3DDoc {
  return { ...doc, annotations: doc.annotations.filter((a) => a.id !== id) };
}

export function setCapture(doc: Model3DDoc, patch: Partial<Model3DCapture>): Model3DDoc {
  if (!doc.capture) {
    return doc;
  }
  const progress = patch.progress === undefined ? doc.capture.progress : Math.min(1, Math.max(0, patch.progress));
  return { ...doc, capture: { ...doc.capture, ...patch, progress } };
}

/** a látható csomópontok világ-befoglalója (fit-to-view, export, poszter) */
export function sceneBounds(doc: Model3DDoc): Bounds3 | null {
  const meshById = new Map(doc.meshes.map((m) => [m.id, m]));
  const boxes = doc.nodes
    .filter((n) => n.visible)
    .map((n) => {
      const mesh = meshById.get(n.meshId);
      return mesh ? transformBounds(n.transform, mesh.bounds) : null;
    })
    .filter((b): b is Bounds3 => b !== null);
  return boundsUnion(boxes);
}

/** összegzés a kártyához/verzió-diffhez: objektumszám, háromszögek, mérések */
export function docStats(doc: Model3DDoc): { nodes: number; triangles: number; measurements: number; annotations: number } {
  const meshById = new Map(doc.meshes.map((m) => [m.id, m]));
  return {
    nodes: doc.nodes.length,
    triangles: doc.nodes.reduce((s, n) => s + (meshById.get(n.meshId)?.triangles ?? 0), 0),
    measurements: doc.measurements.length,
    annotations: doc.annotations.length,
  };
}
