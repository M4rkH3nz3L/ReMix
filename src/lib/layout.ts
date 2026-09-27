/**
 * 🎨 Designer layout-engine (S-DESIGN — MASTER §4) — a Figma-szerű elrendezés
 * TISZTA geometriája: igazítás (align), elosztás (distribute), **auto-layout**
 * (flex: irány/gap/padding/align/justify), rács/oszlopok, és responsive resize
 * (constraints). Egység-agnosztikus (px vagy 0–1 normalizált — a hívó dönt),
 * immutábilis, determinisztikus → expo-mentes, teljesen tesztelhető.
 *
 * A vektor-oldal (bézier/boolean path) a [boolean.ts](./boolean) + [draw.ts](./draw)
 * alatt él; ez a KOMPOZÍCIÓS/elrendezés-réteg fölötte.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

const right = (r: Rect): number => r.x + r.width;
const bottom = (r: Rect): number => r.y + r.height;

/** A rect-halmaz uniós befoglaló doboza. Üresre 0-doboz. */
export function boundingBox(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, right(r));
    maxY = Math.max(maxY, bottom(r));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Igazítás ──────────────────────────────────────────────────────────────────

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/**
 * Igazítás egy élhez/középhez — a rect-ek befoglaló dobozához, vagy a megadott
 * `container`-hez. Csak a releváns tengely pozícióját mozgatja (a méret marad).
 */
export function alignRects(rects: Rect[], edge: AlignEdge, container?: Rect): Rect[] {
  const box = container ?? boundingBox(rects);
  return rects.map((r) => {
    switch (edge) {
      case 'left':
        return { ...r, x: box.x };
      case 'right':
        return { ...r, x: right(box) - r.width };
      case 'hcenter':
        return { ...r, x: box.x + (box.width - r.width) / 2 };
      case 'top':
        return { ...r, y: box.y };
      case 'bottom':
        return { ...r, y: bottom(box) - r.height };
      case 'vcenter':
        return { ...r, y: box.y + (box.height - r.height) / 2 };
    }
  });
}

// ── Elosztás ──────────────────────────────────────────────────────────────────

export type Axis = 'horizontal' | 'vertical';

/** rendezéshez + visszahelyezéshez: index-megőrző segéd. */
function withIndex(rects: Rect[]): { r: Rect; i: number }[] {
  return rects.map((r, i) => ({ r, i }));
}
function restoreOrder(placed: { r: Rect; i: number }[]): Rect[] {
  const out: Rect[] = new Array(placed.length);
  for (const p of placed) {
    out[p.i] = p.r;
  }
  return out;
}

/**
 * Egyenlő RÉSEK az elemek között (Figma „distribute spacing"): a szélső elemek
 * maradnak, a köztes rések kiegyenlítődnek. A bemeneti sorrend megőrződik.
 */
export function distributeSpacing(rects: Rect[], axis: Axis): Rect[] {
  if (rects.length < 3) {
    return rects.map((r) => ({ ...r }));
  }
  const horiz = axis === 'horizontal';
  const items = withIndex(rects).sort((a, b) => (horiz ? a.r.x - b.r.x : a.r.y - b.r.y));
  const sizeOf = (r: Rect) => (horiz ? r.width : r.height);
  const startOf = (r: Rect) => (horiz ? r.x : r.y);
  const spanStart = startOf(items[0].r);
  const spanEnd = startOf(items[items.length - 1].r) + sizeOf(items[items.length - 1].r);
  const sumSize = items.reduce((s, it) => s + sizeOf(it.r), 0);
  const gap = (spanEnd - spanStart - sumSize) / (items.length - 1);
  let cursor = spanStart;
  const placed = items.map((it) => {
    const r = horiz ? { ...it.r, x: cursor } : { ...it.r, y: cursor };
    cursor += sizeOf(it.r) + gap;
    return { r, i: it.i };
  });
  return restoreOrder(placed);
}

/** Egyenlő távolság a KÖZÉPPONTOK között (a szélső középpontok maradnak). */
export function distributeCenters(rects: Rect[], axis: Axis): Rect[] {
  if (rects.length < 3) {
    return rects.map((r) => ({ ...r }));
  }
  const horiz = axis === 'horizontal';
  const centerOf = (r: Rect) => (horiz ? r.x + r.width / 2 : r.y + r.height / 2);
  const items = withIndex(rects).sort((a, b) => centerOf(a.r) - centerOf(b.r));
  const first = centerOf(items[0].r);
  const last = centerOf(items[items.length - 1].r);
  const step = (last - first) / (items.length - 1);
  const placed = items.map((it, k) => {
    const c = first + step * k;
    const r = horiz ? { ...it.r, x: c - it.r.width / 2 } : { ...it.r, y: c - it.r.height / 2 };
    return { r, i: it.i };
  });
  return restoreOrder(placed);
}

// ── Auto-layout (flex) ────────────────────────────────────────────────────────

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type CrossAlign = 'start' | 'center' | 'end' | 'stretch';
export type MainJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around';

export interface AutoLayoutOptions {
  direction: 'row' | 'column';
  gap?: number;
  padding?: number | Partial<Padding>;
  align?: CrossAlign; // kereszttengely
  justify?: MainJustify; // fő tengely
}

function normPadding(p?: number | Partial<Padding>): Padding {
  if (typeof p === 'number') {
    return { top: p, right: p, bottom: p, left: p };
  }
  return { top: p?.top ?? 0, right: p?.right ?? 0, bottom: p?.bottom ?? 0, left: p?.left ?? 0 };
}

/**
 * Flexbox-szerű auto-layout: a `children` méreteket a `container`-be pozicionálja
 * `direction`/`gap`/`padding` szerint, `justify` a fő-, `align` a kereszttengelyen
 * (a `stretch` a keresztméretet a belső sávra húzza). Abszolút Rect-eket ad
 * vissza (a konténer koordinátáiban).
 */
export function autoLayout(container: Size, children: Size[], opts: AutoLayoutOptions): Rect[] {
  const pad = normPadding(opts.padding);
  const gap = opts.gap ?? 0;
  const row = opts.direction === 'row';
  const n = children.length;
  if (n === 0) {
    return [];
  }

  const innerMain = (row ? container.width - pad.left - pad.right : container.height - pad.top - pad.bottom);
  const innerCross = (row ? container.height - pad.top - pad.bottom : container.width - pad.left - pad.right);
  const mainStartPad = row ? pad.left : pad.top;
  const crossStartPad = row ? pad.top : pad.left;

  const mainSize = (c: Size) => (row ? c.width : c.height);
  const crossSize = (c: Size) => (row ? c.height : c.width);

  const sumMain = children.reduce((s, c) => s + mainSize(c), 0);
  const justify = opts.justify ?? 'start';
  const align = opts.align ?? 'start';

  // fő tengely: kezdő-eltolás + elemek közti rés
  let offset = mainStartPad;
  let between = gap;
  const totalWithGap = sumMain + gap * (n - 1);
  const free = innerMain - sumMain;
  if (justify === 'center') {
    offset += (innerMain - totalWithGap) / 2;
  } else if (justify === 'end') {
    offset += innerMain - totalWithGap;
  } else if (justify === 'space-between' && n > 1) {
    between = free / (n - 1);
  } else if (justify === 'space-around' && n > 0) {
    const around = free / n;
    offset += around / 2;
    between = around;
  }

  const rects: Rect[] = [];
  let cursor = offset;
  for (const c of children) {
    const cs = crossSize(c);
    let crossPos = crossStartPad;
    let crossExtent = cs;
    if (align === 'center') {
      crossPos = crossStartPad + (innerCross - cs) / 2;
    } else if (align === 'end') {
      crossPos = crossStartPad + (innerCross - cs);
    } else if (align === 'stretch') {
      crossExtent = innerCross;
    }
    const rect: Rect = row
      ? { x: cursor, y: crossPos, width: mainSize(c), height: crossExtent }
      : { x: crossPos, y: cursor, width: crossExtent, height: mainSize(c) };
    rects.push(rect);
    cursor += mainSize(c) + between;
  }
  return rects;
}

// ── Rács / oszlopok ────────────────────────────────────────────────────────────

/** N oszlop x/szélessége adott konténer-szélességben (margó + belső köz). */
export function gridColumns(containerWidth: number, columns: number, gutter = 0, margin = 0): Rect[] {
  const cols = Math.max(1, Math.floor(columns));
  const usable = containerWidth - 2 * margin - gutter * (cols - 1);
  const colW = usable / cols;
  return Array.from({ length: cols }, (_, i) => ({
    x: margin + i * (colW + gutter),
    y: 0,
    width: colW,
    height: 0,
  }));
}

/** Érték a legközelebbi rács-pontra (opcionális origóval). */
export function snapToGrid(value: number, step: number, origin = 0): number {
  if (step <= 0) {
    return value;
  }
  return origin + Math.round((value - origin) / step) * step;
}

// ── Responsive resize (constraints) ────────────────────────────────────────────

export type Constraint = 'start' | 'end' | 'stretch' | 'center' | 'scale';

/** egytengelyű újraszámolás a régi/új konténer-méret + constraint alapján. */
function resizeAxis(
  pos: number,
  size: number,
  oldContainer: number,
  newContainer: number,
  constraint: Constraint
): { pos: number; size: number } {
  const endMargin = oldContainer - (pos + size);
  switch (constraint) {
    case 'start':
      return { pos, size };
    case 'end':
      return { pos: newContainer - endMargin - size, size };
    case 'stretch':
      return { pos, size: newContainer - pos - endMargin };
    case 'center': {
      const centerOffset = pos + size / 2 - oldContainer / 2;
      return { pos: newContainer / 2 + centerOffset - size / 2, size };
    }
    case 'scale': {
      const s = oldContainer === 0 ? 1 : newContainer / oldContainer;
      return { pos: pos * s, size: size * s };
    }
  }
}

export interface Constraints {
  horizontal: Constraint;
  vertical: Constraint;
}

/**
 * Egy gyerek-rect újraszámolása, amikor a konténer mérete változik — Figma-szerű
 * constraints-szel (start/end/stretch/center/scale tengelyenként). Immutábilis.
 */
export function resizeWithConstraints(
  rect: Rect,
  oldContainer: Size,
  newContainer: Size,
  constraints: Constraints
): Rect {
  const h = resizeAxis(rect.x, rect.width, oldContainer.width, newContainer.width, constraints.horizontal);
  const v = resizeAxis(rect.y, rect.height, oldContainer.height, newContainer.height, constraints.vertical);
  return { x: h.pos, y: v.pos, width: h.size, height: v.size };
}
