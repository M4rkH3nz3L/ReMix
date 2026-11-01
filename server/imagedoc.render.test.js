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

describe('alakzat-kompozit (SVG-összevetésből kiderült hibák)', () => {
  const rect = (extra = {}) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fill: '#ff0000', ...extra });
  it('az 50%-os alakzat 50%, nem 25%', async () => {
    const out = decode(await renderImageDoc(doc([rect({ opacity: 0.5 })]), 200, dir));
    expect(Math.abs(out.at(100, 100)[3] - 128)).toBeLessThan(4);
  });
  it('a csoport-opacitás egyszer szorzódik', async () => {
    const out = decode(await renderImageDoc(doc([rect({ opacity: 0.5, groupId: 'g' })], { groups: [{ id: 'g', opacity: 0.5 }] }), 200, dir));
    expect(Math.abs(out.at(100, 100)[3] - 64)).toBeLessThan(4);
  });
  it('a zárt path kontúrjának külső fele is megvan', async () => {
    const path_ = rect({ shape: 'path', closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], borderColor: '#0000ff', borderWidth: 5 });
    const out = decode(await renderImageDoc(doc([path_]), 200, dir));
    expect(near(out.at(37, 100), [0, 0, 255])).toBe(true);
    expect(out.at(37, 100)[3]).toBeGreaterThan(200);
  });
});

describe('I29 — PSD: a rétegek valódi tartalommal', () => {
  const { buildPsdFromImageDoc } = require('./psdExport');
  const agPsd = require('ag-psd');
  const rasterize = (d) => async (layer) => {
    const sub = fs.mkdtempSync(path.join(dir, 'l-'));
    const one = { ...layer, opacity: 1, blendMode: undefined, hidden: false, groupId: undefined };
    return fs.readFileSync(await renderImageDoc({ ...d, layers: [one], groups: [] }, d.height, sub));
  };
  it('a szöveg, a JPEG-fotó és a forgatott alakzat is bekerül, a helyén', async () => {
    const jpg = path.join(dir, 'p.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', '-y', jpg]);
    const d = doc([
      photo(jpg, { id: 'ph', name: 'Fotó', w: 0.5, h: 0.5, position: { x: 0.25, y: 0.25 }, opacity: 0.8 }),
      { kind: 'text', id: 't', name: 'Felirat', text: 'Hello', color: '#ff0000', fontSize: 20, position: { x: 0.5, y: 0.75 } },
      { kind: 'shape', id: 's', name: 'Doboz', shape: 'rectangle', position: { x: 0.75, y: 0.25 }, w: 0.3, h: 0.3, fill: '#00ff00', rotation: 45 },
    ]);
    const buf = await buildPsdFromImageDoc(d, { fetchLayerPng: async () => null, rasterizeLayerPng: rasterize(d) });
    const psd = agPsd.readPsd(buf, { useImageData: true });
    const byName = Object.fromEntries(psd.children.map((l) => [l.name, l]));
    expect(Object.keys(byName).sort()).toEqual(['Doboz', 'Felirat', 'Fotó']);
    const px = (l, x, y) => [...l.imageData.data.subarray((y * l.imageData.width + x) * 4, (y * l.imageData.width + x) * 4 + 4)];
    expect(px(byName['Fotó'], 50, 50)[2]).toBeGreaterThan(200); // a JPEG pixelei, a helyén
    expect(px(byName['Fotó'], 150, 150)[3]).toBe(0);
    expect(byName['Fotó'].opacity).toBeCloseTo(0.8, 1); // az opacity réteg-szintű, nincs beégetve
    expect(px(byName['Doboz'], 150, 50)[1]).toBeGreaterThan(200);
    expect(px(byName['Doboz'], 150 - 28, 50 - 28)[3]).toBe(0); // 45°: a sarok üres, tehát a forgatás beégett
    const text = byName['Felirat'].imageData;
    let inked = 0;
    for (let i = 3; i < text.data.length; i += 4) if (text.data[i] > 128) inked += 1;
    expect(inked).toBeGreaterThan(200);
  });
});

describe('ellipszis nem négyzetes dobozban', () => {
  it('valódi ellipszis, nem lekerekített téglalap', async () => {
    const e = { kind: 'shape', id: 'e', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.9, h: 0.4, fill: '#ff0000' };
    const out = decode(await renderImageDoc(doc([e]), 200, dir));
    // a doboz sarka közelében (x=20%, y=33%) az ellipszis már üres, a kapszula még festene
    expect(out.at(32, 70)[3]).toBe(0);
    expect(out.at(100, 70)[3]).toBe(255);
  });
});

describe('szöveg körvonala', () => {
  it('valódi betű-kontúr: a sziluett felnagyítása nélkül a betű közepénél is van keret', async () => {
    const text = { kind: 'text', id: 't', text: 'I', position: { x: 0.5, y: 0.5 }, fontSize: 60, color: '#ffffff', fontWeight: '900' };
    const img = decode(await renderImageDoc(doc([{ kind: 'fill', id: 'f', fill: '#000000' }, { ...text, stroke: { color: '#ff0000', width: 0.02 } }]), 200, dir));
    // a betű függőleges közepének sora: fehér mag, két oldalán vörös keret
    let red = 0;
    let white = 0;
    for (let x = 0; x < img.w; x++) {
      const [r, g, b] = img.at(x, Math.round(img.h / 2));
      if (r > 170 && g < 90 && b < 90) red += 1;
      if (r > 200 && g > 200 && b > 200) white += 1;
    }
    expect(white).toBeGreaterThan(5);
    expect(red).toBeGreaterThanOrEqual(4);
  }, 60000);
});
