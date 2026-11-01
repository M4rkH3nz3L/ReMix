import type { ClipMask } from '@/types/project';

/**
 * ✂️ A kijelölés mint önálló objektum (pure): műveletek listája a vászon 0–1-es terében. Sorban
 * alkalmazva adja a területet, ezért homorú forma, lyuk és kivonás is pontos, poligon-vágás nélkül.
 * A szerver ugyanezt a listát raszterizálja, a vászon Skia-útvonalként rajzolja.
 */
export interface Point {
  x: number;
  y: number;
}

export type SelectionOpKind = 'add' | 'subtract' | 'intersect';

export interface SelectionOp {
  op: SelectionOpKind;
  points: Point[];
}

export interface Selection {
  ops: SelectionOp[];
  /** lágy szél a vászon arányában */
  feather: number;
  invert: boolean;
}

export type SelectionMode = 'new' | SelectionOpKind;

const ELLIPSE_POINTS = 64;
/** ennél kisebb húzás nem kijelölés, csak véletlen érintés */
const MIN_RING_SIZE = 0.005;

export function rectRing(a: Point, b: Point): Point[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export function ellipseRing(a: Point, b: Point): Point[] {
  const [cx, cy] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const [rx, ry] = [Math.abs(a.x - b.x) / 2, Math.abs(a.y - b.y) / 2];
  return Array.from({ length: ELLIPSE_POINTS }, (_, i) => {
    const t = (i / ELLIPSE_POINTS) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

function ringExtent(ring: Point[]) {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A kijelölés egy új gyűrűvel: a mód dönti el, hogy cserél, bővít, kivág vagy szűkít. */
export function applyRing(sel: Selection | null, ring: Point[], mode: SelectionMode, feather = 0.005): Selection | null {
  const e = ring.length >= 3 ? ringExtent(ring) : null;
  if (!e || (e.maxX - e.minX < MIN_RING_SIZE && e.maxY - e.minY < MIN_RING_SIZE)) {
    return sel;
  }
  if (mode === 'new' || !sel) {
    return mode === 'new' || mode === 'add' ? { ops: [{ op: 'add', points: ring }], feather: sel?.feather ?? feather, invert: false } : sel;
  }
  return { ...sel, ops: [...sel.ops, { op: mode, points: ring }] };
}

export function invertSelection(sel: Selection): Selection {
  return { ...sel, invert: !sel.invert };
}

function inRing(ring: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i], ring[j]];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Benne van-e egy vászon-pont a kijelölésben (a műveletek sorrendjében számolva). */
export function selectionContains(sel: Selection, p: Point): boolean {
  let inside = false;
  for (const { op, points } of sel.ops) {
    const hit = inRing(points, p);
    inside = op === 'add' ? inside || hit : op === 'subtract' ? inside && !hit : inside && hit;
  }
  return sel.invert ? !inside : inside;
}

/** A hozzáadott gyűrűk befoglalója; invertáltnál a teljes vászon. */
export function selectionBounds(sel: Selection): { x: number; y: number; w: number; h: number } {
  const added = sel.ops.filter((o) => o.op === 'add').flatMap((o) => o.points);
  if (sel.invert || added.length === 0) {
    return { x: 0.5, y: 0.5, w: 1, h: 1 };
  }
  const e = ringExtent(added);
  return { x: (e.minX + e.maxX) / 2, y: (e.minY + e.maxY) / 2, w: e.maxX - e.minX, h: e.maxY - e.minY };
}

/** Réteg-maszk a kijelölésből: a `points` a műveleteket nem ismerő régi olvasóknak marad. */
export function selectionToMask(sel: Selection): ClipMask {
  return { shape: 'polygon', ...selectionBounds(sel), points: sel.ops[0]?.points ?? [], ops: sel.ops, feather: sel.feather, invert: sel.invert };
}

function maskOps(mask: ClipMask): SelectionOp[] {
  if (mask.ops?.length) {
    return mask.ops;
  }
  if (mask.shape === 'polygon' && mask.points?.length) {
    return [{ op: 'add', points: mask.points }];
  }
  const [a, b] = [{ x: mask.x - mask.w / 2, y: mask.y - mask.h / 2 }, { x: mask.x + mask.w / 2, y: mask.y + mask.h / 2 }];
  return [{ op: 'add', points: mask.shape === 'ellipse' ? ellipseRing(a, b) : rectRing(a, b) }];
}

/**
 * A kijelölés törlése egy réteg maszkjából (roncsolásmentes): ami eddig látszott, abból kivész a
 * terület. null, ha a két maszk így nem írható le; a hívó ilyenkor szól, nem ront el semmit.
 */
export function maskWithout(existing: ClipMask | undefined, sel: Selection): ClipMask | null {
  if (!existing) {
    return { ...selectionToMask(sel), invert: !sel.invert };
  }
  if (sel.invert || sel.ops.some((o) => o.op !== 'add')) {
    return null;
  }
  const ops = existing.invert
    ? [...maskOps(existing), ...sel.ops]
    : [...maskOps(existing), ...sel.ops.map((o): SelectionOp => ({ op: 'subtract', points: o.points }))];
  return { ...existing, shape: 'polygon', points: ops[0].points, ops };
}
