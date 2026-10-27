/**
 * 🧊 3D Stúdió — a `model3d` projekt-fajta dokumentuma (3D-Studio.md §4).
 *
 * Minden hossz MÉTERBEN (valós méretarány — a LiDAR-szkenek ezt adják), a
 * forgatás egységnyi kvaternió. A nagy fájlok (háló, textúra, pontfelhő) NEM a
 * dokumentumban élnek, hanem `Asset`-ként (`kind: 'model'`) a projekt
 * asset-registry-jében — így a felhő-mentés, a `.rp` csomag és a média-GC is látja
 * őket (3D-Studio.md §15.8). A dokumentum csak hivatkozik rájuk (`assetId`).
 */

export type Vec3 = { x: number; y: number; z: number };
/** egységnyi kvaternió (x, y, z, w) */
export type Quat = { x: number; y: number; z: number; w: number };

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export interface Transform3 {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

/** a háló forrás-formátuma */
export type MeshFormat = 'usdz' | 'obj' | 'ply' | 'stl' | 'glb';

export interface Model3DMesh {
  id: string;
  /** a projekt `assets`-beli bejegyzése (kind: 'model') */
  assetId: string;
  format: MeshFormat;
  triangles: number;
  /** a háló saját (transzformáció előtti) befoglaló doboza, méterben */
  bounds: Bounds3;
  /** pontfelhő (PLY) esetén a pontszám; hálónál nincs */
  points?: number;
  /** van-e textúrája (fotogrammetria) vagy csak csúcs-színe (szabad szken) */
  textured: boolean;
}

export interface Model3DNode {
  id: string;
  name: string;
  meshId: string;
  transform: Transform3;
  visible: boolean;
  locked: boolean;
}

export interface Model3DMaterialOverride {
  nodeId: string;
  /** #rrggbb — a teljes háló színezése (a textúra fölött szorzóként) */
  tint?: string;
  /** 0–1 */
  roughness?: number;
  /** 0–1 */
  metallic?: number;
  /** 0–1 */
  opacity?: number;
}

export type Model3DEnvironmentPreset = 'studio' | 'outdoor' | 'night';

export interface Model3DEnvironment {
  preset: Model3DEnvironmentPreset;
  /** #rrggbb vagy null = átlátszó (exportnál) */
  background: string | null;
  shadows: boolean;
  /** 0.25–2 — a megvilágítás erőssége */
  exposure: number;
}

/** orbit-kamera: a célpont körül (gömbi koordináták) */
export interface OrbitCamera {
  /** vízszintes szög, radián */
  yaw: number;
  /** függőleges szög, radián (korlátozva, hogy ne forduljon át) */
  pitch: number;
  /** a célponttól mért távolság, méter */
  distance: number;
  /** a körbeforgatás középpontja */
  target: Vec3;
  /** függőleges látószög, fok */
  fov: number;
}

export interface Model3DSavedView {
  id: string;
  name: string;
  camera: OrbitCamera;
}

export interface Model3DMeasurement {
  id: string;
  kind: 'distance' | 'area';
  /** világ-koordináták, méter — distance: 2 pont, area: ≥3 pont (poligon) */
  points: Vec3[];
  label?: string;
}

export interface Model3DAnnotation {
  id: string;
  /** a címke helye a modellen (világ-koordináta) */
  at: Vec3;
  text: string;
  /** a nézet, ahonnan a címke a legjobban látszik (a kommentekhez is — §15.6) */
  viewId?: string;
}

export type CaptureMode = 'object' | 'room' | 'freeform' | 'pointcloud';
export type CaptureQuality = 'preview' | 'medium' | 'full';
export type CaptureStatus = 'capturing' | 'reconstructing' | 'ready' | 'failed';

/** RoomPlan-összegzés (3D-Studio.md §2.2) — a JSON-ból számolva (`roomPlanSummary`) */
export interface RoomSummary {
  floorArea: number;
  walls: { id: string; length: number; height: number }[];
  openings: { id: string; kind: 'door' | 'window' | 'opening'; width: number; height: number }[];
  objects: { id: string; category: string; dimensions: Vec3 }[];
  /** alaprajz-poligon (felülnézet, x/z méterben) */
  floorPolygon: { x: number; z: number }[];
}

export interface Model3DCapture {
  mode: CaptureMode;
  quality: CaptureQuality;
  status: CaptureStatus;
  /** az eszköz modellneve (pl. „iPhone 17 Pro Max") */
  device: string;
  /** a rögzítés kezdete (ISO) */
  startedAt: string;
  /** fotogrammetriánál a képszám */
  images?: number;
  /** 0–1 rekonstrukció-haladás (status = reconstructing) */
  progress?: number;
  /** hiba esetén ember-olvasható ok (nem fejlesztői zsargon) */
  error?: string;
  room?: RoomSummary;
}

export interface Model3DDoc {
  id: string;
  nodes: Model3DNode[];
  meshes: Model3DMesh[];
  materials: Model3DMaterialOverride[];
  environment: Model3DEnvironment;
  /** az aktuális néző-kamera (NEM history-elem — a nézet forgatása nem szerkesztés) */
  camera: OrbitCamera;
  views: Model3DSavedView[];
  measurements: Model3DMeasurement[];
  annotations: Model3DAnnotation[];
  capture?: Model3DCapture;
}

/**
 * 🔗 Egy kép-réteg / videó-klip forrás-hivatkozása, ha 3D-modellből renderelt
 * (3D-Studio.md §8.1) — LiDAR-os eszközön ebből lesz az „Újrarenderelés" gomb, és a
 * Creative Graph ebből húz élt a modell és a származékai közé (§15.2).
 */
export interface Source3D {
  projectId: string;
  camera: OrbitCamera;
  environment: Model3DEnvironment;
  /** videónál a kamerapálya-beállítás (turntable / pálya) */
  path?: { kind: 'turntable' | 'views'; seconds: number; degrees?: number; viewIds?: string[] };
}
