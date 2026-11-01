/**
 * 🧪 Az előnézet színe a VALÓDI export ellen mérve: minden beállítást lefuttatunk az ffmpeg-
 * láncon, és színenként összevetjük a tiszta függvénnyel. A hiba 0–255 skálán értendő.
 */
import { applyOps, layerOps, type Rgb } from '@/lib/imagePixelPipeline';
import { buildLutBytes, hasColorOps, sampleLut } from '@/lib/imagePreviewLut';
import type { PhotoLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderImageDoc } = require('../../server/imagedoc');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(180000);

const COLORS = [[200, 60, 40], [40, 160, 80], [50, 70, 200], [128, 128, 128], [230, 220, 200], [30, 25, 40], [240, 200, 60], [90, 40, 120]];
const CELL = 40;
let dir: string;
let png: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pix-'));
  png = path.join(dir, 's.png');
  const hex = (c: number[]) => `0x${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const boxes = COLORS.map((c, i) => `drawbox=x=${i * CELL}:y=0:w=${CELL}:h=${CELL}:color=${hex(c)}:t=fill`).join(',');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${COLORS.length * CELL}x${CELL},format=rgb24,${boxes}`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-y', png]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function exportColors(layer: Partial<PhotoLayer>): Promise<number[][]> {
  const W = COLORS.length * CELL;
  const w = fs.mkdtempSync(path.join(dir, 'r-'));
  const file = await renderImageDoc({ id: 'd', aspectRatio: '1:1', width: W, height: CELL, layers: [{ kind: 'photo', id: 'p', uri: png, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...layer }] }, undefined, w);
  const d = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
  return COLORS.map((_, i) => {
    const o = (20 * W + i * CELL + 20) * 4;
    return [d[o], d[o + 1], d[o + 2]];
  });
}
/** a legnagyobb csatorna-eltérés a szín-mintákon */
async function maxError(layer: Partial<PhotoLayer>): Promise<number> {
  const real = await exportColors(layer);
  const ops = layerOps(layer as PhotoLayer);
  const errs = COLORS.map((c, i) => {
    const p = applyOps(ops, c.map((v) => v / 255) as Rgb).map((v) => v * 255);
    return Math.max(...real[i].map((v, k) => Math.abs(v - p[k])));
  });
  return Math.max(...errs);
}

const CASES: [string, Partial<PhotoLayer>][] = [
  ['nincs', {}],
  ['fényerő', { adjust: { brightness: 0.2 } }],
  ['kontraszt +', { adjust: { contrast: 0.3 } }],
  ['kontraszt −', { adjust: { contrast: -0.3 } }],
  ['telítettség +', { adjust: { saturation: 0.5 } }],
  ['telítettség −', { adjust: { saturation: -0.6 } }],
  ['expozíció', { adjust: { exposure: 0.5 } }],
  ['csúcsfény/árnyék', { adjust: { highlights: 0.6, shadows: -0.5 } }],
  ['fehér/fekete', { adjust: { whites: -0.5, blacks: 0.5 } }],
  ['hőmérséklet', { adjust: { temperature: 0.2 } }],
  ['hőmérséklet −', { adjust: { temperature: -0.2 } }],
  ['tint', { adjust: { tint: 0.2 } }],
  ['vibrance', { adjust: { vibrance: 0.6 } }],
  ['vibrance −', { adjust: { vibrance: -0.6 } }],
  ['hue', { adjust: { hue: 0.25 } }],
  ['hsl-telítettség', { adjust: { hslSaturation: 0.4 } }],
  ['filterId warm', { filterId: 'warm', filterIntensity: 1 }],
  ['filterId night', { filterId: 'night', filterIntensity: 0.6 }],
  ['szintek', { levels: { black: 0.1, white: 0.8, gamma: 1.4 } }],
  ['csatorna-mixer', { channelMix: { rr: 0.5, rg: 0.5, gg: 1, bb: 0.8, bg: 0.2 } }],
  ['gradient-map', { gradientMap: { shadow: '#102040', highlight: '#ffcc80' } }],
  ['szürke', { filters: [{ type: 'grayscale', amount: 1 }] }],
  ['szépia', { filters: [{ type: 'sepia', amount: 0.7 }] }],
  ['párátlanítás', { filters: [{ type: 'dehaze', amount: 0.5 }] }],
  ['poszter', { filters: [{ type: 'posterize', amount: 0.5 }] }],
  ['duotone', { filters: [{ type: 'duotone', amount: 0.8 }] }],
  ['grade teal-orange', { grade: 'teal-orange' }],
  ['grade vintage', { grade: 'vintage' }],
  ['grade vibrant', { grade: 'vibrant' }],
  ['grade cold', { grade: 'cold' }],
  ['grade warm-film', { grade: 'warm-film' }],
  ['grade dreamy', { grade: 'dreamy' }],
] as [string, Partial<PhotoLayer>][];

const LIMIT = Number(process.env.PIX_LIMIT ?? 8);

describe('előnézet = export színben', () => {
  it.each(CASES)('%s', async (_n, layer) => {
    const e = await maxError(layer);
    if (process.env.PIX_LOG) console.log('PIX', _n, e.toFixed(1));
    expect(e).toBeLessThanOrEqual(LIMIT);
  });
});

describe('a 25³-es LUT hűsége', () => {
  it.each(CASES.filter(([n]) => !['poszter'].includes(n)))('%s: az interpolált LUT is az exportot adja', async (_n, layer) => {
    const real = await exportColors(layer);
    const lut = buildLutBytes(layer as PhotoLayer);
    const errs = COLORS.map((c, i) => {
      const p = sampleLut(lut, c.map((v) => v / 255) as Rgb).map((v) => v * 255);
      return Math.max(...real[i].map((v, k) => Math.abs(v - p[k])));
    });
    if (process.env.PIX_LOG) console.log('LUT', _n, Math.max(...errs).toFixed(1));
    expect(Math.max(...errs)).toBeLessThanOrEqual(Number(process.env.PIX_LUT_LIMIT ?? 12));
  });
  it('a semleges réteg LUT-ja azonosság', () => {
    const lut = buildLutBytes({});
    expect(sampleLut(lut, [0.3, 0.6, 0.9]).map((v) => Math.round(v * 100))).toEqual([30, 60, 90]);
    expect(hasColorOps({})).toBe(false);
    expect(hasColorOps({ adjust: { contrast: 0.2 } })).toBe(true);
  });
});
