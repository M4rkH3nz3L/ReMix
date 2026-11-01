// 🔷 Sokszög-geometria 0–100-as koordinátákban (a forma saját dobozához igazítva). A kliens
// `src/lib/shapeGeometry.ts` tükre, a contract-teszt köti össze — az előnézet, a render és az
// SVG így ugyanazt a formát rajzolja.
const ARROW = [[0, 35], [60, 35], [60, 12], [100, 50], [60, 88], [60, 65], [0, 65]];
// az alap ötágú csillag (a régi dokumentumok alakja, paraméter nélkül ez marad)
const STAR = [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]];

const round = (v) => Math.round(v * 100) / 100;

/** a pontokat a teljes dobozra feszíti, így a forma kitölti a kijelölő keretét */
function fitBox(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = 100 / (Math.max(...xs) - x0);
  const sy = 100 / (Math.max(...ys) - y0);
  return pts.map(([x, y]) => [round((x - x0) * sx), round((y - y0) * sy)]);
}

const clampInt = (v, lo, hi, def) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : def)));

function regularPolygon(sides) {
  const n = clampInt(sides, 3, 12, 6);
  return fitBox(Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [Math.cos(a), Math.sin(a)];
  }));
}

function starPolygon(points, innerRadius) {
  const n = clampInt(points, 3, 12, 5);
  const inner = Math.max(0.1, Math.min(0.9, Number.isFinite(innerRadius) ? innerRadius : 0.5));
  return fitBox(Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  }));
}

/** A forma sokszöge, vagy null, ha nem sokszög-alapú. */
function polygonFor(shape) {
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

module.exports = { polygonFor, regularPolygon, starPolygon };
