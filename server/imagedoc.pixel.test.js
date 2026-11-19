// 🧪 IMAGE-PROD S15: a pixel-art réteg (a kliens csak a `pixelArt` jelzést küldi) legközelebbi szomszéddal
// skálázódik — VALÓDI ffmpeg-renderen, nem egész szorzóval is éles.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderImageDoc } = require('./imagedoc');
const { describeIfRenderer } = require('./testing/renderer');

jest.setTimeout(60000);

/** Chromium-raszter + ffmpeg-visszaolvasás: lokálisan hiányukban átugrik, CI-ben kötelező */
const RASTER = { chromium: true, ffmpeg: true };

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgpixel-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, at: (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}

// 2×1 pixeles rajz 128×64-re nagyítva (mint az app 1024-es rétegképe), a rétegen nem egész szorzóval 77 px-re kicsinyítve
function twoPixels() {
  const file = path.join(dir, 'px.png');
  // rgba-ban rakva össze (yuv-ban az 1 px-es kék a pirosba mosódna)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=0xff0000:s=1x1', '-f', 'lavfi', '-i', 'color=0x0000ff:s=1x1', '-filter_complex', '[0]format=rgba[a];[1]format=rgba[b];[a][b]hstack,scale=128:64:flags=neighbor', '-frames:v', '1', '-y', file]);
  return file;
}

const doc = (layer) => ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 200, height: 200, layers: [{ id: 'bg', kind: 'fill', fill: '#000000' }, layer] });
const layer = (uri, extra = {}) => ({ kind: 'photo', id: 'p', uri, position: { x: 0.5, y: 0.5 }, w: 0.385, h: 0.1925, fit: 'stretch', ...extra });

/** a réteg középső sorában a se nem piros, se nem kék képpontok száma */
function mixedInRow(img) {
  let n = 0;
  for (let x = 70; x < 130; x++) {
    const [r, , b] = img.at(x, 100);
    const red = r > 230 && b < 25;
    const blue = b > 230 && r < 25;
    if (!red && !blue) n += 1;
  }
  return n;
}

describeIfRenderer('👾 S15: pixel-art réteg a szerver-renderben', RASTER, () => {
  it('a jelzett réteg éles: a két szín közt nincs átmenet', async () => {
    const out = await renderImageDoc(doc(layer(twoPixels(), { pixelArt: 1 })), 200, dir);
    expect(mixedInRow(decode(out))).toBe(0);
  });

  it('ellenpróba: jelzés nélkül a sima nagyítás átmenetet ad', async () => {
    const out = await renderImageDoc(doc(layer(twoPixels())), 200, dir);
    expect(mixedInRow(decode(out))).toBeGreaterThan(0);
  });
});
