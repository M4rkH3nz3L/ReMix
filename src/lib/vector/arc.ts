import type { Vec } from './geometry';

/**
 * Elliptikus ív → köbös Bézier-szegmensek (a→b), a W3C endpoint→center
 * konverzióval, ≤90°-os darabokban. A darabszámhoz a `4/3·tan(Δ/4)` fogó-arány.
 * FIGYELEM: a `d`-ben a nagyív/söprés-flageknek külön számnak kell lenniük
 * (`... 0 1 ...`), az egybeírt flag-forma (`...01...`) NEM támogatott.
 */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): { c1: Vec; c2: Vec; end: Vec }[] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x: x2, y: y2 } }];
  }
  const rad = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rxs = rx * rx;
  let rys = ry * ry;
  const x1ps = x1p * x1p;
  const y1ps = y1p * y1p;
  const lambda = x1ps / rxs + y1ps / rys;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rxs = rx * rx;
    rys = ry * ry;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = Math.max(0, rxs * rys - rxs * y1ps - rys * x1ps);
  const denom = rxs * y1ps + rys * x1ps || 1e-12;
  const coef = sign * Math.sqrt(num / denom);
  const cxp = (coef * (rx * y1p)) / ry;
  const cyp = (-coef * (ry * x1p)) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const l = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) || 1e-12;
    let a = Math.acos(Math.min(1, Math.max(-1, dot / l)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dtheta = angle(ux, uy, vx, vy);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
  const delta = dtheta / segs;
  const tcp = (4 / 3) * Math.tan(delta / 4);
  const point = (ang: number): Vec => ({
    x: cos * rx * Math.cos(ang) - sin * ry * Math.sin(ang) + cx,
    y: sin * rx * Math.cos(ang) + cos * ry * Math.sin(ang) + cy,
  });
  const deriv = (ang: number): Vec => {
    const d1x = -rx * Math.sin(ang);
    const d1y = ry * Math.cos(ang);
    return { x: cos * d1x - sin * d1y, y: sin * d1x + cos * d1y };
  };
  const out: { c1: Vec; c2: Vec; end: Vec }[] = [];
  let t1 = theta1;
  for (let i = 0; i < segs; i++) {
    const t2 = t1 + delta;
    const p1 = point(t1);
    const p2 = point(t2);
    const d1 = deriv(t1);
    const d2 = deriv(t2);
    out.push({
      c1: { x: p1.x + tcp * d1.x, y: p1.y + tcp * d1.y },
      c2: { x: p2.x - tcp * d2.x, y: p2.y - tcp * d2.y },
      end: p2,
    });
    t1 = t2;
  }
  return out;
}
