// 🧪 IMAGE-PROD S13: a réteg belső stílusai (színátfedés, belső ragyogás, belső árnyék) VALÓDI ffmpeg-renderen.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderImageDoc } = require('./imagedoc');
const { innerEffectsFilters } = require('./imageFilters');
const { itIfRenderer } = require('./testing/renderer');

jest.setTimeout(60000);

/** Chromium-raszter + ffmpeg-visszaolvasás: lokálisan hiányukban átugrik, CI-ben kötelező */
const RASTER = { chromium: true, ffmpeg: true };
const itRaster = itIfRenderer(RASTER);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imginner-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, at: (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}
function solid(color, name, size = '100x100') {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}`, '-frames:v', '1', '-y', file]);
  return file;
}
// a fotó a vászon közepén, fél méretben (100×100 px egy 200×200-as vásznon), átlátszó háttér
const photo = (uri, extra = {}) => ({ kind: 'photo', id: 'p', uri, position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fit: 'stretch', ...extra });
const doc = (layers) => ({ id: 'd', aspectRatio: '1:1', width: 200, height: 200, layers });
const render = async (layer, sub) => {
  const d = path.join(dir, sub);
  fs.mkdirSync(d);
  return decode(await renderImageDoc(doc([layer]), 200, d));
};

describe('🎨 S13: belső réteg-stílusok a szerver-renderben', () => {
  it('színátfedés: a réteg alakján belül átszínez (erővel), az alak és a háttér marad', async () => {
    const src = solid('0x808080', 'g.png');
    const out = await render(photo(src, { colorOverlay: { color: '#ff0000', opacity: 1 } }), 'o1');
    expect(out.at(100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    expect(out.at(10, 10)[3]).toBe(0); // a rétegen kívül átlátszó marad
    const half = await render(photo(src, { colorOverlay: { color: '#ff0000', opacity: 0.5 } }), 'o2');
    const c = half.at(100, 100);
    expect(Math.abs(c[0] - 192)).toBeLessThanOrEqual(3);
    expect(Math.abs(c[1] - 64)).toBeLessThanOrEqual(3);
  });

  it('belső árnyék: az eltolás felőli (bal-felső) belső szélen sötét, a túlsó szélen és középen nem', async () => {
    const src = solid('0xffffff', 'w.png');
    const out = await render(photo(src, { innerShadow: { color: '#000000', dx: 0.03, dy: 0.03, blur: 0.004, opacity: 1 } }), 's1');
    const topLeft = out.at(53, 53); // a réteg bal-felső sarka 50,50
    const bottomRight = out.at(146, 146);
    const center = out.at(100, 100);
    expect(topLeft[0]).toBeLessThan(80);
    expect(bottomRight[0]).toBeGreaterThan(230);
    expect(center[0]).toBeGreaterThan(230);
    expect(out.at(10, 10)[3]).toBe(0);
  });

  it('belső ragyogás: minden belső szélen világosít, középen nem', async () => {
    const src = solid('0x000000', 'k.png');
    const out = await render(photo(src, { innerGlow: { color: '#ffffff', size: 0.02, opacity: 1 } }), 'g1');
    for (const [x, y] of [[52, 100], [147, 100], [100, 52], [100, 147]]) {
      expect(out.at(x, y)[0]).toBeGreaterThan(40);
    }
    expect(out.at(100, 100)[0]).toBeLessThan(10);
  });

  itRaster('forma is kapja (a forgatás előtt, a saját terében)', async () => {
    const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#808080', colorOverlay: { color: '#00ff00', opacity: 1 } };
    const out = await render(shape, 'sh');
    expect(out.at(100, 100).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it('a klienstől jött szín nem juthat a szűrőgráfba (csak #rrggbb)', () => {
    const f = innerEffectsFilters('[a]', '[b]', { colorOverlay: { color: "red'];[x]drawtext=text=pwn", opacity: 1 } }, 100, 100, 't').join(';');
    expect(f).not.toContain('pwn');
    expect(f).toContain('0xff2d95'); // az alapszín
  });
});
