/**
 * 🧪 SVG-kompatibilitás VALÓDI böngészőben: az exportált SVG-t Chromium rajzolja ki, és
 * pixelre összevetjük a worker-renderrel (Preview == Export == SVG), illetve az
 * export → import → export kör után is ugyanazt kell kapnunk.
 */
import { imageDocToSvg } from '@/lib/svgExport';
import { parseSvg } from '@/lib/svgImport';
import type { ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

/* eslint-disable @typescript-eslint/no-require-imports */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('../../server/node_modules/playwright-core');
const { findChromium } = require('../../server/text-render');
const { renderImageDoc } = require('../../server/imagedoc');
/* eslint-enable @typescript-eslint/no-require-imports */

jest.setTimeout(60000);

const W = 200;
const H = 200;
let dir: string;
let browser: { newPage: (o: object) => Promise<any>; close: () => Promise<void> };
const exe = findChromium();
const it2 = exe ? it : it.skip;

beforeAll(async () => {
  if (exe) browser = await chromium.launch({ executablePath: exe });
});
afterAll(async () => {
  await browser?.close();
});
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svgrt-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function pixels(file: string) {
  const data: Uint8Array = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
  return (x: number, y: number) => [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
}
/** az SVG kirajzolása Chromiummal, átlátszó háttéren */
async function rasterSvg(svg: string, name = 'svg.png') {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><style>*{margin:0;padding:0}html,body{background:transparent}svg{display:block}</style>${svg}`);
  const file = path.join(dir, name);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  return pixels(file);
}
async function rasterDoc(d: ImageDoc) {
  const w = fs.mkdtempSync(path.join(dir, 'r-'));
  return pixels(await renderImageDoc(JSON.parse(JSON.stringify(d)), undefined, w));
}
const doc = (layers: ImageLayer[], extra: Partial<ImageDoc> = {}): ImageDoc => ({ id: 'd', name: 'D', aspectRatio: '1:1', width: W, height: H, layers, ...extra }) as unknown as ImageDoc;
const shape = (extra: Partial<ShapeLayer>): ImageLayer => ({ kind: 'shape', id: `s${Math.random()}`, shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000', ...extra }) as ImageLayer;

/** hány rácspont tér el a két kép között (alfa + szín) — éleken az élsimítás miatt tűrés */
function diff(a: ReturnType<typeof pixels>, b: ReturnType<typeof pixels>) {
  let bad = 0;
  let total = 0;
  for (let y = 4; y < H; y += 8) {
    for (let x = 4; x < W; x += 8) {
      total += 1;
      const p = a(x, y);
      const q = b(x, y);
      if (Math.abs(p[3] - q[3]) > 60 || (p[3] > 128 && q[3] > 128 && p.slice(0, 3).some((v, i) => Math.abs(v - q[i]) > 60))) {
        bad += 1;
      }
    }
  }
  return bad / total;
}

describe('I23/I24 — SVG = render', () => {
  it2.each([
    ['téglalap', { shape: 'rectangle' }],
    ['ellipszis', { shape: 'ellipse' }],
    ['csillag nyújtva', { shape: 'star', w: 0.8, h: 0.4 }],
    ['nyíl nyújtva', { shape: 'arrow', w: 0.8, h: 0.4 }],
    ['kontúros téglalap', { borderWidth: 3, borderColor: '#00ff00' }],
    ['forgatott', { rotation: 30 }],
    ['zárt path kontúrral', { shape: 'path', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], borderWidth: 4, borderColor: '#0000ff' }],
    ['nyitott path', { shape: 'path', closed: false, points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], strokeWidth: 5 }],
  ] as [string, Partial<ShapeLayer>][])('%s', async (_n, extra) => {
    const d = doc([shape(extra)]);
    expect(diff(await rasterSvg(imageDocToSvg(d)), await rasterDoc(d))).toBeLessThan(0.03);
  });

  it2('a rejtett réteg és a rejtett csoport nem kerül az SVG-be', async () => {
    const d = doc([shape({ hidden: true }), shape({ groupId: 'g', fill: '#00ff00' })], { groups: [{ id: 'g', hidden: true }] } as unknown as Partial<ImageDoc>);
    const svg = imageDocToSvg(d);
    expect(svg).not.toContain('#ff0000');
    expect(svg).not.toContain('#00ff00');
  });

  it2('többsoros szöveg: minden sor külön látszik', async () => {
    const text = { kind: 'text', id: 't', text: 'AAA\nBBB', color: '#ff0000', fontSize: 14, position: { x: 0.5, y: 0.5 } } as unknown as ImageLayer;
    const px = await rasterSvg(imageDocToSvg(doc([text])));
    const inked = (y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = 40; x < 160; x++) if (px(x, y)[3] > 100) return true;
      return false;
    };
    expect(inked(70, 98)).toBe(true);
    expect(inked(102, 130)).toBe(true);
  });

  it('a blend-nevek érvényes CSS-értékek', () => {
    expect(imageDocToSvg(doc([shape({ blendMode: 'colordodge' } as Partial<ShapeLayer>)]))).toContain('mix-blend-mode:color-dodge');
  });
  it('fit:stretch → nincs aránytartás', () => {
    const photo = { kind: 'photo', id: 'p', uri: 'data:x', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' } as unknown as ImageLayer;
    expect(imageDocToSvg(doc([photo]))).toContain('preserveAspectRatio="none"');
  });
  it('a betűköz em → user-egység', () => {
    const text = { kind: 'text', id: 't', text: 'A', fontSize: 10, letterSpacing: 0.1, position: { x: 0.5, y: 0.5 } } as unknown as ImageLayer;
    expect(imageDocToSvg(doc([text]))).toContain('letter-spacing="2"');
  });
});

describe('I25 — SVG-import', () => {
  const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
  const importDoc = (svg: string) => doc(parseSvg(svg).layers);

  it2.each([
    ['lyukas ikon (evenodd)', '<path fill-rule="evenodd" fill="#f00" d="M40 40H160V160H40ZM80 80H120V120H80Z"/>'],
    ['csak körvonal zárt path', '<path fill="none" stroke="#f00" stroke-width="10" d="M40 40L160 40L160 160L40 160Z"/>'],
    ['kitöltés + körvonal', '<path fill="#f00" stroke="#00f" stroke-width="10" d="M40 40L160 40L160 160L40 160Z"/>'],
    ['transzformált vonalvastagság', '<g transform="scale(2)"><path fill="none" stroke="#f00" stroke-width="5" d="M20 20L80 20L80 80L20 80Z"/></g>'],
    ['csoport-opacitás', '<g opacity="0.5"><rect x="40" y="40" width="120" height="120" fill="#f00"/></g>'],
  ])('%s: a behozott doc ugyanúgy néz ki, mint az eredeti SVG', async (_n, body) => {
    const svg = wrap(body);
    expect(diff(await rasterSvg(svg), await rasterDoc(importDoc(svg)))).toBeLessThan(0.03);
  });

  it('a nem támogatott elemeket jelenti', () => {
    const r = parseSvg(wrap('<defs><clipPath id="c"><rect/></clipPath></defs><use href="#a"/><use href="#b"/><image href="x.png"/><rect x="0" y="0" width="10" height="10"/>'));
    expect(r.unsupported).toEqual({ clipPath: 1, use: 2, image: 1 });
    expect(r.layers).toHaveLength(1);
  });

  it2('export → import → export kör: a kép nem változik', async () => {
    const d = doc([shape({ shape: 'ellipse', fill: '#00ff00', opacity: 0.6 }), shape({ shape: 'path', closed: true, w: 0.3, h: 0.3, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], borderWidth: 2, borderColor: '#0000ff' })]);
    const first = imageDocToSvg(d);
    const second = imageDocToSvg(importDoc(first));
    expect(diff(await rasterSvg(first, 'a.png'), await rasterSvg(second, 'b.png'))).toBeLessThan(0.03);
  });
});
