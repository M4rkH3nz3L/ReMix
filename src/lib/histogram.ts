/** 📊 Hisztogram (pure): RGBA bájtokból csatornánként 256 rekesz, az átlátszó képpontok nélkül. */
export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Rec.709 fényesség */
  l: Uint32Array;
  total: number;
}

export type ColorMap = (rgb: [number, number, number]) => [number, number, number];

export function computeHistogram(rgba: Uint8Array, map?: ColorMap): Histogram {
  const h: Histogram = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), total: 0 };
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      continue;
    }
    let [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
    if (map) {
      const c = map([r / 255, g / 255, b / 255]);
      [r, g, b] = [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
    }
    h.r[r] += 1;
    h.g[g] += 1;
    h.b[b] += 1;
    h.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)] += 1;
    h.total += 1;
  }
  return h;
}

/** A beégett árnyékok és kiégett fények aránya a fényesség szerint (0–1). */
export function clipping(h: Histogram): { shadows: number; highlights: number } {
  return h.total === 0 ? { shadows: 0, highlights: 0 } : { shadows: h.l[0] / h.total, highlights: h.l[255] / h.total };
}

/**
 * Két eloszlás távolsága szintben (0–255): ennyivel kell átlagosan arrébb tolni az egyiket, hogy
 * a másik legyen. Egy keskeny tüske egy szintnyi elcsúszása így egy szint, nem teljes eltérés.
 */
export function histogramShift(a: Uint32Array, b: Uint32Array): number {
  const [ta, tb] = [a.reduce((s, v) => s + v, 0), b.reduce((s, v) => s + v, 0)];
  if (ta === 0 || tb === 0) {
    return 255;
  }
  let [ca, cb, sum] = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    ca += a[i] / ta;
    cb += b[i] / tb;
    sum += Math.abs(ca - cb);
  }
  return sum;
}

/** A rajz magassága rekeszenként 0–1: a kiugró csúcs nem nyomja le a többit. */
export function histogramCurve(bins: Uint32Array): number[] {
  const sorted = Array.from(bins).sort((p, q) => p - q);
  const top = Math.max(1, sorted[Math.floor(sorted.length * 0.98)]);
  return Array.from(bins, (v) => Math.min(1, v / top));
}
