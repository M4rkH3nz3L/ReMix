import type { CurvePoint } from '@/types/project';

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rendezett, 0…1-be zárt pontok; a két szél x-e 0-ra és 1-re rögzül. */
export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  const pts = points
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) {
    return IDENTITY_CURVE.map((p) => ({ ...p }));
  }
  pts[0] = { x: 0, y: pts[0].y };
  pts[pts.length - 1] = { x: 1, y: pts[pts.length - 1].y };
  return pts;
}

/** Identitás (y=x) → nincs látható hatás, a render kihagyja a szűrőt. */
export function isIdentityCurve(points?: CurvePoint[]): boolean {
  if (!points || points.length < 2) {
    return true;
  }
  return points.every((p) => Math.abs(p.x - p.y) < 1e-3);
}

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

/**
 * A görbe kirajzolásához: sűrű {x,y} mintasor 0…1-ben, Catmull-Rom spline-nal
 * (az ffmpeg `curves` természetes köbös spline-jának vizuális közelítése).
 */
export function sampleCurvePath(points: CurvePoint[], samplesPerSeg = 12): CurvePoint[] {
  const pts = normalizeCurve(points);
  const out: CurvePoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    for (let j = 0; j <= samplesPerSeg; j++) {
      const t = j / samplesPerSeg;
      out.push({
        x: clamp01(catmull(p0.x, p1.x, p2.x, p3.x, t)),
        y: clamp01(catmull(p0.y, p1.y, p2.y, p3.y, t)),
      });
    }
  }
  return out;
}

/** ffmpeg `curves` pont-string ("x/y x/y …"); identitásnál null (kihagyandó). */
export function curveSpec(points?: CurvePoint[]): string | null {
  if (isIdentityCurve(points)) {
    return null;
  }
  return normalizeCurve(points as CurvePoint[])
    .map((p) => `${clamp01(p.x).toFixed(3)}/${clamp01(p.y).toFixed(3)}`)
    .join(' ');
}
