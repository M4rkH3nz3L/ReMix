import { pathData } from '@/lib/draw';
import { polygonFor } from '@/lib/shapeGeometry';
import type { PathPoint } from '@/types/project';

/**
 * 🖊️ A forma körvonalának igazítása (IMAGE-PROD S18) — pure. Belül: a vonal teljesen a formán belül
 * (az alakra vágva, dupla szélességgel); középen: a kontúr közepén; kívül: a formán kívül (maszkkal,
 * dupla szélességgel). Mindkét renderelő ugyanazt a `d`-t és ugyanazt a vonalat rajzolja: a vászon
 * react-native-svg-vel, a szerver (`server/shapeStroke.js`, szó szerinti tükör, contract-teszt) SVG-vel.
 * Igazítás nélkül a régi viselkedés marad (téglalap/ellipszis: belül, sokszög: kívül, görbe: középen).
 */
export type BorderAlign = 'inside' | 'center' | 'outside';

export function borderAlignOf(v: unknown): BorderAlign | null {
  return v === 'inside' || v === 'center' || v === 'outside' ? v : null;
}

/** a rajzolt vonal szélessége, a doboz körüli margó, és hogy vágás / maszk kell-e */
export function strokeSpec(align: BorderAlign, width: number): { width: number; pad: number; clip: boolean; mask: boolean } {
  return align === 'center'
    ? { width, pad: width / 2, clip: false, mask: false }
    : align === 'inside'
      ? { width: width * 2, pad: 0, clip: true, mask: false }
      : { width: width * 2, pad: width, clip: false, mask: true };
}

/** a vonal-csatlakozás: a téglalap/ellipszis szögletes, a sokszög és a görbe kerek (a régi render szerint) */
export function strokeJoinOf(shape: { shape: string; strokeJoin?: string }): string {
  return shape.strokeJoin ?? (shape.shape === 'rectangle' || shape.shape === 'ellipse' ? 'miter' : 'round');
}

const f = (n: number) => n.toFixed(2);

type OutlineShape = {
  shape: string;
  cornerRadius?: number;
  sides?: number;
  starPoints?: number;
  innerRadius?: number;
  points?: PathPoint[];
  subpaths?: PathPoint[][];
  closed?: boolean;
};

/** a forma körvonala SVG `d`-ként a `w`×`h` dobozban, vagy null (nyitott görbe, vonal) */
export function shapeOutlineD(s: OutlineShape, w: number, h: number): string | null {
  const poly = polygonFor(s);
  if (poly) {
    return `${poly.map(([px, py], i) => `${i ? 'L' : 'M'}${f((px / 100) * w)},${f((py / 100) * h)}`).join('')}Z`;
  }
  if (s.shape === 'ellipse') {
    return `M0,${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(w)},${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 0,${f(h / 2)}Z`;
  }
  if (s.shape === 'rectangle') {
    const r = Math.max(0, Math.min(0.5, s.cornerRadius ?? 0)) * Math.min(w, h);
    if (r <= 0) return `M0,0H${f(w)}V${f(h)}H0Z`;
    const a = `A${f(r)},${f(r)} 0 0 1`;
    return `M${f(r)},0H${f(w - r)}${a} ${f(w)},${f(r)}V${f(h - r)}${a} ${f(w - r)},${f(h)}H${f(r)}${a} 0,${f(h - r)}V${f(r)}${a} ${f(r)},0Z`;
  }
  if (s.shape === 'path') {
    if (s.subpaths?.length) return s.subpaths.map((sp) => pathData(sp, w, h, true)).join(' ');
    if (s.closed && (s.points?.length ?? 0) >= 3) return pathData(s.points!, w, h, true);
  }
  return null;
}
