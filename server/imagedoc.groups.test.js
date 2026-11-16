// 🧪 IMAGE-PROD S18: beágyazott csoportok a szerver-renderben (VALÓDI ffmpeg) és a PSD-exportban — a
// szülő rejtettsége és áttetszősége öröklődik; a PSD-ben a mappa a szülő-mappába kerül.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const agPsd = require('ag-psd');
const { PNG } = require('pngjs');

const { renderImageDoc } = require('./imagedoc');
const { buildPsdFromImageDoc } = require('./psdExport');

jest.setTimeout(120000);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imggroups-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
}
const white = { id: 's', kind: 'shape', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ffffff', groupId: 'H' };
const doc = (groups) => ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 100, height: 100, layers: [{ id: 'bg', kind: 'fill', fill: '#000000' }, white], groups });

describe('🗂️ S18: beágyazott csoportok a szerveren', () => {
  it('a szülő áttetszősége a beágyazott csoport tagjára is hat (0,5 × 0,5)', async () => {
    const at = decode(await renderImageDoc(doc([{ id: 'G', name: 'G', opacity: 0.5 }, { id: 'H', name: 'H', parentId: 'G', opacity: 0.5 }]), 100, fs.mkdtempSync(path.join(dir, 'a'))));
    const v = at(50, 50)[0];
    expect(v).toBeGreaterThan(50);
    expect(v).toBeLessThan(80); // ≈ 64 (25%)
  });

  it('a rejtett szülő a beágyazott csoport tagját is elrejti', async () => {
    const at = decode(await renderImageDoc(doc([{ id: 'G', name: 'G', hidden: true }, { id: 'H', name: 'H', parentId: 'G' }]), 100, fs.mkdtempSync(path.join(dir, 'b'))));
    expect(at(50, 50)[0]).toBeLessThan(10);
  });

  it('PSD: a beágyazott csoport mappája a szülő-mappában van', async () => {
    agPsd.initializeCanvas(() => { throw new Error('no canvas'); }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
    const png = new PNG({ width: 4, height: 4 });
    png.data.fill(255);
    const psd = await buildPsdFromImageDoc(doc([{ id: 'G', name: 'Külső' }, { id: 'H', name: 'Belső', parentId: 'G' }]), {
      fetchLayerPng: async () => null,
      rasterizeLayerPng: async () => PNG.sync.write(png),
    });
    const read = agPsd.readPsd(psd, { useImageData: true, skipThumbnail: true });
    const outer = read.children.find((c) => c.name === 'Külső');
    expect(outer).toBeTruthy();
    expect(outer.children.some((c) => c.name === 'Belső')).toBe(true);
  });
});
