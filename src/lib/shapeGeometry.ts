import type { PathPoint, ShapeLayer } from '@/types/project';

/**
 * 🔷 Sokszög-geometria 0–100-as koordinátákban (a forma saját dobozához igazítva). A worker
 * `server/shapeGeometry.js` tükre, a contract-teszt köti össze.
 */
const ARROW: [number, number][] = [[0, 35], [60, 35], [60, 12], [100, 50], [60, 88], [60, 65], [0, 65]];
// az alap ötágú csillag (a régi dokumentumok alakja, paraméter nélkül ez marad)
const STAR: [number, number][] = [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]];

const round = (v: number) => Math.round(v * 100) / 100;

/** a pontokat a teljes dobozra feszíti, így a forma kitölti a kijelölő keretét */
function fitBox(pts: [number, number][]): [number, number][] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = 100 / (Math.max(...xs) - x0);
  const sy = 100 / (Math.max(...ys) - y0);
  return pts.map(([x, y]) => [round((x - x0) * sx), round((y - y0) * sy)]);
}

const clampInt = (v: number | undefined, lo: number, hi: number, def: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? (v as number) : def)));

export function regularPolygon(sides?: number): [number, number][] {
  const n = clampInt(sides, 3, 12, 6);
  return fitBox(Array.from({ length: n }, (_, i): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.cos(a), Math.sin(a)];
  }));
}

export function starPolygon(points?: number, innerRadius?: number): [number, number][] {
  const n = clampInt(points, 3, 12, 5);
  const inner = Math.max(0.1, Math.min(0.9, Number.isFinite(innerRadius) ? (innerRadius as number) : 0.5));
  return fitBox(Array.from({ length: n * 2 }, (_, i): [number, number] => {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  }));
}

type PolyShape = { shape: string; sides?: number; starPoints?: number; innerRadius?: number };

/** A forma sokszöge, vagy null, ha nem sokszög-alapú. */
export function polygonFor(shape: PolyShape): [number, number][] | null {
  switch (shape.shape) {
    case 'arrow':
      return ARROW;
    case 'polygon':
      return regularPolygon(shape.sides);
    case 'star':
      return shape.starPoints == null && shape.innerRadius == null ? STAR : starPolygon(shape.starPoints, shape.innerRadius);
    default:
      return null;
  }
}

/** kör-közelítés köbös Bézierrel */
const KAPPA = 0.5522847498;

/**
 * Forma → szerkeszthető görbe: a pontjai a doboz 0–1 terében vannak, így a kinézet azonos
 * marad. `null`, ha a formának nincs zárt körvonala (vonal, már görbe).
 */
export function shapeToPathPoints(layer: Pick<ShapeLayer, 'shape' | 'sides' | 'starPoints' | 'innerRadius'>): PathPoint[] | null {
  const poly = polygonFor(layer);
  if (poly) {
    return poly.map(([x, y]) => ({ x: x / 100, y: y / 100 }));
  }
  if (layer.shape === 'rectangle') {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  }
  if (layer.shape === 'ellipse') {
    const k = KAPPA / 2;
    return [
      { x: 1, y: 0.5, h1: { x: 1, y: 0.5 - k }, h2: { x: 1, y: 0.5 + k } },
      { x: 0.5, y: 1, h1: { x: 0.5 + k, y: 1 }, h2: { x: 0.5 - k, y: 1 } },
      { x: 0, y: 0.5, h1: { x: 0, y: 0.5 + k }, h2: { x: 0, y: 0.5 - k } },
      { x: 0.5, y: 0, h1: { x: 0.5 - k, y: 0 }, h2: { x: 0.5 + k, y: 0 } },
    ];
  }
  return null;
}
