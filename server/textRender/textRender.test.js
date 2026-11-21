// 🖼️ A server/textRender/ modulcsalád regressziós tesztjei (REFACTOR): a text-render.js bontása után a
// tiszta CSS/HTML/állapot-építők és a Chromium-vezérlés JELENLEGI viselkedését rögzítik (a böngésző mockolva).
const fs = require('fs');
const path = require('path');

jest.mock('playwright-core', () => {
  const calls = [];
  const opts = { shotFail: false, bbox: { width: 100.2, height: 40.1 } };
  const page = {
    setContent: jest.fn(async (html) => calls.push(['setContent', html])),
    evaluate: jest.fn(async (fn, arg) => calls.push(['evaluate', arg])),
    locator: jest.fn((sel) => ({
      boundingBox: jest.fn(async () => opts.bbox),
      screenshot: jest.fn(async (o) => {
        calls.push(['screenshot', sel, o]);
        if (opts.shotFail) throw new Error('shot');
      }),
    })),
  };
  const browser = { newPage: jest.fn(async (o) => (calls.push(['newPage', o]), page)), close: jest.fn(async () => calls.push(['close'])) };
  return { __calls: calls, __opts: opts, chromium: { launch: jest.fn(async (o) => (calls.push(['launch', o]), browser)) } };
});

const pw = require('playwright-core');
const root = require('../text-render');
const { findChromium } = require('./chromium');
const { customFace, fontFaceCss, fontFamilyCss } = require('./fontFaces');
const { typographyCss, textStyleCss, presetCss, textTransformCss } = require('./textCss');
const { typewriterStates, karaokeStates, emphasisState, statesFor } = require('./textStates');
const { text3dHtml, textPathHtml, escapeHtmlLite } = require('./textHtml');
const { renderTextPngs, bakeTextPng } = require('./renderText');
const { pathDataJs, cssGradient, svgGradientDef } = require('./shapeSvg');
const { patternTileJs, shapePatternSvgDefJs, isRenderableShapePatternJs } = require('./shapePattern');
const { renderShapePngs } = require('./renderShape');

const words25 = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');

const savedChromium = process.env.CHROMIUM_PATH;
afterAll(() => {
  if (savedChromium === undefined) delete process.env.CHROMIUM_PATH;
  else process.env.CHROMIUM_PATH = savedChromium;
});

beforeEach(() => {
  pw.__calls.length = 0;
  pw.__opts.shotFail = false;
  process.env.CHROMIUM_PATH = __filename; // létező fájl → a findChromium ezt adja
});

describe('🧩 a text-render.js homlokzat', () => {
  it('ugyanazokat a függvény-példányokat exportálja, ugyanabban a kulcs-sorrendben', () => {
    expect(Object.keys(root)).toEqual([
      '__fontCss', 'textTransformCss', 'renderTextPngs', 'renderShapePngs', 'bakeTextPng', 'pathDataJs', 'findChromium',
      'fontFaceCss', 'fontFamilyCss', 'typographyCss', 'textStyleCss', 'presetCss', 'patternTileJs', 'shapePatternSvgDefJs',
      'isRenderableShapePatternJs',
    ]);
    expect(root.__fontCss).toBe(customFace);
    expect(root.renderTextPngs).toBe(renderTextPngs);
    expect(root.renderShapePngs).toBe(renderShapePngs);
    expect(root.bakeTextPng).toBe(bakeTextPng);
    expect(root.findChromium).toBe(findChromium);
    expect(root.fontFaceCss).toBe(fontFaceCss);
    expect(root.textStyleCss).toBe(textStyleCss);
    expect(root.pathDataJs).toBe(pathDataJs);
    expect(root.shapePatternSvgDefJs).toBe(shapePatternSvgDefJs);
  });
});

describe('🔤 betűk', () => {
  it('a beépített font a server/assets/fonts alól ágyazódik be (a mappa-váltás után is)', () => {
    const b64 = fs.readFileSync(path.join(__dirname, '..', 'assets', 'fonts', 'Anton-Regular.ttf')).toString('base64');
    expect(fontFaceCss('Anton')).toBe(`@font-face{font-family:'Anton';src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block;}`);
    expect(fontFaceCss(undefined)).toContain("font-family:'Inter';font-weight:700;");
  });
  it('a font-family lánc: ismert család, ismeretlen → Inter', () => {
    expect(fontFamilyCss('Anton')).toBe("'Anton', -apple-system, 'Helvetica Neue', Arial, sans-serif");
    expect(fontFamilyCss('Nincs')).toBe("'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif");
  });
  it('a CHROMIUM_PATH-ot adja, ha létezik', () => {
    expect(findChromium()).toBe(__filename);
  });
});

describe('🎨 szöveg-CSS', () => {
  it('tipográfia', () => {
    expect(typographyCss({ letterSpacing: 0.1, lineHeight: 1.5, kerning: false })).toBe('letter-spacing:0.1em;line-height:1.5;font-kerning:none;');
    expect(typographyCss({ letterSpacing: 0, lineHeight: 0 })).toBe('');
  });
  it('textStyle: a gradient kizárja a doboz-hátteret, a glow paddingot ad', () => {
    expect(
      textStyleCss({ textStyle: { gradient: { from: '#f00', to: '#00f' }, stroke: { width: 0.05, color: '#000' }, shadow: { dx: 0.1, color: '#111' }, glow: { size: 0.2, color: '#0ff' }, background: { color: '#222' } } }, 50)
    ).toBe(
      'background-image:linear-gradient(135deg,#f00,#00f);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent;-webkit-text-stroke:2.5px #000;paint-order:stroke fill;text-shadow:5.0px 0.0px 0.0px #111,0 0 5.0px #0ff,0 0 10.0px #0ff;padding:16px;'
    );
    expect(textStyleCss({ textStyle: { background: { color: '#222', radius: 0.1 } } }, 40)).toBe('background-color:#222;padding:4.0px 8.0px;border-radius:4.0px;');
    expect(textStyleCss({}, 40)).toBe('');
  });
  it('stílus-presetek', () => {
    expect(presetCss({ stylePreset: 'bubble' }, 40)).toBe('background: rgba(0,0,0,0.70); border-radius: 16px; padding: 10px 20px;');
    expect(presetCss({ stylePreset: 'outline' }, 40)).toBe('font-weight: 900; -webkit-text-stroke: 3.2px #000; paint-order: stroke fill;');
    expect(presetCss({ stylePreset: 'neon', color: '#fff' }, 40)).toBe('text-shadow: 0 0 18px #fff, 0 0 36px #fff; padding: 36px;');
    expect(presetCss({}, 40)).toBe('text-shadow: 0 1px 4px rgba(0,0,0,0.67);');
  });
  it('forgatás + tükrözés sorrendje', () => {
    expect(textTransformCss({ rotation: '15', flipH: true, flipV: true })).toBe('rotate(15deg) scaleX(-1) scaleY(-1)');
    expect(textTransformCss({ rotation: 0 })).toBe('');
  });
});

describe('⌨️ animációs állapotok', () => {
  it('typewriter: prefixek 60 ms-onként, legfeljebb 20 lépés', () => {
    expect(typewriterStates({ text: 'abc' })).toEqual([
      { content: { mode: 'plain', text: 'a' }, from: 0, to: 0.06 },
      { content: { mode: 'plain', text: 'ab' }, from: 0.06, to: 0.12 },
      { content: { mode: 'plain', text: 'abc' }, from: 0.12, to: null },
    ]);
    expect(typewriterStates({ text: 'x'.repeat(45) })).toHaveLength(20);
    expect(typewriterStates({ text: '' })).toBeNull();
  });
  it('karaoke: egyenletes elosztás, szó-időzítés, kiemelés', () => {
    const eq = karaokeStates({ text: 'egy két három', duration: 3 });
    expect(eq.map((s) => [s.from, s.to])).toEqual([[0, 1], [1, 2], [2, null]]);
    expect(eq[1].content.words.map((w) => w.state)).toEqual(['past', 'active', 'next']);
    expect(eq[0].content.accent).toBe('#7c5cff');
    const timed = karaokeStates({ text: 'a b', duration: 2, wordTimings: [{ t: 0.5 }, { t: 1.25 }], emphasis: [1] });
    expect(timed.map((s) => [s.from, s.to])).toEqual([[0.5, 1.25], [1.25, null]]);
    expect(timed[0].content.words[1].emp).toBe(true);
  });
  it('karaoke: 24 állapot felett csoportosít (25 szó → 13 állapot)', () => {
    const st = karaokeStates({ text: words25, duration: 5 });
    expect(st).toHaveLength(13);
    expect(st[1].from).toBe(0.4);
  });
  it('kiemelés sima feliraton, és a tartalék sima állapot', () => {
    expect(emphasisState({ text: 'a b c', emphasis: [2] })[0].content.words.map((w) => [w.state, w.emp])).toEqual([['past', false], ['past', false], ['past', true]]);
    expect(emphasisState({ text: 'a b', emphasis: [] })).toBeNull();
    expect(statesFor({ text: '  ', animation: 'karaoke' })).toEqual([{ content: { mode: 'plain', text: '  ' }, from: 0, to: null }]);
  });
});

describe('🧊 különleges szöveg-HTML', () => {
  it('3D: ismeretlen anyag → plastic, a döntés ±45°-ra, a mélység 0–1-re vágva', () => {
    const h = text3dHtml({ text: 'x', color: '', text3d: { material: 'wood', depth: 2, tiltX: 90, tiltY: -10 } }, 50, 1000);
    expect(h).toContain('transform: perspective(450px) rotateX(45deg) rotateY(-10deg);');
    expect(h).toContain('7px 7px 0 #1c1c24');
    expect(h).not.toContain('8px 8px 0 #1c1c24');
    expect(h).toContain('max-width:860px');
    expect(h).not.toContain('CURRENT');
  });
  it('görbe menti szöveg: a négy görbe-alak path-ja', () => {
    const d = (shape) => textPathHtml({ text: 'Hello', textPath: { shape, curve: 0.5 } }, 20, 1000).match(/<path id="tp" d="([^"]*)"/)[1];
    expect(d('arc')).toBe('M 0,44 Q 425,24 850,44');
    expect(d('valley')).toBe('M 0,44 Q 425,64 850,44');
    expect(d('wave')).toBe('M 0,44 Q 212.5,24 425,44 T 850,44');
    expect(d('circle')).toBe('M 48,24.0 A 24.0,24.0 0 1,1 47.99,24.0');
  });
  it('HTML-escape (az idézőjel marad)', () => {
    expect(escapeHtmlLite('<a & b>"')).toBe('&lt;a &amp; b&gt;"');
  });
});

describe('✏️ forma-primitívek', () => {
  it('path d: Bézier-szegmens, egyenes, zárás', () => {
    expect(pathDataJs([{ x: 0, y: 0 }, { x: 1, y: 0.5, h1: { x: 0.5, y: 0 } }, { x: 0.5, y: 1 }], 100, 200, true)).toBe('M0.00,0.00C0.00,0.00 50.00,0.00 100.00,100.00L50.00,200.00L0.00,0.00Z');
    expect(pathDataJs([], 1, 1, false)).toBe('');
  });
  it('CSS- és SVG-gradientek', () => {
    expect(cssGradient({ type: 'radial', stops: [{ color: '#f00' }, { color: '#00f', at: 2 }] })).toBe('radial-gradient(circle at center, #f00 0%, #00f 100%)');
    expect(cssGradient({ type: 'conic', angle: 90, stops: [{ color: '#f00', at: 0.5 }] })).toBe('conic-gradient(from 90.0deg at center, #f00 50%)');
    expect(cssGradient({ stops: [] })).toBe('linear-gradient(135.0deg, )');
    expect(svgGradientDef('g1', { type: 'linear', angle: 90, stops: [{ color: '#f00', at: 0 }, { color: '#00f', at: 1 }] })).toBe(
      '<linearGradient id="g1" x1="0.000" y1="0.500" x2="1.000" y2="0.500"><stop offset="0.000" stop-color="#f00"/><stop offset="1.000" stop-color="#00f"/></linearGradient>'
    );
    expect(svgGradientDef('g2', { type: 'radial', stops: [{ color: '#fff', at: -1 }] })).toBe('<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5"><stop offset="0.000" stop-color="#fff"/></radialGradient>');
  });
  it('forma-minta: csempe, pattern-def, renderelhetőség', () => {
    expect(patternTileJs({ preset: 'grid', size: 10, fg: '#000', bg: '#fff' }, 100).prims).toEqual([
      { t: 'line', x1: 0, y1: 0.5, x2: 10, y2: 0.5, stroke: '#000', sw: 1 },
      { t: 'line', x1: 0.5, y1: 0, x2: 0.5, y2: 10, stroke: '#000', sw: 1 },
    ]);
    expect(shapePatternSvgDefJs({ preset: 'checker', size: 10, fg: '#000', bg: '#fff', rotation: 30.12345, opacity: 0.5 }, 'p1', 200, 100)).toBe(
      '<pattern id="p1" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(30.123 100 50)"><g opacity="0.5"><rect x="0" y="0" width="10" height="10" fill="#fff"/><rect x="0" y="0" width="5" height="5" fill="#000"/><rect x="5" y="5" width="5" height="5" fill="#000"/></g></pattern>'
    );
    expect(isRenderableShapePatternJs({ preset: 'dots', size: 1 })).toBe(true);
    expect(isRenderableShapePatternJs({ preset: 'dots', size: 1, opacity: 0 })).toBe(false);
    expect(isRenderableShapePatternJs({ preset: 'x', size: 1 })).toBe(false);
  });
});

describe('🖼️ Chromium-vezérlés (mockolt böngésző)', () => {
  it('szöveg: állapotonként egy PNG text_<klip>_<állapot> névvel, felkerekített mérettel', async () => {
    const res = await renderTextPngs([{ text: 'ab', fontSize: 5, color: '#fff', animation: 'typewriter' }], { w: 100, h: 200 }, '/o');
    expect(res[0].states).toEqual([
      { file: path.join('/o', 'text_0_0.png'), from: 0, to: 0.06, w: 101, h: 41 },
      { file: path.join('/o', 'text_0_1.png'), from: 0.06, to: null, w: 101, h: 41 },
    ]);
    expect(pw.__calls.find((c) => c[0] === 'newPage')[1]).toEqual({ viewport: { width: 100, height: 200 }, deviceScaleFactor: 1 });
    expect(pw.__calls.at(-1)).toEqual(['close']);
  });
  it('forgatott szövegnél a raszter-ablak az átló négyzete', async () => {
    await renderTextPngs([{ text: 'a', fontSize: 5, color: '#fff', rotation: 10 }], { w: 300, h: 400 }, '/o');
    expect(pw.__calls.find((c) => c[0] === 'newPage')[1].viewport).toEqual({ width: 500, height: 500 });
  });
  it('hiba esetén is bezárja a böngészőt; Chromium nélkül érthető hibát dob', async () => {
    pw.__opts.shotFail = true;
    await expect(renderTextPngs([{ text: 'a', fontSize: 5 }], { w: 10, h: 10 }, '/o')).rejects.toThrow('shot');
    expect(pw.__calls.at(-1)).toEqual(['close']);
    process.env.CHROMIUM_PATH = '/nincs/ilyen';
    jest.spyOn(fs, 'readdirSync').mockImplementationOnce(() => []);
    await expect(renderTextPngs([{ text: 'a', fontSize: 5 }], { w: 10, h: 10 }, '/o')).rejects.toThrow('Nincs elérhető Chromium a felirat-rasterizáláshoz (CHROMIUM_PATH?)');
  });
  it('forma: hibás méretre azonnal bukik, különben shape_<i>.png', async () => {
    await expect(renderShapePngs([{ id: 'x', shape: 'rectangle', w: 0, h: 0.2 }], { w: 10, h: 10 }, '/o')).rejects.toThrow(
      'Hibás forma-méret (x): w=0, h=0.2 — a ShapeClip top-level w/h mezőt vár (0–1).'
    );
    const res = await renderShapePngs([{ id: 's', shape: 'rectangle', w: 0.5, h: 0.5, fill: '#f00' }], { w: 100, h: 100 }, '/o');
    expect(res[0].states[0]).toEqual({ file: path.join('/o', 'shape_0.png'), from: 0, to: null, w: 101, h: 41 });
    expect(pw.__calls.find((c) => c[0] === 'screenshot')[1]).toBe('#s');
  });
  it('bake: animáció nélkül süt, és törli az ideiglenes mappát', async () => {
    const rm = jest.spyOn(fs, 'rmSync');
    const real = fs.readFileSync;
    const read = jest.spyOn(fs, 'readFileSync').mockImplementation((p, ...r) => (String(p).endsWith('.png') ? Buffer.from('PNG') : real(p, ...r)));
    const out = await bakeTextPng({ text: 'a b', fontSize: 5, color: '#fff', animation: 'karaoke', duration: 1 }, { w: 50, h: 50 });
    expect(out).toEqual({ pngBase64: Buffer.from('PNG').toString('base64'), w: 101, h: 41 });
    expect(pw.__calls.filter((c) => c[0] === 'screenshot')).toHaveLength(1);
    expect(rm).toHaveBeenCalledWith(expect.stringContaining('txtbake-'), { recursive: true, force: true });
    read.mockRestore();
    rm.mockRestore();
  });
});
