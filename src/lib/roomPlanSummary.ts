/**
 * 🏠 RoomPlan-összegzés (3D-Studio.md §2.2) — a natív modul által adott, KÖNNYŰ
 * szoba-leírásból (falak/nyílások/objektumok méretekkel és transzformációval)
 * alapterület, falhosszak, nyílás-lista és alaprajz-poligon. Pure, tesztelt — a
 * natív oldal csak a nyers számokat adja, a jelentés itt születik.
 *
 * A bemenet szándékosan a SAJÁT, stabil sémánk (`RawRoom`) — nem a RoomPlan
 * belső típusa —, így az SDK-változás csak a natív leképezést érinti.
 */
import type { RoomSummary, Vec3 } from '@/types/model3d';

export interface RawRoomSurface {
  id: string;
  /** szélesség (m) — falnál a hossz */
  width: number;
  height: number;
  /** a felület középpontja (világ, m) */
  center: Vec3;
  /** a felület iránya a függőleges tengely körül (radián) */
  yaw: number;
}

export interface RawRoom {
  walls: RawRoomSurface[];
  doors: RawRoomSurface[];
  windows: RawRoomSurface[];
  openings: RawRoomSurface[];
  objects: { id: string; category: string; dimensions: Vec3 }[];
  /** a padló sarokpontjai (felülnézet), ha a natív oldal adja */
  floor?: { x: number; z: number }[];
}

/** shoelace-képlet (felülnézeti poligon területe, m²) */
export function shoelaceArea(poly: { x: number; z: number }[]): number {
  if (poly.length < 3) {
    return 0;
  }
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

/** a fal két végpontja felülnézetben (közép ± fél hossz a fal irányában) */
export function wallEndpoints(w: RawRoomSurface): [{ x: number; z: number }, { x: number; z: number }] {
  const dx = (Math.cos(w.yaw) * w.width) / 2;
  const dz = (-Math.sin(w.yaw) * w.width) / 2;
  return [
    { x: w.center.x - dx, z: w.center.z - dz },
    { x: w.center.x + dx, z: w.center.z + dz },
  ];
}

/**
 * Alaprajz-poligon: a natív padló-sarkok, ha vannak; különben a falak
 * végpontjaiból, a középpont körüli szög szerint rendezve (konvex közelítés —
 * téglalap/L alakú szobára jó; a pontos alak a natív padlóból jön).
 */
export function floorPolygon(room: RawRoom): { x: number; z: number }[] {
  if (room.floor && room.floor.length >= 3) {
    return room.floor;
  }
  const pts = room.walls.flatMap(wallEndpoints);
  if (pts.length < 3) {
    return [];
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const unique: { x: number; z: number }[] = [];
  for (const p of pts) {
    if (!unique.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.05)) {
      unique.push(p);
    }
  }
  return unique.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
}

export function summarizeRoom(room: RawRoom): RoomSummary {
  const poly = floorPolygon(room);
  return {
    floorArea: shoelaceArea(poly),
    walls: room.walls.map((w) => ({ id: w.id, length: w.width, height: w.height })),
    openings: [
      ...room.doors.map((d) => ({ id: d.id, kind: 'door' as const, width: d.width, height: d.height })),
      ...room.windows.map((d) => ({ id: d.id, kind: 'window' as const, width: d.width, height: d.height })),
      ...room.openings.map((d) => ({ id: d.id, kind: 'opening' as const, width: d.width, height: d.height })),
    ],
    objects: room.objects,
    floorPolygon: poly,
  };
}

/** a falak összhossza és az átlagos belmagasság (a szoba-kártyához) */
export function roomStats(summary: RoomSummary): { wallLength: number; ceilingHeight: number } {
  const wallLength = summary.walls.reduce((s, w) => s + w.length, 0);
  const ceilingHeight =
    summary.walls.length > 0 ? summary.walls.reduce((s, w) => s + w.height, 0) / summary.walls.length : 0;
  return { wallLength, ceilingHeight };
}
