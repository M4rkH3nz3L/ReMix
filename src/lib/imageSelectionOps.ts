import { type Placed, canvasToLayerBox, layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import { type Selection, type SelectionOp, maskWithout, selectionToMask } from '@/lib/selection';
import type { ClipMask, ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

/**
 * ✂️ A kijelölés műveletei a dokumentumon (pure). Mind roncsolásmentes: a réteg maszkja változik,
 * a fájl nem. null = így nem írható le, a dokumentum érintetlen, a felület szól.
 */
function photoTarget(doc: ImageDoc, id: string | null): PhotoLayer | null {
  const l = doc.layers.find((x) => x.id === id);
  return l?.kind === 'photo' ? l : null;
}

const withMask = (doc: ImageDoc, id: string, mask: ClipMask): ImageDoc => ({
  ...doc,
  layers: doc.layers.map((l) => (l.id === id ? ({ ...l, mask } as ImageLayer) : l)),
});

/** A kijelölés a már maszkolt rétegen csak a látható részt fogja: a régi maszkkal metszünk. */
function clippedBy(existing: ClipMask | undefined, sel: Selection): ClipMask | null {
  const mask = selectionToMask(sel);
  if (!existing) {
    return mask;
  }
  const rings = existing.ops?.length ? existing.ops : existing.points?.length ? [{ op: 'add' as const, points: existing.points }] : null;
  if (!rings || sel.invert || rings.some((o) => o.op !== 'add')) {
    return null;
  }
  if (existing.invert) {
    return { ...mask, ops: [...sel.ops, ...rings.map((o): SelectionOp => ({ op: 'subtract', points: o.points }))] };
  }
  return rings.length === 1 ? { ...mask, ops: [...sel.ops, { op: 'intersect', points: rings[0].points }] } : null;
}

/** Másolás új rétegre: a teljes fotó másolata a kijelölés maszkjával, közvetlenül az eredeti fölött. */
export function copySelectionToLayer(doc: ImageDoc, targetId: string | null, sel: Selection, newId: string): ImageDoc | null {
  const target = photoTarget(doc, targetId);
  const mask = target ? clippedBy(target.mask, sel) : null;
  if (!target || !mask) {
    return null;
  }
  const layers = [...doc.layers];
  layers.splice(layers.indexOf(target) + 1, 0, { ...target, id: newId, mask, paint: undefined });
  return { ...doc, layers };
}

/** A kijelölt terület eltüntetése a rétegből. */
export function deleteSelection(doc: ImageDoc, targetId: string | null, sel: Selection): ImageDoc | null {
  const target = photoTarget(doc, targetId);
  const mask = target ? maskWithout(target.mask, sel) : null;
  return target && mask ? withMask(doc, target.id, mask) : null;
}

/** A kijelölés a réteg maszkja lesz (a korábbi maszkot cseréli). */
export function maskFromSelection(doc: ImageDoc, targetId: string | null, sel: Selection): ImageDoc | null {
  const target = photoTarget(doc, targetId);
  return target ? withMask(doc, target.id, selectionToMask(sel)) : null;
}

/** Korrekció csak a kijelölésen: maszkolt korrekciós réteg a tetejére. */
export function adjustSelection(doc: ImageDoc, sel: Selection, newId: string): ImageDoc {
  return { ...doc, layers: [...doc.layers, { kind: 'adjust', id: newId, adjust: {}, mask: selectionToMask(sel) } as ImageLayer] };
}

/** A legfelső látható fotó: ha nincs kijelölt réteg, ezen dolgozik a kijelölés. */
export function selectionTarget(doc: ImageDoc, selectedId: string | null): string | null {
  if (photoTarget(doc, selectedId)) {
    return selectedId;
  }
  const photos = doc.layers.filter((l) => l.kind === 'photo' && !l.hidden);
  return photos[photos.length - 1]?.id ?? null;
}

const turn = (deg: number | undefined) => ((((deg ?? 0) % 360) + 360) % 360);

/** téglalap / ellipszis körvonala (vászon-normalizált) — a szerver `outlinePoints`-ával azonos (48 pont) */
function outline(mask: ClipMask): { x: number; y: number }[] {
  const rx = mask.w / 2;
  const ry = mask.h / 2;
  if (mask.shape === 'ellipse') {
    return Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: mask.x + rx * Math.cos(a), y: mask.y + ry * Math.sin(a) };
    });
  }
  return [
    { x: mask.x - rx, y: mask.y - ry },
    { x: mask.x + rx, y: mask.y - ry },
    { x: mask.x + rx, y: mask.y + ry },
    { x: mask.x - rx, y: mask.y + ry },
  ];
}

function bbox(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/**
 * S15: a maszk a réteggel együtt mozog, méreteződik, forog és tükröződik — a vászon-pontokat a régi
 * réteg saját terébe, onnan az új réteg helyére vetíti. Ha a leképezés nem tengelyes (forgatás,
 * vagy elforgatott réteg nyújtása), a téglalap / ellipszis poligon lesz (mint a szerver `maskToBox`-a).
 * A festett maszk (kép a dobozában) forgatást nem tud: a középpontja és a mérete követ, a szöge nem.
 * `toCanvas`: ha a réteg más méretű lapra kerül (méretváltozat), annak a vászna.
 */
export function followLayerMask(
  mask: ClipMask,
  from: Placed,
  to: Placed,
  canvas: { width: number; height: number },
  toCanvas: { width: number; height: number } = canvas
): ClipMask {
  const map = (p: { x: number; y: number }) => layerBoxToCanvas(canvasToLayerBox(p, from, canvas), to, toCanvas);
  const axisAligned =
    turn(from.rotation) === turn(to.rotation) && turn(to.rotation) % 90 === 0 && !!from.flipH === !!to.flipH && !!from.flipV === !!to.flipV;
  const ops = mask.ops?.map((o) => ({ ...o, points: o.points.map(map) }));
  if (mask.shape === 'polygon' && mask.points?.length) {
    const points = mask.points.map(map);
    return { ...mask, ...bbox(points), points, ops };
  }
  if (axisAligned || mask.image) {
    // tengelyes leképezés: a doboz sarkai a doboz sarkaira esnek → a paraméteres alak megmarad
    const box = mask.image && !axisAligned
      ? { ...map({ x: mask.x, y: mask.y }), w: mask.w * (to.w / Math.max(from.w, 1e-6)), h: mask.h * (to.h / Math.max(from.h, 1e-6)) }
      : bbox(outline({ ...mask, shape: 'rectangle' }).map(map));
    return { ...mask, ...box, ops };
  }
  const points = outline(mask).map(map);
  return { ...mask, ...bbox(points), shape: 'polygon', points, ops };
}

/** A réteg mozgatásakor a maszkja vele megy, különben a kivágott tartalom kicsúszna belőle. */
export function shiftMask(mask: ClipMask, dx: number, dy: number): ClipMask {
  const move = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return {
    ...mask,
    x: mask.x + dx,
    y: mask.y + dy,
    points: mask.points?.map(move),
    ops: mask.ops?.map((o) => ({ ...o, points: o.points.map(move) })),
  };
}
