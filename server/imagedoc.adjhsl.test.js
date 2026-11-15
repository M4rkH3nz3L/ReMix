// 🧪 IMAGE-PROD S17: a korrekciós réteg színenkénti HSL-je a szerver-renderben (VALÓDI ffmpeg) — a piros
// sáv eltolódik, a szürke nem; a kliens `layerOps`-ának sorrendje: grade → adjust → HSL.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderImageDoc } = require('./imagedoc');

jest.setTimeout(60000);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgadjhsl-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
}
// bal fele piros, jobb fele szürke (rgba-ban rakva össze)
function halves() {
  const file = path.join(dir, 'h.png');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=0xd03030:s=100x200', '-f', 'lavfi', '-i', 'color=0x808080:s=100x200', '-filter_complex', '[0]format=rgba[a];[1]format=rgba[b];[a][b]hstack', '-frames:v', '1', '-y', file]);
  return file;
}
const doc = (layers) => ({ id: 'd', name: 'd', aspectRatio: '1:1', width: 200, height: 200, layers });
const photo = (uri) => ({ kind: 'photo', id: 'p', uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' });

describe('🎨 S17: HSL a korrekciós rétegen (szerver)', () => {
  it('a piros sáv színe eltolódik, a szürke marad', async () => {
    const src = halves();
    const plain = decode(await renderImageDoc(doc([photo(src)]), 200, fs.mkdtempSync(path.join(dir, 'a'))));
    const out = decode(await renderImageDoc(doc([photo(src), { kind: 'adjust', id: 'a', hsl: { red: { h: 0.4 } } }]), 200, fs.mkdtempSync(path.join(dir, 'b'))));
    const [r0, g0] = plain(50, 100);
    const [r1, g1] = out(50, 100);
    expect(r0 - r1 + (g1 - g0)).toBeGreaterThan(30);
    const grey = out(150, 100);
    expect(Math.abs(grey[0] - 128) + Math.abs(grey[1] - 128) + Math.abs(grey[2] - 128)).toBeLessThan(9);
  });

  it('semleges HSL nem ír .cube-ot és nem változtat', async () => {
    const src = halves();
    const out = decode(await renderImageDoc(doc([photo(src), { kind: 'adjust', id: 'a', hsl: { red: { h: 0 } } }]), 200, fs.mkdtempSync(path.join(dir, 'c'))));
    const [r] = out(50, 100);
    expect(Math.abs(r - 0xd0)).toBeLessThan(4);
  });
});
