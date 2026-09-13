import type { ClipMask } from '@/types/project';

/**
 * ✂️ Maszk-szerkesztés a vásznon — pure réteg.
 *
 * A maszkot eddig csak számmezőkkel lehetett állítani. Itt a húzás/méretezés
 * matematikája él, hogy a vászon-fogantyúk vékony rétegek maradjanak.
 *
 * Koordináta-rend: `x`/`y` a maszk KÖZÉPPONTJA, `w`/`h` a TELJES mérete
 * (nem félméret), minden vászon-normalizálva. A poligon `points` viszont
 * ABSZOLÚT vászon-koordináta — a render azokat használja, a befoglaló doboz
 * ilyenkor csak a fogantyúk kirajzolásához kell, ezért együtt kell mozgatni
 * a kettőt, különben a fogantyú elcsúszik a tényleges maszktól.
 */

const MIN_SIZE = 0.04;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** a poligon-pontok befoglaló doboza (középpont + méret) */
export function pointsBounds(points: { x: number; y: number }[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  if (points.length === 0) {
    return null;
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const y1 = Math.min(...ys);
  const y2 = Math.max(...ys);
  return {
    x: round((x1 + x2) / 2),
    y: round((y1 + y2) / 2),
    w: round(Math.max(MIN_SIZE, x2 - x1)),
    h: round(Math.max(MIN_SIZE, y2 - y1)),
  };
}

/**
 * Eltolás vászon-normalizált deltával. A maszk NEM léphet ki a vászonról:
 * az eltolást úgy vágjuk, hogy a befoglaló doboz bent maradjon (a poligonnál
 * a pontok tényleges szélső értékei alapján, nem a névleges w/h alapján).
 */
export function moveMask(mask: ClipMask, dx: number, dy: number): ClipMask {
  if (mask.shape === 'polygon' && mask.points && mask.points.length >= 3) {
    const xs = mask.points.map((p) => p.x);
    const ys = mask.points.map((p) => p.y);
    // csak addig tolható, amíg a legszélső pont a vásznon belül marad
    const ddx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx));
    const ddy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy));
    const points = mask.points.map((p) => ({
      x: round(clamp01(p.x + ddx)),
      y: round(clamp01(p.y + ddy)),
    }));
    return { ...mask, points, ...pointsBounds(points)! };
  }
  const halfW = mask.w / 2;
  const halfH = mask.h / 2;
  return {
    ...mask,
    x: round(Math.min(1 - halfW, Math.max(halfW, mask.x + dx))),
    y: round(Math.min(1 - halfH, Math.max(halfH, mask.y + dy))),
  };
}

/**
 * Átméretezés: a maszk a KÖZÉPPONTJA körül nő/zsugorodik. Poligonnál a pontok
 * is a középpont körül skálázódnak, hogy az alak megmaradjon.
 */
export function resizeMask(mask: ClipMask, dw: number, dh: number): ClipMask {
  const w = Math.min(1, Math.max(MIN_SIZE, mask.w + dw));
  const h = Math.min(1, Math.max(MIN_SIZE, mask.h + dh));
  if (mask.shape === 'polygon' && mask.points && mask.points.length >= 3) {
    const b = pointsBounds(mask.points)!;
    const sx = w / Math.max(MIN_SIZE, b.w);
    const sy = h / Math.max(MIN_SIZE, b.h);
    const points = mask.points.map((p) => ({
      x: round(clamp01(b.x + (p.x - b.x) * sx)),
      y: round(clamp01(b.y + (p.y - b.y) * sy)),
    }));
    return { ...mask, points, ...pointsBounds(points)! };
  }
  return {
    ...mask,
    w: round(w),
    h: round(h),
    // a középpont visszatolódik, ha a nagyítás kilógatná a maszkot
    x: round(Math.min(1 - w / 2, Math.max(w / 2, mask.x))),
    y: round(Math.min(1 - h / 2, Math.max(h / 2, mask.y))),
  };
}

/** egyetlen poligon-csúcs áthelyezése (a befoglaló doboz újraszámolva) */
export function moveVertex(
  mask: ClipMask,
  index: number,
  x: number,
  y: number
): ClipMask {
  if (!mask.points || index < 0 || index >= mask.points.length) {
    return mask;
  }
  const points = mask.points.map((p, i) =>
    i === index ? { x: round(clamp01(x)), y: round(clamp01(y)) } : p
  );
  return { ...mask, points, ...pointsBounds(points)! };
}

/** a fogantyúk kirajzolásához: a maszk aktuális befoglaló doboza */
export function maskBox(mask: ClipMask): { x: number; y: number; w: number; h: number } {
  if (mask.shape === 'polygon' && mask.points && mask.points.length >= 3) {
    return pointsBounds(mask.points)!;
  }
  return { x: mask.x, y: mask.y, w: mask.w, h: mask.h };
}

/** pont → szakasz távolság négyzete (vászon-normalizált) */
function distToSeg(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/**
 * Új csúcs beszúrása a poligonba a (x,y) koppintáshoz LEGKÖZELEBBI élre — így a
 * pontsűrűség ott nő, ahol a felhasználó finomítani akar (rotoszkóp-workflow).
 */
export function insertVertex(mask: ClipMask, x: number, y: number): ClipMask {
  if (mask.shape !== 'polygon' || !mask.points || mask.points.length < 3) {
    return mask;
  }
  const pts = mask.points;
  const p = { x: clamp01(x), y: clamp01(y) };
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = distToSeg(p, pts[i], pts[(i + 1) % pts.length]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const points = [
    ...pts.slice(0, best + 1),
    { x: round(p.x), y: round(p.y) },
    ...pts.slice(best + 1),
  ];
  return { ...mask, points, ...pointsBounds(points)! };
}

/** csúcs törlése (min. 3 marad); a befoglaló doboz újraszámolva */
export function removeVertex(mask: ClipMask, index: number): ClipMask {
  if (mask.shape !== 'polygon' || !mask.points || mask.points.length <= 3) {
    return mask;
  }
  const points = mask.points.filter((_, i) => i !== index);
  return { ...mask, points, ...pointsBounds(points)! };
}

/**
 * Zárt görbe simítása Catmull‑Rom splájnnal (bezier-szerű lágy él): minden
 * szakaszt `perSeg` köztes ponttal sűrít. A render poligonként kezeli, így a
 * sima maszk paritásban marad — csak több csúcs. A túl sok pontot ritkítjuk.
 */
export function smoothClosedPoints(
  pts: { x: number; y: number }[],
  perSeg = 4
): { x: number; y: number }[] {
  const n = pts.length;
  if (n < 3) {
    return pts;
  }
  // ne robbanjon a csúcsszám (a render kifejezése lineárisan nő vele): a
  // szakaszonkénti mintaszámot úgy vágjuk, hogy a kimenet ≤ CAP maradjon.
  const CAP = 64;
  const samples = Math.min(perSeg, Math.floor(CAP / n));
  if (samples < 2) {
    return pts; // már elég sűrű — a simításnak nincs értelme
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < samples; s++) {
      const t = s / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull‑Rom → pozíció
      const x =
        0.5 *
        (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ x: round(clamp01(x)), y: round(clamp01(y)) });
    }
  }
  return out;
}

/** simítás a maszk poligon-pontjaira (a befoglaló doboz újraszámolva) */
export function smoothMask(mask: ClipMask): ClipMask {
  if (mask.shape !== 'polygon' || !mask.points || mask.points.length < 3) {
    return mask;
  }
  const points = smoothClosedPoints(mask.points);
  return { ...mask, points, ...pointsBounds(points)! };
}

/**
 * Poligon-maszk építése szabadkézi (vászon-normalizált) pontsorból: ritkítás
 * után zárt poligon + befoglaló doboz. Kevés pont esetén nem érvényes maszk (null).
 */
export function maskFromStroke(
  raw: { x: number; y: number }[],
  feather = 0.04
): ClipMask | null {
  const pts = raw.map((p) => ({ x: round(clamp01(p.x)), y: round(clamp01(p.y)) }));
  if (pts.length < 3) {
    return null;
  }
  const b = pointsBounds(pts)!;
  if (b.w < MIN_SIZE * 2 && b.h < MIN_SIZE * 2) {
    return null; // túl kicsi „firka" — nem maszk
  }
  return { shape: 'polygon', points: pts, ...b, feather };
}
