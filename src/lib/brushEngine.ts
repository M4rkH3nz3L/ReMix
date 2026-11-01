/**
 * 🖌️ Az ecset tiszta magja: vonás-adatok, nyomás, simítás, vonásonkénti előzmény. A koordináták
 * és a szélesség a vászon arányában vannak (0–1, szélesség = a vászonszélesség törtje), így a
 * vonás a képernyő méretétől függetlenül ugyanaz, az előnézet és az export egy adatból rajzol.
 */
export interface BrushSettings {
  color: string;
  /** vastagság a vászon pontjaiban */
  size: number;
  /** 1 = éles szél, 0 = teljesen lágy */
  hardness: number;
  /** a teljes vonás átlátszósága: önmagát keresztezve sem sötétedik */
  opacity: number;
  eraser: boolean;
  /** 0 = nyers, 1 = erős simítás */
  smoothing: number;
}

export const DEFAULT_BRUSH: BrushSettings = { color: '#ff2d95', size: 10, hardness: 1, opacity: 1, eraser: false, smoothing: 0.3 };

/** p = nyomás 0–1 (ujjal 1) */
export interface BrushPoint {
  x: number;
  y: number;
  p: number;
}

export interface Stroke {
  points: BrushPoint[];
  color: string;
  width: number;
  hardness: number;
  opacity: number;
  eraser: boolean;
}

export interface StrokeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** Az Apple Pencil szokásos nyomása ritkán éri el az 1-et, ezért a skála a teljes szélességet 2/3-nál adja. */
export function pressureOf(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return 1;
  }
  return Math.min(1, raw * 1.5);
}

/** A legvékonyabb nyomás is látszó vonalat ad (a teljes szélesség negyede). */
export function pressureWidth(width: number, p: number): number {
  return width * (0.25 + 0.75 * Math.max(0, Math.min(1, p)));
}

/** Stabilizátor: az új pont az előző felé húzva, így a remegő kéz nem látszik. */
export function stabilize(prev: BrushPoint, next: BrushPoint, smoothing: number): BrushPoint {
  const k = 1 - Math.max(0, Math.min(1, smoothing)) * 0.85;
  return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k, p: prev.p + (next.p - prev.p) * k };
}

/** A vonás szakaszai a saját szélességükkel; egyetlen koppintásból pötty lesz. */
export function strokeSegments(stroke: Pick<Stroke, 'points' | 'width'>): StrokeSegment[] {
  const { points, width } = stroke;
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    const [a] = points;
    return [{ x1: a.x, y1: a.y, x2: a.x, y2: a.y, width: pressureWidth(width, a.p) }];
  }
  return points.slice(1).map((b, i) => {
    const a = points[i];
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: pressureWidth(width, (a.p + b.p) / 2) };
  });
}

/** A lágy szél elmosása a vonás szélességének arányában (0 = éles). */
export function hardnessSigma(widthPx: number, hardness: number): number {
  return (1 - Math.max(0, Math.min(1, hardness))) * widthPx * 0.3;
}

export interface StrokeHistory {
  done: Stroke[];
  undone: Stroke[];
}

export const EMPTY_HISTORY: StrokeHistory = { done: [], undone: [] };

/** Új vonás után a visszavont vonások elvesznek, mint minden undo-veremben. */
export function pushStroke(h: StrokeHistory, stroke: Stroke): StrokeHistory {
  return { done: [...h.done, stroke], undone: [] };
}

export function undoStroke(h: StrokeHistory): StrokeHistory {
  const last = h.done[h.done.length - 1];
  return last ? { done: h.done.slice(0, -1), undone: [...h.undone, last] } : h;
}

export function redoStroke(h: StrokeHistory): StrokeHistory {
  const last = h.undone[h.undone.length - 1];
  return last ? { done: [...h.done, last], undone: h.undone.slice(0, -1) } : h;
}

/** Festett réteg: a korábbi ecset-rétegek fájlnévről is felismerhetők. */
export function isPaintLayer(layer: { kind: string; paint?: boolean; uri?: string } | undefined | null): boolean {
  return layer?.kind === 'photo' && (layer.paint === true || /\/brush_[^/]*\.png$/.test(layer.uri ?? ''));
}
