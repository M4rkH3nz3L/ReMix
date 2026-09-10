/**
 * Smart guides + snapping (Creative Canvas): a vászon kitüntetett vonalaihoz
 * illesztjük a húzott réteget — húzás közben segédvonal jelzi, elengedéskor a
 * pozíció ráugrik. Tengelyenként külön vonal-készlet: vízszintesen közép +
 * harmadok + margók, függőlegesen a TikTok/Reels SAFE-ZONE határok is (felül
 * ~8% a fejléc-UI, alul ~15% a gombsor — a felirat/logó ezekhez igazodjon).
 * Pure, tesztelhető.
 */

export interface SnapResult {
  x: number;
  y: number;
  /** a talált segédvonal pozíciója (0–1), vagy null */
  guideX: number | null;
  guideY: number | null;
  /** miféle vonalra ugrott — az előnézet más színnel rajzolhatja */
  kindX: SnapKind | null;
  kindY: SnapKind | null;
}

/**
 * `line` = vászon-vonal (közép/harmad/margó/safe-zone) · `peer` = másik réteg
 * középvonala · `spacing` = két réteg közti EGYENLŐ TÉRKÖZ · `grid` = rács
 */
export type SnapKind = 'line' | 'peer' | 'spacing' | 'grid';

export interface SnapContext {
  /** a többi réteg középpontja (a húzott NÉLKÜL), vászon-normalizálva */
  peers?: { x: number; y: number }[];
  /** rács-osztás tengelyenként (pl. 12 → 1/12-enként); 0/hiányzó = nincs rács */
  grid?: number;
}

/** egy tengely jelöltjei fontossági sorrendben (előbb a beszédesebb vonal) */
function axisTargets(
  values: number[],
  lines: number[],
  grid: number
): { at: number; kind: SnapKind }[] {
  const out: { at: number; kind: SnapKind }[] = lines.map((at) => ({ at, kind: 'line' as const }));
  // társ-rétegek középvonala
  for (const v of values) {
    out.push({ at: v, kind: 'peer' });
  }
  // egyenlő térköz: két réteg közé húzva a felezőpont adja az azonos hézagot
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      out.push({ at: (values[i] + values[j]) / 2, kind: 'spacing' });
    }
  }
  if (grid > 1) {
    for (let k = 0; k <= grid; k++) {
      out.push({ at: k / grid, kind: 'grid' });
    }
  }
  return out;
}

/** vízszintes pozíció-vonalak: közép + harmadok + bal/jobb margó */
const SNAP_LINES_X = [0.5, 1 / 3, 2 / 3, 0.06, 0.94];
/** függőleges pozíció-vonalak: közép + harmadok + safe-zone határok */
const SNAP_LINES_Y = [0.5, 1 / 3, 2 / 3, 0.08, 0.85];
export const SNAP_THRESHOLD = 0.025;

export function snapPosition(
  x: number,
  y: number,
  threshold = SNAP_THRESHOLD,
  ctx: SnapContext = {}
): SnapResult {
  const peers = ctx.peers ?? [];
  const grid = ctx.grid ?? 0;
  const targetsX = axisTargets(peers.map((p) => p.x), SNAP_LINES_X, grid);
  const targetsY = axisTargets(peers.map((p) => p.y), SNAP_LINES_Y, grid);

  let bestX: number | null = null;
  let bestY: number | null = null;
  let kindX: SnapKind | null = null;
  let kindY: SnapKind | null = null;
  let dx = threshold;
  let dy = threshold;
  for (const t of targetsX) {
    const d = Math.abs(x - t.at);
    // szigorú kisebb: azonos távolságnál a KORÁBBI jelölt nyer, és a lista
    // fontossági sorrendben áll (vászon-vonal > társ > térköz > rács)
    if (d < dx) {
      dx = d;
      bestX = t.at;
      kindX = t.kind;
    }
  }
  for (const t of targetsY) {
    const d = Math.abs(y - t.at);
    if (d < dy) {
      dy = d;
      bestY = t.at;
      kindY = t.kind;
    }
  }
  return {
    x: bestX ?? x,
    y: bestY ?? y,
    guideX: bestX,
    guideY: bestY,
    kindX,
    kindY,
  };
}
