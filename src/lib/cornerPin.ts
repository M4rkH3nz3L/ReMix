/**
 * 🔲 4-sarkos perspektíva (corner pin, IMAGE-PROD S18) — pure. A fotó doboza (0–1) négy sarka
 * (bal felső, jobb felső, jobb alsó, bal alsó) a dobozon belül bárhová húzható; a tartalom a négyszögre
 * torzul (pl. plakát a falon). A vászon a négyzet → négyszög homográfiát Skia-mátrixként rajzolja, a
 * szerver az ffmpeg `perspective` szűrőjét kapja ugyanezekkel a sarkokkal.
 */
export type Corner = { x: number; y: number };
export type Corners = [Corner, Corner, Corner, Corner];

export const DEFAULT_CORNERS: Corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** érvényes sarok-négyes (a dobozon belül), vagy null */
export function normalizeCorners(c: unknown): Corners | null {
  if (!Array.isArray(c) || c.length !== 4) return null;
  const out = c.map((p) => ({ x: clamp01(Number((p as Corner)?.x)), y: clamp01(Number((p as Corner)?.y)) }));
  return out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ? null : (out as Corners);
}

/** nincs torzítás (mind a négy sarok a helyén) */
export function isIdentityCorners(c: Corners | null | undefined): boolean {
  return !c || c.every((p, i) => Math.abs(p.x - DEFAULT_CORNERS[i].x) < 1e-4 && Math.abs(p.y - DEFAULT_CORNERS[i].y) < 1e-4);
}

/** egységnégyzet → négyszög homográfia (Heckbert), a `[a, b, c, d, e, f, g, h, 1]` sorfolytonos mátrix */
export function squareToQuad(q: Corners): number[] {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  }
  const den = dx1 * dy2 - dx2 * dy1 || 1e-12;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** a `w`×`h` (pont) dobozban rajzolt tartalom mátrixa: (x, y) → a négyszög képpontja */
export function cornerPinMatrix(c: Corners, w: number, h: number): number[] {
  const px = c.map((p) => ({ x: p.x * w, y: p.y * h })) as Corners;
  const [a, b, cc, d, e, f, g, hh] = squareToQuad(px);
  // a forrás (x/w, y/h) az egységnégyzetben
  return [a / w, b / h, cc, d / w, e / h, f, g / w, hh / h, 1];
}

/** egy pont leképezése a mátrixszal (teszthez) */
export function applyMatrix(m: number[], x: number, y: number): Corner {
  const z = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / z, y: (m[3] * x + m[4] * y + m[5]) / z };
}
