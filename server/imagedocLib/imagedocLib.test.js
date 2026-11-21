// 🎨 A server/imagedocLib/ modulcsalád regressziós tesztjei (REFACTOR): az imagedoc.js bontása után a vászon-méret,
// a réteg-segédek, a RAW-develop detail-szűrők, az ffmpeg-futtatás, a nagy-doc gát, a távoli média feloldása és a
// kompozit JELENLEGI viselkedését rögzítik (az ffmpeg és a Chromium-generátor mockolva).
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockState = { execs: [], fail: null, caught: [], rendered: [] };

jest.mock('child_process', () => ({
  execFile: (cmd, args, opts, cb) => {
    mockState.execs.push({ cmd, args, opts });
    if (mockState.fail) {
      cb(new Error('exit 1'), '', mockState.fail);
      return;
    }
    cb(null, '', '');
  },
}));
jest.mock('../text-render', () => {
  const mk = (kind) => async (clips, canvas, workDir) => {
    mockState.rendered.push({ kind, clips, canvas });
    return clips.map((clip) => {
      const file = require('path').join(workDir, `${kind}-${clip.id}.png`);
      require('fs').writeFileSync(file, kind);
      return { clip, states: [{ file }] };
    });
  };
  return { renderShapePngs: mk('shape'), renderTextPngs: mk('text') };
});
jest.mock('../lib/caught', () => ({
  logCaught: (tag, err) => mockState.caught.push([tag, String(err && err.message)]),
}));

const imagedoc = require('../imagedoc');
const { canvasSize, evenClamp, docCanvas, MAX_CANVAS } = require('./canvas');
const { rotateChain, filterTintChain, isVisible, fillAsShape, watermarkLayer, textWithStroke } = require('./layers');
const { developDetailFilter, developChain } = require('./develop');
const { run, imageOutputArgs, FFMPEG } = require('./ffmpeg');
const { imageDocGuard, MAX_LAYERS, MAX_TOTAL_POINTS } = require('./guard');
const { resolveRemoteMedia, MAX_REMOTE_BYTES } = require('./remoteMedia');
const { renderImageDoc, BLEND_FF } = require('./renderDoc');

let workDir;
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagedoclib-'));
  mockState.execs = [];
  mockState.fail = null;
  mockState.caught = [];
  mockState.rendered = [];
});
afterEach(() => fs.rmSync(workDir, { recursive: true, force: true }));

describe('homlokzat (server/imagedoc.js)', () => {
  test('a module.exports kulcsai és sorrendje változatlan, a függvények a lib-ből jönnek', () => {
    expect(Object.keys(imagedoc)).toEqual([
      'renderImageDoc',
      'resolveRemoteMedia',
      'docCanvas',
      'canvasSize',
      'imageOutputArgs',
      'imageDocGuard',
      'MAX_LAYERS',
      'MAX_TOTAL_POINTS',
      'developFilterPlan',
      'developChain',
      'isNeutralDevelop',
    ]);
    expect(imagedoc.renderImageDoc).toBe(renderImageDoc);
    expect(imagedoc.resolveRemoteMedia).toBe(resolveRemoteMedia);
    expect(imagedoc.imageDocGuard).toBe(imageDocGuard);
    expect([imagedoc.MAX_LAYERS, imagedoc.MAX_TOTAL_POINTS]).toEqual([400, 200000]);
  });
});

describe('canvas', () => {
  test('az arányból páros méret; a hibás arány-tag 1-re esik', () => {
    expect(canvasSize('9:16', 1281)).toEqual({ w: 722, h: 1282 });
    expect(canvasSize(undefined, 1080)).toEqual({ w: 608, h: 1080 });
    expect(canvasSize('x:2', 100)).toEqual({ w: 50, h: 100 });
  });
  test('evenClamp: [16, 4096] közé zárt páros px', () => {
    expect([evenClamp(0), evenClamp('x'), evenClamp(101), evenClamp(99999)]).toEqual([16, 16, 102, MAX_CANVAS]);
  });
  test('docCanvas: a szabad W×H skáláz a kért magassággal, a plafon aránytartó', () => {
    expect(docCanvas({ width: 1000, height: 500 }, 1000)).toEqual({ w: 2000, h: 1000 });
    expect(docCanvas({ width: 8000, height: 2000 }, 0)).toEqual({ w: 4096, h: 1024 });
    expect(docCanvas({ aspectRatio: '1:1' }, 500)).toEqual({ w: 500, h: 500 });
  });
});

describe('layers', () => {
  test('rotateChain: 0 → üres; különben a teljes befoglalóval forgat', () => {
    expect(rotateChain(0)).toBe('');
    expect(rotateChain(90)).toBe(',rotate=1.57080:c=black@0:ow=rotw(1.57080):oh=roth(1.57080)');
  });
  test('filterTintChain: ismeretlen preset → üres; az intenzitás az átlátszatlanságot szorozza', () => {
    expect(filterTintChain('nincs-ilyen', 1)).toBe('');
    expect(filterTintChain('warm', 0)).toBe(",lutrgb=r='val*1.0000+0.000':g='val*1.0000+0.000':b='val*1.0000+0.000'");
  });
  test('isVisible: rejtett vagy ~0 átlátszatlanság nem rajzolódik', () => {
    expect([isVisible({}), isVisible({ hidden: true }), isVisible({ opacity: 0.001 }), isVisible({ opacity: 0.0011 })]).toEqual([true, false, false, true]);
  });
  test('fillAsShape: vászon-méretű téglalap a fill/gradiens mezőkkel', () => {
    expect(fillAsShape({ id: 'f', fill: '#fff', gradient: 'g', other: 1 })).toEqual({
      kind: 'shape',
      id: 'f',
      shape: 'rectangle',
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fill: '#fff',
      fillGradient: undefined,
      gradient: 'g',
    });
  });
  test('watermarkLayer: a fix free-vízjel szöveg-réteg', () => {
    expect(watermarkLayer()).toMatchObject({ id: 'wm-remix', text: 'Made with ReMix', fontSize: 3.2, opacity: 0.72 });
  });
  test('textWithStroke: 0 szélesség → ugyanaz az objektum; különben a CSS-körvonal a betűmérethez arányos', () => {
    const l = { fontSize: 10, stroke: { width: 0 } };
    expect(textWithStroke(l, { w: 100, h: 200 })).toBe(l);
    const out = textWithStroke({ fontSize: 10, textStyle: { a: 1 }, stroke: { color: '#f00', width: 0.02 } }, { w: 100, h: 200 });
    expect(out.textStyle).toEqual({ a: 1, stroke: { color: '#f00', width: 0.2 } });
  });
});

describe('develop', () => {
  test('a detail-szűrők stringjei (vágott [-1, 1] erővel)', () => {
    expect(developDetailFilter('clarity', 2)).toBe('unsharp=lx=13:ly=13:la=1.50');
    expect(developDetailFilter('texture', -0.5)).toBe('unsharp=lx=5:ly=5:la=-0.60');
    expect(developDetailFilter('dehaze', 0.5)).toBe('eq=contrast=1.300:saturation=1.200');
    expect(developDetailFilter('sharpness', 0.25)).toBe('unsharp=5:5:0.500:5:5:0');
    expect(developDetailFilter('noiseReduction', 'x')).toBe('nlmeans=s=1.00');
    expect(developDetailFilter('chromaticAberration', 0.5)).toBe('rgbashift=rh=6:bh=-6');
    expect(developDetailFilter('lensDistortion', -1)).toBe('lenscorrection=k1=-0.3000:k2=-0.3000');
    expect(developDetailFilter('vignette', 1)).toBe('');
  });
  test('developChain: neutrális → üres; detail a base-lánc után', () => {
    expect(developChain(undefined)).toBe('');
    expect(developChain({ detail: { clarity: 1 } })).toBe(',unsharp=lx=13:ly=13:la=1.50');
  });
});

describe('ffmpeg', () => {
  test('run: siker → resolve; hiba → az stderr utolsó 1500 karaktere', async () => {
    await expect(run(['-y', 'a'])).resolves.toBeUndefined();
    expect(mockState.execs[0]).toEqual({ cmd: FFMPEG, args: ['-y', 'a'], opts: { maxBuffer: 1 << 26 } });
    mockState.fail = 'x'.repeat(10) + 'y'.repeat(1500);
    await expect(run([])).rejects.toThrow(new Error('y'.repeat(1500)));
  });
  test('imageOutputArgs: jpg/webp minőség-skála, ismeretlen → png', () => {
    expect(imageOutputArgs('JPEG', 1)).toEqual({ ext: 'jpg', args: ['-pix_fmt', 'yuv420p', '-q:v', '2'] });
    expect(imageOutputArgs('webp', 0)).toEqual({ ext: 'webp', args: ['-c:v', 'libwebp', '-lossless', '0', '-quality', '0'] });
    expect(imageOutputArgs('gif')).toEqual({ ext: 'png', args: [] });
  });
});

describe('guard', () => {
  test('a réteg- és pont-plafon pontosan a határon enged', () => {
    expect(imageDocGuard({ layers: new Array(MAX_LAYERS).fill({}) })).toBeNull();
    expect(imageDocGuard({ layers: new Array(MAX_LAYERS + 1).fill({}) })).toBe('Túl sok réteg (401 > 400). Egyesíts vagy lapíts rétegeket az exporthoz.');
    const pts = (n) => new Array(n).fill({ x: 0, y: 0 });
    expect(imageDocGuard({ layers: [{ points: pts(MAX_TOTAL_POINTS) }] })).toBeNull();
    expect(imageDocGuard({ layers: [{ mask: { ops: [{ points: pts(MAX_TOTAL_POINTS) }] }, subpaths: [pts(1)] }] })).toBe(
      'Túl összetett vektor-tartalom (200001 pont > 200000). Egyszerűsítsd a path-okat.'
    );
    expect(imageDocGuard(null)).toBeNull();
  });
});

describe('remoteMedia', () => {
  test('a saját média-tár helyi útja nyer; a többi letöltődik, a túl nagy / hibás kimarad', async () => {
    const fetched = [];
    const doc = {
      layers: [
        { uri: 'https://own/m/a.png' },
        { uri: 'https://cdn/x.jpg', mask: { image: 'https://cdn/big' } },
        { uri: 'https://cdn/throw', lut: 'ftp://nem' },
      ],
    };
    await resolveRemoteMedia(doc, workDir, {
      localPath: (u) => (u.includes('/m/') ? '/media/a.png' : null),
      fetchUrl: async (u) => {
        fetched.push(u);
        if (u.includes('throw')) throw new Error('blokkolva');
        return { ok: true, arrayBuffer: async () => (u.includes('big') ? Buffer.alloc(MAX_REMOTE_BYTES + 1) : Buffer.from('ok')) };
      },
    });
    expect(fetched).toEqual(['https://cdn/x.jpg', 'https://cdn/big', 'https://cdn/throw']);
    expect(doc.layers[0].uri).toBe('/media/a.png');
    expect(doc.layers[1].uri).toBe(path.join(workDir, 'remote0.jpg'));
    expect(doc.layers[1].mask.image).toBe('https://cdn/big');
    expect(doc.layers[2]).toEqual({ uri: 'https://cdn/throw', lut: 'ftp://nem' });
    expect(mockState.caught).toEqual([['imagedoc.js:resolveRemoteMedia', 'blokkolva']]);
  });
});

describe('renderDoc', () => {
  test('a keverési módok ffmpeg-nevei (colordodge → dodge, colorburn → burn)', () => {
    expect(BLEND_FF.colordodge).toBe('dodge');
    expect(BLEND_FF.colorburn).toBe('burn');
    expect(BLEND_FF.normal).toBeUndefined();
  });
  test('látható réteg nélkül beszédes hiba, ffmpeg-hívás nélkül', async () => {
    await expect(renderImageDoc({ layers: [{ id: 'a', kind: 'shape', hidden: true }] }, 720, workDir)).rejects.toThrow('A dokumentumnak nincs látható rétege.');
    expect(mockState.execs).toEqual([]);
  });
  test('a vízjel a legfelső szöveg-réteg; a blend-mód gbrp-ben keveredik; JPG fehér alapra lapul', async () => {
    const out = await renderImageDoc(
      { aspectRatio: '1:1', layers: [{ id: 's', kind: 'shape', blendMode: 'screen' }] },
      100,
      workDir,
      { watermark: true, format: 'jpg' }
    );
    expect(out).toBe(path.join(workDir, 'imagedoc.jpg'));
    expect(mockState.rendered.map((r) => [r.kind, r.clips.map((c) => c.id)])).toEqual([
      ['shape', ['s']],
      ['text', ['wm-remix']],
    ]);
    const args = mockState.execs[0].args;
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[bbf2][Lbf2]blend=all_mode=screen:shortest=1[bl2]');
    expect(graph).toContain('color=white:s=100x100[jbg]');
    expect(args.slice(-2)).toEqual(['-y', out]);
  });
});
