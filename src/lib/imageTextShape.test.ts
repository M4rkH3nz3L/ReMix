/** 🧪 Szöveg és alakzat a VALÓDI renderen + a kliens/worker geometria-egyezés. */
import { imageDocToSvg } from '@/lib/svgExport';
import { polygonFor, regularPolygon, shapeToPathPoints, starPolygon } from '@/lib/shapeGeometry';
import { textSize } from '@/lib/imageLayerLayout';
import { selectionMenu } from '@/lib/imageMenu';
import type { ImageDoc, ImageLayer, ShapeLayer, TextLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderImageDoc } = require('../../server/imagedoc');
const worker = require('../../server/shapeGeometry');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(90000);

const W = 400;
const H = 200;
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Img = { w: number; h: number; d: Uint8Array };
async function render(layers: ImageLayer[], width = W, height = H): Promise<Img> {
  const sub = fs.mkdtempSync(path.join(dir, 'r-'));
  const file = await renderImageDoc({ id: 'd', aspectRatio: '1:1', width, height, layers: JSON.parse(JSON.stringify(layers)) }, undefined, sub);
  return { w: width, h: height, d: execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 }) };
}
const alpha = (i: Img, x: number, y: number) => i.d[(y * i.w + x) * 4 + 3];
/** a festett pixelek vízszintes tartománya egy sávban */
function inkX(i: Img, y0: number, y1: number): [number, number] {
  let lo = i.w;
  let hi = -1;
  for (let y = y0; y < y1; y++) for (let x = 0; x < i.w; x++) if (alpha(i, x, y) > 100) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return [lo, hi];
}
const countInk = (i: Img) => { let n = 0; for (let k = 3; k < i.d.length; k += 4) if (i.d[k] > 100) n += 1; return n; };
const text = (extra: Partial<TextLayer>) => ({ kind: 'text', id: 't', text: 'Hosszu elso sor\nRovid', color: '#ffffff', backgroundColor: null, fontSize: 14, fontWeight: 'normal', fontFamily: 'Poppins', position: { x: 0.5, y: 0.5 }, ...extra }) as unknown as ImageLayer;
const shape = (extra: Partial<ShapeLayer>) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.8, fill: '#ff0000', ...extra }) as unknown as ImageLayer;

describe('szöveg-igazítás a kész képen', () => {
  const secondLine = async (textAlign: TextLayer['textAlign']) => {
    const img = await render([text({ textAlign })]);
    return inkX(img, 102, 130);
  };
  it('a rövid sor balra / középre / jobbra kerül', async () => {
    const [l, c, r] = [await secondLine('left'), await secondLine('center'), await secondLine('right')];
    expect(l[0]).toBeLessThan(c[0] - 20);
    expect(r[0]).toBeGreaterThan(c[0] + 20);
    expect(Math.abs((c[0] + c[1]) / 2 - W / 2)).toBeLessThan(8);
  });
});

describe('szövegdoboz', () => {
  it('a megadott szélességbe tördel, és a keret ezt becsüli', async () => {
    const long = 'Egy jo hosszu mondat ami biztosan nem fer ki egy sorba';
    const img = await render([text({ text: long, boxWidth: 0.5, textAlign: 'left', fontSize: 10 })], 400, 400);
    const [lo, hi] = inkX(img, 0, 400);
    expect(hi - lo).toBeLessThanOrEqual(202);
    let top = 400;
    let bottom = 0;
    for (let y = 0; y < 400; y++) if (inkX(img, y, y + 1)[1] >= 0) { top = Math.min(top, y); bottom = y; }
    expect(bottom - top).toBeGreaterThan(90); // több sorba tört
    const est = textSize(text({ text: long, boxWidth: 0.5, fontSize: 10 }) as Extract<ImageLayer, { kind: 'text' }>, 1);
    expect(est.w).toBe(0.5);
    expect(Math.abs(est.h * 400 - (bottom - top))).toBeLessThan(90);
  });
});

describe('dőlt és betűtípus', () => {
  it('a dőlt tényleg megváltoztatja a képet', async () => {
    const plain = await render([text({})]);
    const italic = await render([text({ fontStyle: 'italic' })]);
    let diff = 0;
    for (let k = 3; k < plain.d.length; k += 4) if (Math.abs(plain.d[k] - italic.d[k]) > 100) diff += 1;
    expect(diff).toBeGreaterThan(300);
  });
  it('a betűtípus-választás tényleg más betűképet ad', async () => {
    const a = await render([text({ fontFamily: 'Poppins' })]);
    const b = await render([text({ fontFamily: 'Lobster' })]);
    let diff = 0;
    for (let k = 3; k < a.d.length; k += 4) if (Math.abs(a.d[k] - b.d[k]) > 100) diff += 1;
    expect(diff).toBeGreaterThan(300);
  });
});

describe('sokszög és csillag', () => {
  it.each([
    [{ sides: 3 }],
    [{ sides: 6 }],
    [{ sides: 12 }],
  ])('a kliens és a worker ugyanazt számolja: %j', ({ sides }) => {
    expect(regularPolygon(sides)).toEqual(worker.regularPolygon(sides));
  });
  it.each([[5, 0.5], [3, 0.2], [12, 0.8]])('csillag %d/%d egyezik', (n, r) => {
    expect(starPolygon(n, r)).toEqual(worker.starPolygon(n, r));
  });
  it('a régi ötágú csillag alakja nem változik', () => {
    expect(polygonFor({ shape: 'star' })).toEqual(worker.polygonFor({ shape: 'star' }));
    expect(polygonFor({ shape: 'star' })![0]).toEqual([50, 0]);
  });
  it('a háromszög kitölti a dobozát, és háromszög alakú a kész képen', async () => {
    const img = await render([shape({ shape: 'polygon', sides: 3 })]);
    expect(alpha(img, 200, 30)).toBeGreaterThan(200); // felül a csúcs
    expect(alpha(img, 110, 170)).toBeGreaterThan(200); // alul a sarok
    expect(alpha(img, 110, 30)).toBe(0); // felül a sarok üres
  });
  it('a csillag belső sugara a kész képen is számít', async () => {
    const fat = countInk(await render([shape({ shape: 'star', starPoints: 5, innerRadius: 0.8 })]));
    const thin = countInk(await render([shape({ shape: 'star', starPoints: 5, innerRadius: 0.25 })]));
    expect(fat).toBeGreaterThan(thin * 1.5);
  });
});

describe('forma → görbe', () => {
  it.each(['rectangle', 'ellipse', 'arrow', 'star', 'polygon'] as const)('%s: a kinézet nem változik', async (kind) => {
    const before = shape({ shape: kind, sides: 5 } as Partial<ShapeLayer>);
    const points = shapeToPathPoints(before as ShapeLayer)!;
    const after = { ...before, shape: 'path', points, closed: true } as unknown as ImageLayer;
    const a = await render([before]);
    const b = await render([after]);
    let diff = 0;
    for (let k = 3; k < a.d.length; k += 4) if (Math.abs(a.d[k] - b.d[k]) > 110) diff += 1;
    expect(diff / (W * H)).toBeLessThan(0.01);
  });
  it('a vonalnak nincs körvonala, ezért nem kínáljuk fel', () => {
    expect(shapeToPathPoints({ shape: 'line' })).toBeNull();
    expect(selectionMenu(shape({ shape: 'line' }), { canAlign: false, canBoolean: false }).actions).not.toContain('toPath');
    expect(selectionMenu(shape({ shape: 'star' }), { canAlign: false, canBoolean: false }).actions).toContain('toPath');
  });
});

describe('SVG', () => {
  const doc = (l: ImageLayer) => ({ id: 'd', aspectRatio: '1:1', width: W, height: H, layers: [l] }) as unknown as ImageDoc;
  it('igazítás, dőlt, sokszög kerül a kimenetbe', () => {
    expect(imageDocToSvg(doc(text({ textAlign: 'left' })))).toContain('text-anchor="start"');
    expect(imageDocToSvg(doc(text({ textAlign: 'right' })))).toContain('text-anchor="end"');
    expect(imageDocToSvg(doc(text({ fontStyle: 'italic' })))).toContain('font-style="italic"');
    expect(imageDocToSvg(doc(shape({ shape: 'polygon', sides: 3 })))).toContain('<polygon');
  });
});
