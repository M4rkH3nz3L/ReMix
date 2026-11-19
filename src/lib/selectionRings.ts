import { applyRing, type Point, type Selection, type SelectionMode } from '@/lib/selection';

/**
 * 🎯 S17: a színtartomány gyűrűi (pure) — új kijelölésként pontosan (régió + lyuk + sziget); a
 * meglévőhöz adva / kivonva / metszve a régiók körvonalaival (a lyukak ilyenkor nem számítanak).
 * VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody` `setSelection`-reduceréből.
 */
export function applyRangeRings(
  sel: Selection | null,
  rings: { op: 'add' | 'subtract'; points: Point[] }[],
  selectMode: SelectionMode
): Selection | null {
  const fresh = selectMode === 'new' || !sel;
  let next: Selection | null = fresh ? null : sel;
  rings.forEach((r, i) => {
    if (fresh) {
      next = applyRing(i === 0 ? null : next, r.points, i === 0 ? 'new' : r.op);
    } else if (r.op === 'add') {
      next = applyRing(next, r.points, selectMode);
    }
  });
  return next;
}
