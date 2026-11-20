import { anchorBounds, bakeMatrix, boxToDoc, ellipsePath, rectPath } from './geometry';
import { collectGradients } from './gradients';
import { readViewBox } from './layers';
import { apply, hasRotation, IDENTITY, mul, parseTransform, type Mat } from './matrix';
import { clamp01, parseLen, resolveStyle, round, urlId } from './style';
import { parseXml } from './xml';

// Az `svgImport` belső moduljai (REFACTOR): a `parseSvg`-n át csak közvetve tesztelt
// segédek viselkedése rögzítve.

const close = (m: Mat, want: number[]) => m.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));

describe('svg/xml — könnyű XML-fa', () => {
  it('az `svg` gyökeret adja, attribútumokkal és entitás-dekódolással', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><svg a="1" b=\'x &lt;&amp;&#65;\'><g id="g"><rect/></g></svg>');
    expect(root?.tag).toBe('svg');
    expect(root?.attrs).toEqual({ a: '1', b: 'x <&A' });
    expect(root?.children[0].tag).toBe('g');
    expect(root?.children[0].children[0].tag).toBe('rect');
  });

  it('svg nélkül az első gyökérelem, üresre null', () => {
    expect(parseXml('<foo/><bar/>')?.tag).toBe('foo');
    expect(parseXml('csak szöveg')).toBeNull();
  });

  it('szöveg: whitespace összevonva, CDATA szó szerint, rosszul zárt elem tolerálva', () => {
    const root = parseXml('<svg><text>  a \n b <![CDATA[<x>]]></text><g><rect></svg>');
    expect(root?.children[0].text).toBe(' a b <x>');
    expect(root?.children[1].children[0].tag).toBe('rect');
  });

  it('a hexa entitás (&#x41;) nincs dekódolva', () => {
    expect(parseXml('<svg t="&#x41;"/>')?.attrs.t).toBe('&#x41;');
  });
});

describe('svg/matrix — affin transzform', () => {
  it('szorzás és alkalmazás', () => {
    const m = mul([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 7]);
    expect(m).toEqual([2, 0, 0, 2, 10, 14]);
    expect(apply(m, 1, 1)).toEqual({ x: 12, y: 16 });
  });

  it('üres transzform → ugyanaz az IDENTITY példány', () => {
    expect(parseTransform(undefined)).toBe(IDENTITY);
    expect(parseTransform('')).toBe(IDENTITY);
  });

  it('a transzform-lista balról jobbra szorzódik', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    expect(parseTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(parseTransform('scale(2, 3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(parseTransform('matrix(1,2,3,4,5,6)')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('hibás matrix-argumentumszám → identitás-lépés', () => {
    expect(parseTransform('matrix(1,2,3)')).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('rotate középpont körül és skew', () => {
    close(parseTransform('rotate(90)'), [0, 1, -1, 0, 0, 0]);
    close(parseTransform('rotate(90 10 0)'), [0, 1, -1, 0, 10, -10]);
    close(parseTransform('skewX(45)'), [1, 0, 1, 1, 0, 0]);
    close(parseTransform('skewY(45)'), [1, 1, 0, 1, 0, 0]);
  });

  it('forgatás-észlelés', () => {
    expect(hasRotation(IDENTITY)).toBe(false);
    expect(hasRotation(parseTransform('rotate(30)'))).toBe(true);
    expect(hasRotation(parseTransform('scale(-1)'))).toBe(false);
  });
});

describe('svg/style — stílus-feloldás', () => {
  const node = (attrs: Record<string, string>) => ({ tag: 'rect', attrs, children: [], text: '' });

  it('az örökölt kulcsok átjönnek, az opacity szorzódik', () => {
    const parent = resolveStyle(node({ fill: 'red', opacity: '0.5', 'stroke-width': '2px' }), {});
    expect(parent).toEqual({ fill: 'red', opacity: 0.5, strokeWidth: 2 });
    const child = resolveStyle(node({ opacity: '0.5' }), parent);
    expect(child).toEqual({ fill: 'red', strokeWidth: 2, opacity: 0.25 });
  });

  it('az inline style felülírja a prezentációs attribútumot', () => {
    const s = resolveStyle(node({ fill: 'red', style: "fill: blue; font-family: 'Inter', Arial; fill-rule:evenodd" }), {});
    expect(s).toEqual({ fill: 'blue', fontFamily: 'Inter', fillRule: 'evenodd' });
  });

  it('ismeretlen fill-rule → nonzero', () => {
    expect(resolveStyle(node({ 'fill-rule': 'x' }), {}).fillRule).toBe('nonzero');
  });

  it('hossz-, szám- és url-segédek', () => {
    expect(parseLen('12px')).toBe(12);
    expect(parseLen('1.5em')).toBe(1.5);
    expect(parseLen('50%')).toBe(50);
    expect(parseLen('abc')).toBe(0);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(round(0.123456)).toBe(0.1235);
    expect(urlId('url(#g1)')).toBe('g1');
    expect(urlId('red')).toBeNull();
    expect(urlId(undefined)).toBeNull();
  });
});

describe('svg/gradients — gradiens-gyűjtés', () => {
  it('lineáris szög, rendezett stopok, %-os offset, egyszintű href-öröklés', () => {
    const root = parseXml(
      '<svg><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="100%" stop-color="#000"/><stop offset="0" style="stop-color:#fff"/></linearGradient>' +
        '<radialGradient id="b" xlink:href="#a"/><linearGradient id="c"><stop offset="0"/></linearGradient></defs></svg>'
    )!;
    expect(collectGradients(root)).toEqual({
      a: { type: 'linear', angle: 90, stops: [{ color: '#fff', at: 0 }, { color: '#000', at: 1 }] },
      b: { type: 'radial', stops: [{ color: '#fff', at: 0 }, { color: '#000', at: 1 }] },
    });
  });

  it('stop-szín hiányában a fill, végül fekete; az offset 0–1-re vágva', () => {
    const root = parseXml('<svg><linearGradient id="g"><stop offset="-1" fill="red"/><stop offset="2"/></linearGradient></svg>')!;
    expect(collectGradients(root).g.stops).toEqual([
      { color: 'red', at: 0 },
      { color: '#000000', at: 1 },
    ]);
  });
});

describe('svg/geometry — geometria-segédek', () => {
  it('téglalap és ellipszis al-path', () => {
    expect(rectPath(1, 2, 3, 4)).toEqual({
      points: [
        { x: 1, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 6 },
        { x: 1, y: 6 },
      ],
      closed: true,
    });
    const e = ellipsePath(0, 0, 10, 5);
    expect(e.closed).toBe(true);
    expect(e.points.map((p) => [p.x, p.y])).toEqual([
      [10, 0],
      [0, 5],
      [-10, 0],
      [0, -5],
    ]);
    expect(e.points[0].h2!.y).toBeCloseTo(5 * 0.5522847498, 9);
  });

  it('identitás-mátrixnál a bakeMatrix ugyanazt a tömböt adja vissza', () => {
    const subs = [rectPath(0, 0, 1, 1)];
    expect(bakeMatrix(subs, IDENTITY)).toBe(subs);
    // egyenértékű, de másik példány → tényleges szorzás
    const baked = bakeMatrix(subs, [2, 0, 0, 2, 1, 1]);
    expect(baked).not.toBe(subs);
    expect(baked[0].points[2]).toEqual({ x: 3, y: 3 });
  });

  it('a mátrix a fogókat is transzformálja', () => {
    const baked = bakeMatrix([ellipsePath(0, 0, 1, 1)], [1, 0, 0, 1, 10, 0]);
    expect(baked[0].points[0].h1!.x).toBe(11);
  });

  it('horgony-doboz (fogók nélkül, min. 1e-4) és doksi-normalizálás', () => {
    expect(anchorBounds([ellipsePath(5, 5, 5, 5)])).toEqual({ minX: 0, minY: 0, w: 10, h: 10 });
    expect(anchorBounds([{ points: [{ x: 1, y: 1 }], closed: false }])).toEqual({ minX: 1, minY: 1, w: 1e-4, h: 1e-4 });
    expect(boxToDoc({ minX: 10, minY: 20, w: 40, h: 30 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({
      center: { x: 0.3, y: 0.35 },
      w: 0.4,
      h: 0.3,
    });
  });
});

describe('svg/layers — viewBox', () => {
  const root = (attrs: Record<string, string>) => ({ tag: 'svg', attrs, children: [], text: '' });

  it('viewBox elsőbbsége, különben width/height, végül 100×100', () => {
    expect(readViewBox(root({ viewBox: '10,20 200 100', width: '5' }))).toEqual({ x: 10, y: 20, w: 200, h: 100 });
    expect(readViewBox(root({ viewBox: '0 0 0 0', width: '300px', height: '150' }))).toEqual({ x: 0, y: 0, w: 300, h: 150 });
    expect(readViewBox(root({}))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
