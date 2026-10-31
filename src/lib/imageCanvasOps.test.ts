/**
 * 🧪 Vászon-műveletek a VALÓDI renderen: a forgatott/tükrözött dokumentum kimenete pixelre
 * egyezzen az eredeti kép ffmpeg-gel forgatott/tükrözött változatával.
 */
import { flattenTargets, flipCanvasDoc, mergeDownTargets, rasterSubDoc, replaceWithRaster, resampleDoc, resizeCanvasDoc, rotateCanvasDoc } from '@/lib/imageCanvasOps';
import { aspectCropRect, resizeCropCorner } from '@/lib/imageCrop';
import type { ImageDoc, ImageLayer, PhotoLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderImageDoc } = require('../../server/imagedoc');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(90000);

let dir: string;
let photoUri: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cops-'));
  photoUri = path.join(dir, 'p.png');
  // aszimmetrikus minta: minden irány megkülönböztethető
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=0x204060:s=120x80,drawbox=x=0:y=0:w=40:h=30:color=yellow:t=fill,drawbox=x=90:y=50:w=30:h=30:color=white:t=fill', '-frames:v', '1', '-y', photoUri]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Img = { w: number; h: number; d: Uint8Array };
function decode(file: string, vf?: string): Img {
  const out = path.join(dir, `dec${Math.random()}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...(vf ? ['-vf', vf] : []), '-y', out]);
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]).toString().trim().split(',').map(Number);
  return { w, h, d: execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 }) };
}
const render = async (d: ImageDoc) => {
  const w = fs.mkdtempSync(path.join(dir, 'r-'));
  return renderImageDoc(JSON.parse(JSON.stringify(d)), undefined, w) as Promise<string>;
};
/** a pixelek hány százaléka tér el látványosan (élsimítás-tűréssel) */
function diff(a: Img, b: Img): number {
  expect([a.w, a.h]).toEqual([b.w, b.h]);
  let bad = 0;
  for (let i = 0; i < a.d.length; i += 4) {
    const alpha = Math.abs(a.d[i + 3] - b.d[i + 3]);
    const color = a.d[i + 3] > 128 && b.d[i + 3] > 128 ? Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2])) : 0;
    if (alpha > 90 || color > 90) bad += 1;
  }
  return bad / (a.w * a.h);
}

const scene = (): ImageDoc => ({
  id: 'd', name: 'D', aspectRatio: '4:5', width: 400, height: 240,
  layers: [
    { kind: 'photo', id: 'p', uri: photoUri, position: { x: 0.35, y: 0.45 }, w: 0.5, h: 0.6, fit: 'stretch', rotation: 20 },
    { kind: 'photo', id: 'm', uri: photoUri, position: { x: 0.8, y: 0.7 }, w: 0.3, h: 0.4, fit: 'stretch', flipH: true, mask: { shape: 'ellipse', x: 0.8, y: 0.7, w: 0.2, h: 0.3, feather: 0.01 } },
    { kind: 'shape', id: 's', shape: 'arrow', position: { x: 0.7, y: 0.2 }, w: 0.3, h: 0.2, fill: '#ff0000', rotation: 15, dropShadow: { color: '#00ff00', dx: 0.03, dy: 0.05, blur: 0.002, opacity: 1 } },
    { kind: 'text', id: 't', text: 'Rg', color: '#ffffff', fontSize: 18, position: { x: 0.2, y: 0.82 } },
    { kind: 'shape', id: 'b', shape: 'rectangle', position: { x: 0.45, y: 0.15 }, w: 0.12, h: 0.12, fill: '#00ffff', borderColor: '#ff00ff', borderWidth: 2, opacity: 0.7 },
  ] as ImageLayer[],
} as unknown as ImageDoc);

describe('vászon-forgatás és -tükrözés a kész képen', () => {
  it.each([
    ['90° jobbra', (d: ImageDoc) => rotateCanvasDoc(d, 90), 'transpose=1'],
    ['90° balra', (d: ImageDoc) => rotateCanvasDoc(d, -90), 'transpose=2'],
    ['180°', (d: ImageDoc) => rotateCanvasDoc(d, 180), 'hflip,vflip'],
    ['vízszintes tükrözés', (d: ImageDoc) => flipCanvasDoc(d, 'horizontal'), 'hflip'],
    ['függőleges tükrözés', (d: ImageDoc) => flipCanvasDoc(d, 'vertical'), 'vflip'],
  ] as const)('%s', async (_n, op, vf) => {
    const original = await render(scene());
    const expected = decode(original, vf);
    const actual = decode(await render(op(scene())));
    expect(diff(actual, expected)).toBeLessThan(0.016); // élsimítás + a szöveg 1 px-es kerekítése
  });
  it('a szöveg pontosan egyszer forog', async () => {
    const text = { ...scene(), layers: [{ kind: 'text', id: 't', text: 'Lllll', color: '#ffffff', fontSize: 16, position: { x: 0.5, y: 0.5 } }] } as unknown as ImageDoc;
    expect(diff(decode(await render(rotateCanvasDoc(text, 90))), decode(await render(text), 'transpose=1'))).toBeLessThan(0.012);
    expect(diff(decode(await render(flipCanvasDoc(text, 'horizontal'))), decode(await render(text), 'hflip'))).toBeLessThan(0.012);
  });
  it('a forgatott réteg nem vágódik le', async () => {
    const bar = { ...scene(), width: 400, height: 400, layers: [{ kind: 'shape', id: 'r', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.1, fill: '#ff0000', rotation: 90 }] } as unknown as ImageDoc;
    const img = decode(await render(bar));
    const alphaAt = (x: number, y: number) => img.d[(y * img.w + x) * 4 + 3];
    expect(alphaAt(200, 50)).toBe(255); // a 320 px hosszú sáv teteje
    expect(alphaAt(200, 350)).toBe(255);
    expect(alphaAt(100, 200)).toBe(0);
  });
  it('négy 90°-os forgatás = az eredeti', () => {
    let d = scene();
    for (let i = 0; i < 4; i++) d = rotateCanvasDoc(d, 90);
    const a = d.layers[0] as PhotoLayer;
    const b = scene().layers[0] as PhotoLayer;
    expect(a.position.x).toBeCloseTo(b.position.x);
    expect(a.w).toBeCloseTo(b.w);
    expect(d.width).toBe(400);
    expect(a.rotation).toBe(380);
  });
  it('kétszeri tükrözés = az eredeti', () => {
    const d = flipCanvasDoc(flipCanvasDoc(scene(), 'horizontal'), 'horizontal');
    expect((d.layers[1] as PhotoLayer).flipH).toBe(true);
    expect((d.layers[0] as PhotoLayer).position.x).toBeCloseTo(0.35);
  });
});

describe('vászonméret horgonnyal', () => {
  it.each([
    ['bal felső', { x: 0, y: 0 }, 0, 0],
    ['közép', { x: 0.5, y: 0.5 }, 100, 80],
    ['jobb alsó', { x: 1, y: 1 }, 200, 160],
  ])('%s: a tartalom nem torzul, pixelre a helyén marad', async (_n, anchor, ox, oy) => {
    const original = await render(scene());
    const next = resizeCanvasDoc(scene(), 600, 400, anchor);
    const expected = decode(original, `pad=600:400:${ox}:${oy}:color=black@0,format=rgba`);
    expect(diff(decode(await render(next)), expected)).toBeLessThan(0.02);
  });
  it('kisebb vászon = vágás a horgonyhoz', async () => {
    const original = await render(scene());
    const next = resizeCanvasDoc(scene(), 200, 120, { x: 0, y: 0 });
    expect(diff(decode(await render(next)), decode(original, 'crop=200:120:0:0'))).toBeLessThan(0.02);
  });
  it('képméret: arányos skálázás', async () => {
    const original = await render(scene());
    const next = resampleDoc(scene(), 800, 480);
    expect(diff(decode(await render(next)), decode(original, 'scale=800:480:flags=bicubic'))).toBeLessThan(0.04);
  });
});

describe('egyesítés / lapítás', () => {
  const merged = async (d: ImageDoc, ids: string[]) => {
    const sub = rasterSubDoc(d, ids);
    const png = await render(sub);
    return replaceWithRaster(d, ids, png, 'rst', 'Egyesítve');
  };
  it('a lapított kép pixelre ugyanaz', async () => {
    const d = scene();
    const flat = await merged(d, flattenTargets(d));
    expect(flat.layers).toHaveLength(1);
    expect(diff(decode(await render(flat)), decode(await render(d)))).toBeLessThan(0.01);
  });
  it('az egyesítés lefelé megtartja a többi réteget és a sorrendet', async () => {
    const d = scene();
    const pair = mergeDownTargets(d, 't')!;
    expect(pair).toEqual(['s', 't']);
    const next = await merged(d, pair);
    expect(next.layers.map((l) => l.id)).toEqual(['p', 'm', 'rst', 'b']);
    expect(diff(decode(await render(next)), decode(await render(d)))).toBeLessThan(0.01);
  });
  it('a csoport-opacitás beleég', () => {
    const d = { ...scene(), groups: [{ id: 'g', name: 'G', opacity: 0.5 }] } as unknown as ImageDoc;
    d.layers = d.layers.map((l) => (l.id === 'p' ? { ...l, groupId: 'g', opacity: 0.8 } : l)) as ImageLayer[];
    expect(rasterSubDoc(d, ['p']).layers[0].opacity).toBeCloseTo(0.4);
  });
  it('legalsó vagy zárolt rétegre nincs egyesítés', () => {
    const d = scene();
    expect(mergeDownTargets(d, 'p')).toBeNull();
    d.layers = d.layers.map((l) => (l.id === 's' ? { ...l, locked: true } : l)) as ImageLayer[];
    expect(mergeDownTargets(d, 't')).toBeNull();
    expect(flattenTargets(d)).not.toContain('s');
  });
});

describe('kivágás aránytartással', () => {
  const doc = { aspectRatio: '1:1', width: 1000, height: 500 } as ImageDoc;
  const pxRatio = (r: { w: number; h: number }) => (r.w * 1000) / (r.h * 500);
  it('16:9 preset sarok-húzás után is 16:9', () => {
    const start = aspectCropRect(doc, 16 / 9);
    const aspect = (16 / 9) * (500 / 1000);
    start.w *= 0.5;
    start.h *= 0.5;
    const r = resizeCropCorner(start, 'br', 0.2, 0.01, aspect);
    expect(pxRatio(r)).toBeCloseTo(16 / 9);
  });
  it('a szemközti sarok áll, és a vásznon belül marad', () => {
    const start = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const r = resizeCropCorner(start, 'br', 5, 5, 1);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
    expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
  });
  it('bal felső sarok felé is arányos', () => {
    const r = resizeCropCorner({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }, 'tl', -0.1, -0.02, 1);
    expect(r.w).toBeCloseTo(r.h);
    expect(r.x + r.w).toBeCloseTo(0.7);
  });
});
