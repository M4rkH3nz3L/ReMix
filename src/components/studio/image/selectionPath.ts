import { PathOp, Skia, type SkPath } from '@shopify/react-native-skia';

import type { SelectionOp } from '@/lib/selection';

const SK_OP = { add: PathOp.Union, subtract: PathOp.Difference, intersect: PathOp.Intersect };

/** A kijelölés műveletei egy Skia-útvonallá: a keret, a vágás és a maszk is ezt rajzolja. */
export function selectionSkPath(ops: SelectionOp[], w: number, h: number, invert: boolean): SkPath {
  let out = Skia.Path.Make();
  for (const { op, points } of ops) {
    const ring = Skia.Path.Make();
    points.forEach((p, i) => (i === 0 ? ring.moveTo(p.x * w, p.y * h) : ring.lineTo(p.x * w, p.y * h)));
    ring.close();
    out = Skia.Path.MakeFromOp(out, ring, SK_OP[op]) ?? out;
  }
  if (invert) {
    const all = Skia.Path.Make();
    all.addRect(Skia.XYWHRect(0, 0, w, h));
    out = Skia.Path.MakeFromOp(all, out, PathOp.Difference) ?? out;
  }
  return out;
}
