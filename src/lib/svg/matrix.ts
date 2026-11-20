// ── Affin mátrix [a,b,c,d,e,f] ───────────────────────────────────────────────

export type Mat = [number, number, number, number, number, number];
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function parseTransform(str: string | undefined): Mat {
  if (!str) return IDENTITY;
  let m: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t: RegExpExecArray | null;
  while ((t = re.exec(str)) !== null) {
    const fn = t[1];
    const n = t[2].split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
    let step: Mat = IDENTITY;
    if (fn === 'matrix' && n.length === 6) step = n as Mat;
    else if (fn === 'translate') step = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (fn === 'scale') step = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const a = ((n[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const rot: Mat = [cos, sin, -sin, cos, 0, 0];
      if (n.length >= 3) {
        step = mul(mul([1, 0, 0, 1, n[1], n[2]], rot), [1, 0, 0, 1, -n[1], -n[2]]);
      } else step = rot;
    } else if (fn === 'skewX') step = [1, 0, Math.tan(((n[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') step = [1, Math.tan(((n[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, step);
  }
  return m;
}

export const hasRotation = (m: Mat) => Math.abs(m[1]) > 1e-6 || Math.abs(m[2]) > 1e-6;
