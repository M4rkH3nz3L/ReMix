// 🧪 MO-B2: a render nem adhat ki hiányos tartalmat csendben. Ha a szöveg/forma nem renderelhető, a job érthető
// hibával bukik; ha csak egy effekt egyszerűsödik (animált szöveg → álló), a videó elkészül, és a jelentés hozza.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { itIfRenderer } = require('./testing/renderer');

jest.setTimeout(180000);

/** Chromium-raszter + ffmpeg-visszaolvasás: lokálisan hiányukban átugrik, CI-ben kötelező */
const RASTER = { chromium: true, ffmpeg: true };
const itRaster = itIfRenderer(RASTER);

const project = (textClip) => ({
  id: 'p', name: 'p', aspectRatio: '1:1', schemaVersion: 10, createdAt: '', updatedAt: '', assets: [],
  tracks: [
    { type: 'video', clips: [] },
    { type: 'text', clips: [{ id: 't', kind: 'text', start: 0, duration: 1.2, text: 'Helló', fontSize: 14, fontWeight: 'bold', backgroundColor: null, color: '#ffffff', position: { x: 0.5, y: 0.5 }, ...textClip }] },
  ],
});

/** a videó 0,8 s-os képkockáján a világos (szöveg) képpontok száma */
function brightPixels(file) {
  const data = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.8', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
  let n = 0;
  for (const v of data) if (v > 200) n += 1;
  return n;
}

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'degraded-'));
  jest.resetModules();
  jest.dontMock('./text-render');
  jest.dontMock('./text-motion');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a szöveg-raszter hibája: a render érthető hibával bukik (nem „siker” szöveg nélkül)', async () => {
  jest.doMock('./text-render', () => ({ ...jest.requireActual('./text-render'), renderTextPngs: jest.fn().mockRejectedValue(new Error('chromium le')) }));
  const { renderProject } = require('./render');
  await expect(renderProject(project({}), dir, () => {}, { resolution: 480 })).rejects.toMatchObject({
    name: 'RenderContentError',
    part: 'text',
  });
});

test('a forma-raszter hibája: a render bukik, a hiba a formát nevezi meg', async () => {
  jest.doMock('./text-render', () => ({ ...jest.requireActual('./text-render'), renderShapePngs: jest.fn().mockRejectedValue(new Error('rossz méret')) }));
  const { renderProject } = require('./render');
  await expect(renderProject(project({}), dir, () => {}, { resolution: 480 })).rejects.toThrow(/formák/);
});

itRaster('az animált szöveg hibája: a videó elkészül álló szöveggel, a jelentés hozza (textMotion)', async () => {
  jest.doMock('./text-motion', () => ({ renderTextSequence: jest.fn().mockRejectedValue(new Error('képsor hiba')) }));
  const { renderProject } = require('./render');
  const report = {};
  const out = await renderProject(project({ textMotion: { preset: 'typeOn', by: 'char' } }), dir, () => {}, { resolution: 480 }, undefined, report);
  expect(fs.existsSync(out)).toBe(true);
  expect(report.degraded).toEqual(['textMotion']);
  expect(brightPixels(out)).toBeGreaterThan(200); // a szöveg ott van, csak animáció nélkül
});

itRaster('hiba nélkül nincs visszaesés', async () => {
  const { renderProject } = require('./render');
  const report = {};
  const out = await renderProject(project({}), dir, () => {}, { resolution: 480 }, undefined, report);
  expect(fs.existsSync(out)).toBe(true);
  expect(report.degraded ?? []).toEqual([]);
  expect(brightPixels(out)).toBeGreaterThan(200);
});
