import { makeId } from '@/lib/id';

/**
 * 📐 Vonalzók & segédvonalak mag (Creative Canvas) — pure.
 *
 * A `snapping.ts` az OBJEKTUM-snap (él/társ/rács); ez a vonalzó-osztás + a
 * kézzel húzott SEGÉDVONALAK (guides) + a rájuk illesztés. A vonalzó „szép"
 * (1-2-5·10ⁿ) lépéseket ad tetszőleges nézet-tartományra és pixel-hosszra; a
 * segédvonalak pozíciója a projekt konvenciója szerint 0…1 normalizált.
 */

export type Axis = 'x' | 'y';

export interface Guide {
  id: string;
  axis: Axis;
  /** 0…1 normalizált pozíció a vásznon */
  pos: number;
}

export interface RulerTick {
  /** érték a nézet-tartomány egységében */
  value: number;
  /** pixel-pozíció a vonalzón (0 = viewStart) */
  px: number;
  /** fő (címkézett) osztás? */
  major: boolean;
  label?: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
// a `+ 0` a −0-t is +0-ra normalizálja (Object.is/toEqual különben megbukna)
const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const MAX_TICKS = 2000;

/** „szép" lépésköz: 1, 2, 5 × 10ⁿ (a `rough` fölé/köré kerekítve). */
export function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Vonalzó-osztások a `[viewStart, viewEnd]` tartományra `lengthPx` hosszon. A fő
 * lépés úgy skálázódik, hogy legalább `targetPx` legyen két címke közt; a minor
 * osztások a fő lépés `subdivisions`-öd részei.
 */
export function rulerTicks(
  viewStart: number,
  viewEnd: number,
  lengthPx: number,
  targetPx = 80,
  subdivisions = 5
): RulerTick[] {
  const range = viewEnd - viewStart;
  if (range <= 0 || lengthPx <= 0) return [];
  const unitsPerPx = range / lengthPx;
  const step = niceStep(targetPx * unitsPerPx);
  const minor = step / Math.max(1, subdivisions);
  const ticks: RulerTick[] = [];
  const startIdx = Math.ceil(viewStart / minor - 1e-9);
  for (let i = startIdx; ticks.length < MAX_TICKS; i++) {
    const value = i * minor;
    if (value > viewEnd + 1e-9) break;
    const px = ((value - viewStart) / range) * lengthPx;
    const ratio = value / step;
    const major = Math.abs(ratio - Math.round(ratio)) < 1e-6;
    ticks.push({
      value: round(value),
      px: round(px),
      major,
      label: major ? formatLabel(value, step) : undefined,
    });
  }
  return ticks;
}

function formatLabel(value: number, step: number): string {
  if (Number.isInteger(step)) return String(Math.round(value));
  const decimals = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step)) + 1));
  return value.toFixed(decimals);
}

// ── Segédvonalak ─────────────────────────────────────────────────────────────

export function addGuide(guides: Guide[], axis: Axis, pos: number): Guide[] {
  return [...guides, { id: makeId('gd'), axis, pos: round(clamp01(pos)) }];
}

export function removeGuide(guides: Guide[], id: string): Guide[] {
  return guides.filter((g) => g.id !== id);
}

export function moveGuide(guides: Guide[], id: string, pos: number): Guide[] {
  return guides.map((g) => (g.id === id ? { ...g, pos: round(clamp01(pos)) } : g));
}

/** összes / adott tengely segédvonalainak törlése. */
export function clearGuides(guides: Guide[], axis?: Axis): Guide[] {
  return axis ? guides.filter((g) => g.axis !== axis) : [];
}

export const guidesForAxis = (guides: Guide[], axis: Axis): Guide[] => guides.filter((g) => g.axis === axis);

/**
 * Egy érték illesztése az adott tengely LEGKÖZELEBBI segédvonalához, ha az a
 * `threshold`-on (normalizált) belül van — különben null.
 */
export function snapToGuides(
  value: number,
  axis: Axis,
  guides: Guide[],
  threshold = 0.01
): { pos: number; guideId: string } | null {
  let best: { pos: number; guideId: string } | null = null;
  let bestD = threshold;
  for (const g of guides) {
    if (g.axis !== axis) continue;
    const d = Math.abs(g.pos - value);
    if (d <= bestD) {
      bestD = d;
      best = { pos: g.pos, guideId: g.id };
    }
  }
  return best;
}

export interface PointSnap {
  x: number;
  y: number;
  guideX: string | null;
  guideY: string | null;
}

/** egy pont mindkét tengelyének illesztése a segédvonalakhoz (függetlenül). */
export function snapPointToGuides(
  point: { x: number; y: number },
  guides: Guide[],
  threshold = 0.01
): PointSnap {
  const sx = snapToGuides(point.x, 'x', guides, threshold);
  const sy = snapToGuides(point.y, 'y', guides, threshold);
  return {
    x: sx ? sx.pos : round(point.x),
    y: sy ? sy.pos : round(point.y),
    guideX: sx ? sx.guideId : null,
    guideY: sy ? sy.guideId : null,
  };
}

/**
 * Középre-igazító segédvonalak egy dobozhoz (a doksi közepe + harmadok) — gyors
 * „add guides" a kompozícióhoz. A meglévőkhöz fűzi (duplikátum-tűrő nem).
 */
export function compositionGuides(thirds = true): Guide[] {
  const xs = thirds ? [1 / 3, 0.5, 2 / 3] : [0.5];
  const ys = thirds ? [1 / 3, 0.5, 2 / 3] : [0.5];
  return [
    ...xs.map((pos): Guide => ({ id: makeId('gd'), axis: 'x', pos: round(pos) })),
    ...ys.map((pos): Guide => ({ id: makeId('gd'), axis: 'y', pos: round(pos) })),
  ];
}
