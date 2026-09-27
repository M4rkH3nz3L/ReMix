/**
 * 🎨 LUT-import (S-VIDEO NLE, audit ★) — `.cube` (Adobe/Iridas) LUT parse a KLIPRE
 * illesztéshez. Ma csak `.cube`-EXPORT van ([colorClient.ts](./colorClient)); ez a
 * fordított irány: a beolvasott LUT-ot a szín-pipeline alkalmazza. Tiszta,
 * expo-mentes parser + validáció.
 */

export interface CubeLut {
  title?: string;
  /** 1D vagy 3D LUT */
  dim: '1D' | '3D';
  /** a rács mérete (tengelyenként) */
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** a rács-pontok RGB-értékei sorban (3D-nél size^3, 1D-nél size sor) */
  data: [number, number, number][];
}

export type LutParseErrorCode = 'no_size' | 'bad_row' | 'wrong_count';

export interface LutParseResult {
  ok: boolean;
  lut?: CubeLut;
  error?: { code: LutParseErrorCode; detail?: string };
}

/** `.cube` szöveg → strukturált LUT (védett; hibánál `ok:false` + hibakód). */
export function parseCubeLut(text: string): LutParseResult {
  let title: string | undefined;
  let dim: '1D' | '3D' | null = null;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const data: [number, number, number][] = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('TITLE')) {
      const m = /TITLE\s+"?([^"]*)"?/.exec(line);
      title = m?.[1]?.trim();
      continue;
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      dim = '3D';
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (line.startsWith('LUT_1D_SIZE')) {
      dim = '1D';
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (line.startsWith('DOMAIN_MIN')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      domainMin = [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
      continue;
    }
    if (line.startsWith('DOMAIN_MAX')) {
      const p = line.split(/\s+/).slice(1).map(Number);
      domainMax = [p[0] ?? 1, p[1] ?? 1, p[2] ?? 1];
      continue;
    }
    // adat-sor: három float
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      return { ok: false, error: { code: 'bad_row', detail: line } };
    }
    const rgb = parts.map(Number);
    if (rgb.some((v) => Number.isNaN(v))) {
      return { ok: false, error: { code: 'bad_row', detail: line } };
    }
    data.push([rgb[0], rgb[1], rgb[2]]);
  }

  if (!dim || !size || size < 2) {
    return { ok: false, error: { code: 'no_size' } };
  }
  const expected = dim === '3D' ? size * size * size : size;
  if (data.length !== expected) {
    return { ok: false, error: { code: 'wrong_count', detail: `${data.length}/${expected}` } };
  }
  return { ok: true, lut: { ...(title ? { title } : {}), dim, size, domainMin, domainMax, data } };
}
