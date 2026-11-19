// 🧪 IMAGE-PROD S18: a forma körvonalának igazítása VALÓDI renderen (Chromium + ffmpeg): belül a vonal a
// dobozon belül marad, kívül a doboz köré kerül, középen mindkét oldalra jut; igazítás nélkül a régi út.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderImageDoc } = require('./imagedoc');
const { describeIfRenderer } = require('./testing/renderer');

jest.setTimeout(120000);

/** Chromium-raszter + ffmpeg-visszaolvasás: lokálisan hiányukban átugrik, CI-ben kötelező */
const RASTER = { chromium: true, ffmpeg: true };

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strokealign-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, at: (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}
// a 200×200-as vászon közepén 100×100-as doboz (50…150), fehér forma, piros 8 px-es körvonal
const doc = (shape) => ({
  id: 'd', name: 'd', aspectRatio: '1:1', width: 200, height: 200,
  layers: [{ id: 'bg', kind: 'fill', fill: '#000000' }, { id: 's', kind: 'shape', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ffffff', borderColor: '#ff0000', borderWidth: 4, ...shape }],
});
const red = (p) => p[0] > 180 && p[1] < 90 && p[2] < 90;
async function redCount(shape) {
  const img = decode(await renderImageDoc(doc(shape), 200, fs.mkdtempSync(path.join(dir, 'r'))));
  let inside = 0;
  let outside = 0;
  for (let y = 30; y < 170; y++) for (let x = 30; x < 170; x++) {
    if (!red(img.at(x, y))) continue;
    if (x >= 50 && x < 150 && y >= 50 && y < 150) inside += 1;
    else outside += 1;
  }
  return { inside, outside };
}

describeIfRenderer('🖊️ S18: körvonal-igazítás a szerver-renderben', RASTER, () => {
  it('téglalap: belül csak a dobozon belül, kívül a doboz körül, középen mindkét oldalon', async () => {
    const inside = await redCount({ shape: 'rectangle', borderAlign: 'inside' });
    const outside = await redCount({ shape: 'rectangle', borderAlign: 'outside' });
    const center = await redCount({ shape: 'rectangle', borderAlign: 'center' });
    expect(inside.inside).toBeGreaterThan(2000);
    expect(inside.outside).toBeLessThan(40);
    expect(outside.outside).toBeGreaterThan(2000);
    expect(outside.inside).toBeLessThan(40);
    expect(center.inside).toBeGreaterThan(900);
    expect(center.outside).toBeGreaterThan(900);
  });

  it('csillag belül: a vonal a csillagon belül marad', async () => {
    const r = await redCount({ shape: 'star', borderAlign: 'inside' });
    expect(r.inside).toBeGreaterThan(300);
    expect(r.outside).toBeLessThan(40);
  });

  it('igazítás nélkül a régi út: a téglalap kerete belül', async () => {
    const r = await redCount({ shape: 'rectangle' });
    expect(r.inside).toBeGreaterThan(2000);
    expect(r.outside).toBeLessThan(40);
  });
});
