// 🧪 IMAGE-PROD S15: a PSD-export a maszkot (a festett maszkot is) a réteg alfájába égeti — VALÓDI
// ffmpeg-renderen át (a route `layerRasterizer`-ével), majd ag-psd-vel visszaolvasva.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agPsd = require('ag-psd');

const { renderImageDoc } = require('./imagedoc');
const { buildPsdFromImageDoc, layerRasterizer } = require('./psdExport');

jest.setTimeout(60000);

// a readPsd createImageData-t hívhat: ugyanaz a minimális shim, mint a psdExport.test.js-ben
agPsd.initializeCanvas(
  () => {
    throw new Error('no canvas');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psdmask-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function solid(color, name, size) {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}`, '-frames:v', '1', '-y', file]);
  return file;
}
// fehér bal fél, fekete jobb fél (RGB-ben, mint az imagedoc.render.test.js-ben)
function maskPng() {
  const file = path.join(dir, 'mask.png');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=white:s=100x100,format=gbrp', '-f', 'lavfi', '-i', 'color=black:s=50x100,format=gbrp', '-filter_complex', '[0][1]overlay=50:0:format=gbrp', '-frames:v', '1', '-y', file]);
  return file;
}

async function exportedAlpha(mask) {
  const photo = { kind: 'photo', id: 'p', name: 'fotó', uri: solid('white', 'w.png', '200x200'), position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', mask };
  const doc = { id: 'd', name: 'd', aspectRatio: '1:1', width: 200, height: 200, layers: [photo] };
  const psd = await buildPsdFromImageDoc(doc, { fetchLayerPng: async () => null, rasterizeLayerPng: layerRasterizer(doc, dir, renderImageDoc) });
  const read = agPsd.readPsd(psd, { useImageData: true, skipThumbnail: true });
  const layer = read.children.find((l) => l.name === 'fotó');
  const img = layer.imageData;
  return (x, y) => img.data[((y - (layer.top ?? 0)) * img.width + (x - (layer.left ?? 0))) * 4 + 3];
}

describe('🎭 S15: maszk a PSD-exportban', () => {
  it('a festett maszk beleég: a fehér rész látszik, a fekete átlátszó', async () => {
    const alpha = await exportedAlpha({ shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: maskPng() });
    expect(alpha(50, 100)).toBe(255);
    expect(alpha(150, 100)).toBe(0);
  });

  it('a kijelölésből jött (poligon) maszk is beleég', async () => {
    const box = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.4 }, { x: 0.1, y: 0.4 }];
    const alpha = await exportedAlpha({ shape: 'polygon', x: 0.25, y: 0.25, w: 0.3, h: 0.3, feather: 0, points: box, ops: [{ op: 'add', points: box }] });
    expect(alpha(50, 50)).toBe(255);
    expect(alpha(150, 150)).toBe(0);
  });
});
