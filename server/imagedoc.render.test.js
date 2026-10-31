// 🧪 VALÓDI render-tesztek: a teljes ffmpeg/Chromium lánc fut, a kimenetet pixelre ellenőrizzük.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { renderImageDoc } = require('./imagedoc');

// valódi ffmpeg/Chromium fut — párhuzamos teszt-terhelésnél az 5 mp-es alap kevés
jest.setTimeout(60000);

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgrender-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** dekódolt kép: szélesség, magasság, RGBA-pixelek */
function decode(file) {
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim();
  const [w, h] = probe.split(',').map(Number);
  const data = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  return { w, h, at: (x, y) => [...data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] };
}

/** egyszínű tesztkép (ffmpeg) */
function solid(color, name = 'a.png', size = '64x64') {
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}`, '-frames:v', '1', '-y', file]);
  return file;
}

const near = (a, b, tol = 12) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const photo = (uri, extra = {}) => ({ kind: 'photo', id: `p${Math.random()}`, uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra });
const doc = (layers, extra = {}) => ({ id: 'd', aspectRatio: '1:1', width: 200, height: 200, layers, ...extra });

describe('I9/I10 — kimeneti felbontás', () => {
  it('a kért magasság érvényesül explicit W×H-s doc-on (2×)', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'))], { width: 300, height: 100 }), 200, dir));
    expect([out.w, out.h]).toEqual([600, 200]);
  });
  it('magasság nélkül a doc saját mérete', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'))], { width: 300, height: 100 }), undefined, dir));
    expect([out.w, out.h]).toEqual([300, 100]);
  });
  it('4096 fölött aránytartóan a plafonra áll', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'))], { width: 4000, height: 2000 }), 4000, dir));
    expect([out.w, out.h]).toEqual([4096, 2048]);
  });
});

describe('I15 — filterId preset', () => {
  it('a preset látszik a kimeneten, az intenzitás skáláz', async () => {
    const src = solid('0x808080');
    const none = decode(await renderImageDoc(doc([photo(src)]), 200, dir)).at(100, 100);
    const warmDir = path.join(dir, 'w');
    fs.mkdirSync(warmDir);
    const warm = decode(await renderImageDoc(doc([photo(src, { filterId: 'warm', filterIntensity: 1 })]), 200, warmDir)).at(100, 100);
    expect(warm[0]).toBeGreaterThan(none[0] + 10);
    expect(warm[2]).toBeLessThan(none[2]);
  });
  it('az átlátszó rész átlátszó marad', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('0x808080'), { w: 0.5, h: 0.5, filterId: 'warm' })]), 200, dir));
    expect(out.at(5, 5)[3]).toBe(0);
  });
});

describe('I16 — maszkolt réteg blend módja', () => {
  it('a maszkon belül multiply, kívül az alap', async () => {
    const base = photo(solid('0x808080', 'b.png'));
    const top = photo(solid('0x808080', 't.png'), {
      blendMode: 'multiply',
      mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005 },
    });
    const out = decode(await renderImageDoc(doc([base, top]), 200, dir));
    expect(near(out.at(100, 100), [64, 64, 64])).toBe(true); // 0.5 × 0.5
    expect(near(out.at(5, 5), [128, 128, 128])).toBe(true);
  });
});

describe('I18 — lokális korrekció forgatott rétegen', () => {
  const local = { mask: { shape: 'rectangle', x: 0.25, y: 0.5, w: 0.5, h: 1, feather: 0.005 }, adjust: { brightness: 0.5 } };
  it('elkészül, és a korrekció a VÁSZON bal felén marad 90°-os forgatásnál is', async () => {
    const layer = photo(solid('0x404040'), { rotation: 90, localAdjust: local });
    const out = decode(await renderImageDoc(doc([layer]), 200, dir));
    expect(out.at(40, 100)[0]).toBeGreaterThan(out.at(160, 100)[0] + 20);
  });
  it('vízszintes tükrözésnél is a vászon bal felén', async () => {
    const layer = photo(solid('0x404040'), { flipH: true, localAdjust: local });
    const out = decode(await renderImageDoc(doc([layer]), 200, dir));
    expect(out.at(40, 100)[0]).toBeGreaterThan(out.at(160, 100)[0] + 20);
  });
});

describe('I20 — JPG háttér', () => {
  it('az átlátszó rész fehér, nem fekete', async () => {
    const layer = photo(solid('red'), { w: 0.5, h: 0.5 });
    const out = decode(await renderImageDoc(doc([layer]), 200, dir, { format: 'jpg', quality: 1 }));
    expect(near(out.at(5, 5), [255, 255, 255], 8)).toBe(true);
    expect(out.at(100, 100)[0]).toBeGreaterThan(200);
  });
  it('PNG-ben az alfa megmarad', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { w: 0.5, h: 0.5 })]), 200, dir));
    expect(out.at(5, 5)[3]).toBe(0);
  });
});

describe('átlátszóság a teljes láncon (az eredeti hiba regressziója)', () => {
  it('a piros pontos marad (nincs YUV-kerülő)', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'))]), 200, dir));
    expect(near(out.at(100, 100), [255, 0, 0], 2)).toBe(true);
    expect(out.at(100, 100)[3]).toBe(255);
  });
  it('contain: a margó átlátszó, nem fekete', async () => {
    const wide = solid('red', 'w.png', '200x50');
    const out = decode(await renderImageDoc(doc([photo(wide, { fit: 'contain' })]), 200, dir));
    expect(out.at(100, 100)[3]).toBe(255);
    expect(out.at(100, 10)[3]).toBe(0);
  });
  it('forgatott réteg sarka átlátszó', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { w: 0.5, h: 0.5, rotation: 45 })]), 200, dir));
    expect(out.at(100, 100)[3]).toBe(255);
    expect(out.at(60, 60)[3]).toBe(0);
  });
  it('alakzat és szöveg mellett is átlátszó marad a vászon', async () => {
    const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#00ff00' };
    const text = { kind: 'text', id: 't', text: 'Hello', color: '#ffffff', fontSize: 8, position: { x: 0.5, y: 0.2 } };
    const out = decode(await renderImageDoc(doc([shape, text]), 200, dir));
    expect(near(out.at(100, 100), [0, 255, 0])).toBe(true);
    expect(out.at(5, 190)[3]).toBe(0);
  });
  it('félig átlátszó réteg alfája megmarad', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { opacity: 0.5 })]), 200, dir));
    expect(Math.abs(out.at(100, 100)[3] - 128)).toBeLessThan(4);
  });
  // a helyi (brew) ffmpeg libwebp nélkül épülhet; a Docker-image-ben van
  const hasWebp = execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString().includes('libwebp');
  (hasWebp ? it : it.skip)('WebP-ben is megmarad az alfa', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { w: 0.5, h: 0.5 })]), 200, dir, { format: 'webp', quality: 0.9 }));
    expect(out.at(5, 5)[3]).toBe(0);
  });
  it('blend mód átlátszó alapon is rajzol, és a kívüli rész átlátszó', async () => {
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { w: 0.5, h: 0.5, blendMode: 'screen' })]), 200, dir));
    expect(out.at(100, 100)[0]).toBeGreaterThan(200);
    expect(out.at(5, 5)[3]).toBe(0);
  });
});

describe('I3 — hiányzó réteg', () => {
  it('a hiányzó fotót jelzi, a többi réteg elkészül', async () => {
    const gone = [];
    const out = decode(await renderImageDoc(doc([photo(solid('red'), { id: 'ok' }), photo('/nincs/ilyen.png', { id: 'x', w: 0.2, h: 0.2 })]), 200, dir, { onMissing: (id) => gone.push(id) }));
    expect(gone).toEqual(['x']);
    expect(out.at(100, 100)[0]).toBeGreaterThan(200);
  });
});

describe('I14 — távoli (PSD/PDF) rétegképek', () => {
  const { resolveRemoteMedia } = require('./imagedoc');
  const bytes = (file) => fs.readFileSync(file);

  it('a https réteg letöltődik és bekerül a kimenetbe', async () => {
    const png = bytes(solid('red'));
    const d = doc([photo('https://cdn.example.com/psd/l.png')]);
    const fetchUrl = jest.fn(async () => new Response(png));
    await resolveRemoteMedia(d, dir, { fetchUrl });
    const out = decode(await renderImageDoc(d, 200, dir));
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(out.at(100, 100)[0]).toBeGreaterThan(200);
  });
  it('a saját média-tár URL nem megy hálózatra', async () => {
    const local = solid('red', 'l.png');
    const d = doc([photo('http://localhost:8787/m/x.png')]);
    const fetchUrl = jest.fn();
    await resolveRemoteMedia(d, dir, { fetchUrl, localPath: () => local });
    expect(fetchUrl).not.toHaveBeenCalled();
    expect(d.layers[0].uri).toBe(local);
  });
  it('elérhetetlen URL → a réteg hiányzóként jelentődik, nem dob', async () => {
    const d = doc([photo(solid('red'), { id: 'ok' }), photo('https://x.example/nincs.png', { id: 'r', w: 0.2, h: 0.2 })]);
    await resolveRemoteMedia(d, dir, { fetchUrl: async () => ({ ok: false }) });
    const gone = [];
    await renderImageDoc(d, 200, dir, { onMissing: (id) => gone.push(id) });
    expect(gone).toEqual(['r']);
  });
});
