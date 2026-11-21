// 🎨 A server/render/videoFiltersLib/ regressziós tesztjei (REFACTOR): a videoFilters.js homlokzat ugyanazokat a
// függvény-objektumokat adja ugyanabban a sorrendben, és a szűrő-stringek JELENLEGI alakja (bájtra) rögzítve.
const VF = require('../videoFilters');
const { localPathOnly } = require('./localPath');
const color = require('./colorChains');
const region = require('./regionChains');
const time = require('./timeChains');

describe('homlokzat (render/videoFilters.js)', () => {
  test('ugyanazok a kulcsok, ugyanabban a sorrendben', () => {
    expect(Object.keys(VF)).toEqual([
      'localPathOnly', 'FILTERS', 'adjustChain', 'gradeChain', 'LIGHTING', 'lightingChain', 'selectiveChain',
      'motionChain', 'stabilizeChain', 'faceBlurChain', 'matteChain', 'edgeChain', 'filterDrawbox', 'fadeFilters',
    ]);
  });
  test('a homlokzat a lib-modulok VALÓDI objektumait adja tovább (nincs másolat/burkoló)', () => {
    expect(VF.localPathOnly).toBe(localPathOnly);
    for (const k of ['FILTERS', 'adjustChain', 'gradeChain', 'LIGHTING', 'lightingChain', 'filterDrawbox']) expect(VF[k]).toBe(color[k]);
    for (const k of ['selectiveChain', 'faceBlurChain', 'matteChain', 'edgeChain']) expect(VF[k]).toBe(region[k]);
    for (const k of ['motionChain', 'stabilizeChain', 'fadeFilters']) expect(VF[k]).toBe(time[k]);
  });
});

describe('localPathOnly — mélységi SSRF-védelem', () => {
  test.each([
    ['/tmp/a.cube', '/tmp/a.cube'],
    ['rel/l.cube', 'rel/l.cube'],
    ['http://169.254.169.254/x', null],
    ['file:///etc/passwd', null],
    ['pipe:0', null],
    ['concat:a|b', null],
    ['C:\\x.cube', null],
    ['', null],
    [undefined, null],
  ])('%p → %p', (input, expected) => {
    expect(localPathOnly(input)).toBe(expected);
  });
});

describe('szín-láncok', () => {
  const clip = { adjust: { brightness: 0.1, contrast: 0.2, exposure: 0.5, highlights: 0.4, temperature: 0.1, tint: 0.1, lut: { uri: "/tmp/it's.cube" }, vignette: 0.5 }, grade: 'noir' };
  test('adjustChain: sorrend, pontosság, LUT-idézés', () => {
    expect(VF.adjustChain(clip)).toBe(
      ",exposure=exposure=0.500,eq=brightness=0.100:contrast=1.200:saturation=1.000,curves=all='0.000/0.000 0.250/0.250 0.500/0.500 0.750/0.810 1.000/1.000',colortemperature=temperature=5500,colorchannelmixer=gg=0.900,lut3d='/tmp/it'\\''s.cube',vignette=angle=0.3927"
    );
  });
  test('gradeChain: előbb a preset, majd a kézi adjust — mind enable-ablakkal', () => {
    const en = ":enable='between(t,1,2)'";
    expect(VF.gradeChain(clip, 'between(t,1,2)')).toBe(
      `,eq=brightness=-0.02:contrast=1.25:saturation=0${en},vignette=angle=0.8${en},exposure=exposure=0.500${en},eq=brightness=0.100:contrast=1.200:saturation=1.000${en},curves=all='0.000/0.000 0.250/0.250 0.500/0.500 0.750/0.810 1.000/1.000'${en},colortemperature=temperature=5500${en},colorchannelmixer=gg=0.900${en},lut3d='/tmp/it'\\''s.cube'${en},vignette=angle=0.3927${en}`
    );
  });
  test('séma-előtagos LUT kimarad', () => {
    expect(VF.adjustChain({ adjust: { lut: { uri: 'http://x/l.cube' } } })).toBe('');
  });
  test('drawbox-tint, világítás', () => {
    expect(VF.filterDrawbox({ filterId: 'warm', filterIntensity: 0.5 }, 1080, 1920)).toBe(',drawbox=x=0:y=0:w=1080:h=1920:color=0xff9d4d@0.090:t=fill');
    expect(VF.lightingChain({ lighting: 'studio' })).toBe(',eq=brightness=0.04:contrast=1.06:saturation=1.04,colorbalance=rm=0.02:bm=0.02');
  });
});

describe('idő-láncok', () => {
  test('motionChain: gyorsítás tmix, lassítás flow a 12 mp-es határig, utána sima fps', () => {
    expect([
      VF.motionChain({ speed: 2, motionBlur: 0.5 }, 3),
      VF.motionChain({ speed: 0.5, timeInterp: 'flow' }, 12),
      VF.motionChain({ speed: 0.5, timeInterp: 'flow' }, 12.5),
      VF.motionChain({ speed: 1 }, 3),
    ]).toEqual(['tmix=frames=3,fps=30,', 'minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,', 'fps=30,', 'fps=30,']);
  });
  test('stabilizeChain (rolling shutter + crop) és fadeFilters (a látható hosszra vágva)', () => {
    expect(VF.stabilizeChain({ stabilize: { automatic: true, strength: 1, smoothness: 0, crop: 0.5, rollingShutter: true } })).toBe(
      'deshake=rx=64:ry=64:edge=2:blocksize=8,crop=trunc(iw*0.925/2)*2:trunc(ih*0.925/2)*2,'
    );
    expect(VF.fadeFilters({ fadeInSec: 1, fadeOutSec: 5 }, 2)).toBe(',fade=t=in:st=0:d=1.000,fade=t=out:st=0.000:d=2.000');
  });
});

describe('régió-láncok (graph-sorok + bemenetek)', () => {
  test('matte (alpha, invert), séma-előtagos matte kimarad, chroma-él, pixelált arc-elmosás', () => {
    const g = [];
    const ins = [];
    const add = (a) => (ins.push(a), 7);
    const out = [
      VF.matteChain({ matte: { uri: '/m.png', type: 'alpha', invert: true } }, 100, 50, 'L', 3, g, add, 2),
      VF.matteChain({ matte: { uri: 'file:///m.png' } }, 100, 50, 'L', 4, g, add, 2),
      VF.edgeChain({ chromaKey: { edge: -0.5 } }, 'E', 5, g),
      VF.faceBlurChain({ faceBlur: { x: 0.5, y: 0.5, w: 0.2, h: 0.2, pixelate: true } }, 100, 100, 'F', 'FO', 6, g),
    ];
    expect(out).toEqual(['mtm3', 'L', 'egm5', true]);
    expect(g).toEqual([
      '[7:v]scale=100:50,format=rgba,alphaextract,negate[mta3]',
      '[L]split[mtf3][mtfa3]',
      '[mtfa3]alphaextract[mtae3]',
      '[mtae3][mta3]blend=all_mode=multiply:shortest=1[mtab3]',
      '[mtf3][mtab3]alphamerge[mtm3]',
      '[E]split[egf5][egfa5]',
      '[egfa5]alphaextract,erosion,erosion[ega5]',
      '[egf5][ega5]alphamerge[egm5]',
      '[F]split[fbA6][fbB6]',
      "[fbB6]crop=w=20:h=20:x='40':y='40',scale=14:14,scale=20:20:flags=neighbor[fbC6]",
      "[fbA6][fbC6]overlay=x='40':y='40'[FO]",
    ]);
    expect(ins).toEqual([['-loop', '1', '-t', '2.000', '-i', '/m.png']]);
  });
  test('selectiveChain: hiányzó maszk-fájl vagy üres adjust → false, a graph érintetlen', () => {
    const g = [];
    expect(VF.selectiveChain({ selective: { id: 'nincs-ilyen-maszk' }, adjust: { brightness: 0.2 } }, 10, 10, 'a', 'b', 1, g, () => 0, 1)).toBe(false);
    expect(VF.selectiveChain({ selective: { id: 'x' } }, 10, 10, 'a', 'b', 1, g, () => 0, 1)).toBe(false);
    expect(g).toEqual([]);
  });
});
