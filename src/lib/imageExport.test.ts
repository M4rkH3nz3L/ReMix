/**
 * 🧪 A kép-export VALÓDI lánca a kliens-magokkal: a worker renderel (ffmpeg), a kimenetet
 * pixelre ellenőrizzük. Így a kliens-oldali számítások (crop, heal, méret) a tényleges
 * eredményen bizonyítanak, nem csak saját magukon.
 */
import { cropImageDoc } from '@/lib/imageCrop';
import { exportSize, imageCacheKey } from '@/lib/imageExport';
import { customExportSize, estimateExportBytes, formatBytes } from '@/lib/imageExport';
import { canvasToLayerBox, healRegionFromPoints } from '@/lib/imageLayerGeometry';
import { keepsAlpha } from '@/lib/imageIntake';
import type { ImageDoc, PhotoLayer, ShapeLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderImageDoc, docCanvas } = require('../../server/imagedoc');
const { maskToBox } = require('../../server/imageMask');
/* eslint-enable @typescript-eslint/no-require-imports */

// valódi ffmpeg/Chromium fut — párhuzamos teszt-terhelésnél az 5 mp-es alap kevés
jest.setTimeout(60000);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgclient-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file: string) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, at: (x: number, y: number) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}
function lavfi(source: string, name: string) {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', source, '-frames:v', '1', '-y', file]);
  return file;
}
const render = async (d: ImageDoc, sub: string, height?: number) => {
  const w = path.join(dir, sub);
  fs.mkdirSync(w);
  return decode(await renderImageDoc(JSON.parse(JSON.stringify(d)), height, w));
};
const photo = (uri: string, extra: Partial<PhotoLayer> = {}): PhotoLayer => ({ kind: 'photo', id: `p${Math.random()}`, uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra });
const doc = (layers: ImageDoc['layers'], extra: Partial<ImageDoc> = {}): ImageDoc => ({ id: 'd', name: 'D', aspectRatio: '1:1', width: 400, height: 400, layers, ...extra }) as unknown as ImageDoc;

describe('I9/I10 — a kliens mérete = a worker mérete (contract)', () => {
  it.each([[300, 100, 1], [300, 100, 2], [4000, 2000, 2], [4096, 4096, 1], [1080, 1920, 2]])('%d×%d @%d×', (width, height, scale) => {
    const d = { aspectRatio: '1:1', width, height } as ImageDoc;
    const size = exportSize(d, scale);
    const canvas = docCanvas(d, size.height);
    expect([canvas.w, canvas.h]).toEqual([size.width, size.height]);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096);
  });
  it('a 2× tényleg kétszer annyi pixel a kész képen', async () => {
    const d = doc([photo(lavfi('color=red:s=64x64', 'a.png'))], { width: 300, height: 200 });
    const out = await render(d, 'x', exportSize(d, 2).height);
    expect([out.w, out.h]).toEqual([600, 400]);
  });
});

describe('I11 — cache-kulcs', () => {
  const base = doc([], { groups: [] } as unknown as Partial<ImageDoc>);
  const key = (d: ImageDoc, pro = false) => imageCacheKey(d, 100, 'png', undefined, pro);
  it.each([
    ['csoport', { groups: [{ id: 'g', hidden: true }] }],
    ['grade', { grade: 'teal' }],
    ['adjust', { adjust: { brightness: 0.1 } }],
    ['vignetta', { vignette: 0.4 }],
    ['szemcse', { grain: 0.2 }],
  ])('%s változása új kulcs', (_n, patch) => {
    expect(key({ ...base, ...patch } as unknown as ImageDoc)).not.toBe(key(base));
  });
  it('a Pro-váltás új kulcs (a vízjeles kép nem jön vissza)', () => {
    expect(key(base, true)).not.toBe(key(base, false));
  });
});

describe('I17 — kivágás: a kimenet pixelre ugyanaz marad', () => {
  const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const shape = (extra: Partial<ShapeLayer>): ShapeLayer => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.2, h: 0.2, fill: '#ff0000', ...extra }) as ShapeLayer;

  it('maszk: a kivágott doc ugyanott vág', async () => {
    const d = doc([photo(lavfi('color=white:s=64x64', 'w.png'), { mask: { shape: 'rectangle', x: 0.4, y: 0.5, w: 0.1, h: 0.2, feather: 0.005 } })]);
    const full = await render(d, 'a');
    const cropped = await render(cropImageDoc(d, rect), 'b');
    expect([cropped.w, cropped.h]).toEqual([200, 200]);
    for (const [x, y] of [[160, 200], [240, 200], [125, 125], [200, 150]]) {
      expect(Math.abs(cropped.at(x - 100, y - 100)[3] - full.at(x, y)[3])).toBeLessThan(30);
    }
  });
  it('vetett árnyék: az eltolás pixelben azonos', async () => {
    const d = doc([shape({ dropShadow: { color: '#0000ff', dx: 0.05, dy: 0.05, blur: 0.002, opacity: 1 } })]);
    const full = await render(d, 'a');
    const cropped = await render(cropImageDoc(d, rect), 'b');
    const px = [255, 255]; // csak a helyes (20 px-es) eltolásnál esik még az árnyékba
    expect(full.at(px[0], px[1])[2]).toBeGreaterThan(150);
    expect(cropped.at(px[0] - 100, px[1] - 100)[2]).toBeGreaterThan(150);
  });
  it('körvonal és glow: a mért szélesség nem változik', () => {
    const c = cropImageDoc(doc([shape({ stroke: { color: '#000', width: 0.01 }, outerGlow: { size: 0.02 } })]), rect).layers[0] as ShapeLayer;
    expect(c.stroke!.width).toBeCloseTo(0.02);
    expect((c.outerGlow as { size: number }).size).toBeCloseTo(0.04);
  });
  it('a `true` effekt az alapértékből számol', () => {
    const c = cropImageDoc(doc([shape({ dropShadow: true })]), rect).layers[0] as ShapeLayer;
    expect((c.dropShadow as { dx: number }).dx).toBeCloseTo(0.04);
  });
});

describe('I18 — heal a réteg saját terében', () => {
  const layer = { position: { x: 0.5, y: 0.5 }, w: 1, h: 1, rotation: 90 };
  const canvas = { width: 400, height: 400 };

  it('a kliens és a worker ugyanazt a pontot számolja', () => {
    const rotated = { ...layer, position: { x: 0.4, y: 0.6 }, w: 0.5, h: 0.3, rotation: 33, flipH: true };
    const mine = canvasToLayerBox({ x: 0.3, y: 0.2 }, rotated, canvas);
    const theirs = maskToBox({ shape: 'polygon', x: 0.3, y: 0.2, w: 0.1, h: 0.1, points: [{ x: 0.3, y: 0.2 }] }, rotated, 400, 400).points[0];
    expect(mine.x).toBeCloseTo(theirs.x);
    expect(mine.y).toBeCloseTo(theirs.y);
  });
  it('a régió sosem lóg ki a dobozból', () => {
    const r = healRegionFromPoints([{ x: -0.5, y: 0.5 }, { x: 1.5, y: 0.6 }, { x: 0.5, y: 2 }], { ...layer, rotation: 0 }, canvas);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });
  it('90°-kal forgatott fotón a folt tényleg eltűnik a kimenetből', async () => {
    // szürke kép fehér folttal; a folt a forgatás után a vászon (300,100) környékére kerül
    const src = lavfi('color=gray:s=400x400,drawbox=x=80:y=80:w=40:h=40:color=white:t=fill', 'f.png');
    const l = photo(src, { rotation: 90 });
    const before = await render(doc([l]), 'a');
    expect(before.at(300, 100)[0]).toBeGreaterThan(230);
    const lasso = [{ x: 0.68, y: 0.18 }, { x: 0.82, y: 0.18 }, { x: 0.82, y: 0.32 }, { x: 0.68, y: 0.32 }];
    const region = healRegionFromPoints(lasso, l, canvas);
    const after = await render(doc([{ ...l, heal: [region] }]), 'b');
    expect(after.at(300, 100)[0]).toBeLessThan(180);
  });
});

describe('I21 — import-formátum', () => {
  it.each([['a.png', true], ['a.WEBP', true], ['b.gif?x=1', true], ['c.jpg', false], ['d.heic', false]])('%s → alfa: %s', (uri, want) => {
    expect(keepsAlpha(uri)).toBe(want);
  });
});

describe('egyedi méret és becslés', () => {
  const doc = { aspectRatio: '1:1', width: 1000, height: 500 };
  it('az arány marad, a korlátok tartanak', () => {
    expect(customExportSize(doc, 1000)).toEqual({ width: 2000, height: 1000 });
    expect(customExportSize(doc, 50).height).toBe(240);
    expect(customExportSize(doc, 9000)).toEqual({ width: 4096, height: 2048 });
    expect(customExportSize(doc, Number.NaN).height).toBe(500);
  });
  it('a fotó többet nyom, a minőség számít, a PNG a legnagyobb', () => {
    const n = 1_000_000;
    expect(estimateExportBytes(n, 'png', 1, true)).toBeGreaterThan(estimateExportBytes(n, 'jpg', 1, true));
    expect(estimateExportBytes(n, 'jpg', 0.9, true)).toBeGreaterThan(estimateExportBytes(n, 'jpg', 0.5, true));
    expect(estimateExportBytes(n, 'png', 1, true)).toBeGreaterThan(estimateExportBytes(n, 'png', 1, false));
    expect(estimateExportBytes(n, 'webp', 0.9, true)).toBeLessThan(estimateExportBytes(n, 'jpg', 0.9, true));
  });
  it('olvasható méretet ír', () => {
    expect(formatBytes(820_000)).toBe('820 kB');
    expect(formatBytes(3_400_000)).toBe('3,4 MB');
  });
});
