// 🧩 A server/render/clipChainsLib/ regressziós tesztjei (REFACTOR): a createClipChains homlokzat ugyanazokat a
// kulcsokat adja ugyanabban a sorrendben, a rész-gyárak ugyanazt az rc-t kapják, és a láncok JELENLEGI alakja rögzítve.
const { createClipChains } = require('../clipChains');
const { createGeometryChains } = require('./geometry');

const make = () => {
  const graph = [];
  const ins = [];
  const cc = createClipChains({ W: 100, H: 200, FPS: 30, graph, addInput: (a) => (ins.push(a), 9) });
  return { cc, graph, ins };
};

describe('homlokzat (render/clipChains.js)', () => {
  test('ugyanazok a kulcsok, ugyanabban a sorrendben', () => {
    expect(Object.keys(make().cc)).toEqual([
      'hasTilt', 'hasPersp', 'perspChain', 'hasTransform', 'TILT_PAD', 'tiltChain', 'hasSkew', 'skewPad', 'skewChain',
      'chromaChain', 'polyWExpr', 'staticPoly', 'withMask', 'appearanceChain', 'blurBackgroundChain', 'hasKf',
      'withKeyframeMotion', 'withDepthParallax', 'withTransform',
    ]);
  });
  test('a konstansok: TILT_PAD és a blur-kitöltés lánca a vászon-méretből', () => {
    const { cc } = make();
    expect(cc.TILT_PAD).toBe(1.3);
    expect(cc.blurBackgroundChain).toBe('scale=100:200:force_original_aspect_ratio=increase,crop=100:200,gblur=sigma=28,eq=brightness=-0.06,format=yuv420p,setsar=1');
  });
  test('a geometria-gyár önállóan is ugyanazt adja (W/H az rc-ből)', () => {
    const geo = createGeometryChains({ W: 100, H: 200 });
    expect(geo.perspChain({ transform: { perspectiveX: 0.1 } })).toBe(make().cc.perspChain({ transform: { perspectiveX: 0.1 } }));
  });
});

describe('geometria + megjelenés', () => {
  const c = { transform: { scale: 1, x: 0, y: 0, rotation: 90, skewX: 10, anchorX: 0, anchorY: 0 }, chromaKey: { color: '#0000ff', spill: true }, opacity: 0.5 };
  test('nyírás: pad-margó és perspektíva-sarkok', () => {
    const { cc } = make();
    expect([cc.hasTransform(c), cc.hasSkew(c), cc.skewPad(c)]).toEqual([true, true, 1.176326980708465]);
    expect(cc.skewChain(c)).toBe(
      ",format=yuva444p,pad=trunc(iw*1.1763/2)*2:trunc(ih*1.1763/2)*2:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,perspective=x0='W/2+W*-0.500000':y0='H/2+H*-0.425052':x1='W/2+W*0.350104':y1='H/2+H*-0.425052':x2='W/2+W*-0.350104':y2='H/2+H*0.425052':x3='W/2+W*0.500000':y3='H/2+H*0.425052':sense=destination,format=rgba"
    );
  });
  test('chroma (kék despill) + statikus forgatás + átlátszóság', () => {
    const { cc } = make();
    expect(cc.appearanceChain(c, 1)).toBe(
      ',chromakey=color=0x0000ff:similarity=0.180:blend=0.050,despill=type=blue:mix=0.50:expand=0.20,format=rgba,rotate=1.57080:ow=rotw(1.57080):oh=roth(1.57080):c=black@0,colorchannelmixer=aa=0.500'
    );
  });
  test('hasKf: a forgatás/átlátszóság kulcskocka is számít; üres csatorna nem', () => {
    const { cc } = make();
    expect([cc.hasKf({ keyframes: { opacity: [{ time: 0, value: 1 }] } }), cc.hasKf({ keyframes: {} }), cc.hasKf({})]).toEqual([true, false, false]);
  });
});

describe('maszk + transzform (graph-sorok)', () => {
  test('statikus ellipszis-maszk loop-olt kockán; maszk nélkül a bemeneti címke; egyedi anchor-pivot eltolás', () => {
    const { cc, graph } = make();
    const c = { transform: { scale: 1, x: 0, y: 0, rotation: 90, anchorX: 0, anchorY: 0 } };
    expect([
      cc.withMask(1, 'fg', { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.4, h: 0.2 }, 1),
      cc.withMask(2, 'fg', null, 1),
      cc.withTransform(3, 's', c, 1, '', undefined),
    ]).toEqual(['mfg1', 'fg', 'seg3']);
    expect(graph).toEqual([
      "color=white:s=100x200:r=30:d=0.0667,format=gray,geq=lum='255*min(max((1.000-sqrt(pow((X-50.0)/(20.0),2)+pow((Y-100.0)/(20.0),2)))/0.050,0),1)',loop=loop=32:size=1:start=0[mimg1]",
      '[fg]split[mf1][mfa1]',
      '[mfa1]alphaextract[mae1]',
      '[mae1][mimg1]blend=all_mode=multiply:shortest=1[mab1]',
      '[mf1][mab1]alphamerge[mfg1]',
      'color=black:s=100x200:r=30:d=1.000,format=yuv420p,setsar=1[tbase3]',
      '[tbase3][s]overlay=x=(100-w)/2+-150:y=(200-h)/2+-50:shortest=0[seg3]',
    ]);
  });
  test('kulcskocka-mozgás: a pad-méret a dőlés- és nyírás-margóval nő (a geometria-gyárból)', () => {
    const { cc, graph } = make();
    cc.withKeyframeMotion(4, 'fit', { transform: { scale: 1, x: 0, y: 0 }, keyframes: {} }, { skip: 0 }, '', 'base', 1);
    cc.withKeyframeMotion(5, 'fit', { transform: { scale: 1, x: 0, y: 0, skewX: 10 }, tilt3d: { rotX: 5 }, keyframes: {} }, { skip: 0 }, '', 'base', 1);
    expect(graph[0]).toContain(',pad=102:202:');
    expect(graph[2]).toContain(',pad=156:308:');
  });
  test('2.5D parallax: hiányzó rétegek → false, nincs graph-sor', () => {
    const { cc, graph } = make();
    expect(cc.withDepthParallax(5, { depthParallax: { id: 'nincs-ilyen' }, duration: 1 }, { skip: 0, duration: 1 }, '', 'L')).toBe(false);
    expect(graph).toEqual([]);
  });
});
