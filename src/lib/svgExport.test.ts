import type { ImageDoc, ImageLayer } from '@/types/project';
import { imageDocToSvg } from './svgExport';
import { parseSvg } from './svgImport';

function doc(layers: ImageLayer[], over: Partial<ImageDoc> = {}): ImageDoc {
  return { id: 'd', name: 'T', aspectRatio: '1:1', width: 720, height: 720, layers, ...over } as ImageDoc;
}
const L = (o: Record<string, unknown>) => o as unknown as ImageLayer;

describe('svgExport.imageDocToSvg', () => {
  test('érvényes SVG-gyökér + viewBox a megadott méretből', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'fill', id: 'f', fill: '#112233' })]));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 720 720"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  test('aspectRatio → méret, ha nincs explicit width/height', () => {
    const wide = imageDocToSvg({ id: 'd', name: 'T', aspectRatio: '16:9', layers: [] } as ImageDoc);
    expect(wide).toContain('viewBox="0 0 1920 1080"');
    const tall = imageDocToSvg({ id: 'd', name: 'T', aspectRatio: '9:16', layers: [] } as ImageDoc);
    expect(tall).toContain('viewBox="0 0 1080 1920"');
  });

  test('fill → teljes vászon rect a színnel', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'fill', id: 'f', fill: '#abcdef' })]));
    expect(svg).toContain('<rect x="0" y="0" width="720" height="720" fill="#abcdef"/>');
  });

  test('fotó → <image href> cover=slice / contain=meet', () => {
    const cover = imageDocToSvg(doc([L({ kind: 'photo', id: 'p', uri: 'file://a.jpg', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' })]));
    expect(cover).toContain('<image href="file://a.jpg"');
    expect(cover).toContain('preserveAspectRatio="xMidYMid slice"');
    const contain = imageDocToSvg(doc([L({ kind: 'photo', id: 'p', uri: 'x', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fit: 'contain' })]));
    expect(contain).toContain('preserveAspectRatio="xMidYMid meet"');
    // 0.5-ös doboz középen: left = 720*0.5 - 360/2 = 180
    expect(contain).toContain('x="180"');
  });

  test('téglalap center+w/h → helyes abszolút doboz', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000' })]));
    // 0.5 doboz középen → x=180 y=180 360×360
    expect(svg).toContain('<rect x="180" y="180" width="360" height="360"');
  });

  test('ellipszis → <ellipse cx cy rx ry>', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#0f0' })]));
    expect(svg).toContain('<ellipse cx="360" cy="360" rx="180" ry="180"');
  });

  test('lineáris gradient → <linearGradient> def + url-hivatkozás', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, fill: '#000', gradient: { type: 'linear', angle: 135, stops: [{ color: '#ff2d95', at: 0 }, { color: '#00e5ff', at: 1 }] } })]));
    expect(svg).toContain('<defs>');
    expect(svg).toContain('<linearGradient id="g0"');
    expect(svg).toContain('stop-color="#ff2d95"');
    expect(svg).toContain('stop-color="#00e5ff"');
    expect(svg).toContain('fill="url(#g0)"');
  });

  test('radiális gradient → <radialGradient>', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fill: '#000', gradient: { type: 'radial', stops: [{ color: '#fff', at: 0 }, { color: '#000', at: 1 }] } })]));
    expect(svg).toContain('<radialGradient id="g0"');
  });

  test('konikus gradient → nincs natív SVG → első stop színe (nincs def)', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#000', gradient: { type: 'conic', stops: [{ color: '#abc123', at: 0 }, { color: '#000', at: 1 }] } })]));
    expect(svg).not.toContain('conicGradient');
    expect(svg).toContain('fill="#abc123"');
  });

  test('pattern → <pattern> def userSpaceOnUse', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#000', pattern: { preset: 'dots', fg: '#00e5ff', bg: '#101018', size: 14 } })]));
    expect(svg).toContain('<pattern id="g0" patternUnits="userSpaceOnUse"');
    expect(svg).toContain('<circle');
    expect(svg).toContain('fill="url(#g0)"');
  });

  test('stroke (border) → stroke + stroke-width (vb.h %)', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'star', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ffd166', borderColor: '#ffffff', borderWidth: 2 })]));
    expect(svg).toContain('<polygon points="');
    expect(svg).toContain('stroke="#ffffff"');
    expect(svg).toContain('stroke-width="14.4"'); // 2/100*720
  });

  test('path (toll, points) zárt → kitöltött <path d>', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'path', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#8ef6c4', closed: true, points: [{ x: 0.5, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }] })]));
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+/);
    expect(svg).toContain('fill="#8ef6c4"');
    expect(svg).toContain('Z'); // zárt
  });

  test('path nyitott → stroke-vonal (fill=none)', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'path', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#fff', closed: false, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] })]));
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#fff"');
  });

  test('boolean (subpaths + fillRule) → <path fill-rule="evenodd">', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'path', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#ff6b6b', fillRule: 'evenodd', subpaths: [[{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }], [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }]] })]));
    expect(svg).toContain('fill-rule="evenodd"');
    // két al-path → két M
    expect((svg.match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('glow/árnyék → <filter> feDropShadow', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#00e5ff', glow: { color: '#00e5ff', size: 8 }, shadow: true })]));
    expect(svg).toContain('<filter id="fx0"');
    expect((svg.match(/feDropShadow/g) || []).length).toBe(2); // glow + shadow
    expect(svg).toContain('filter="url(#fx0)"');
  });

  test('szöveg → <text> escaped tartalommal, középre', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'text', id: 't', text: 'A & B <C>', color: '#fff', fontSize: 10, fontWeight: 'bold', position: { x: 0.5, y: 0.5 } })]));
    expect(svg).toContain('<text x="360" y="360"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('A &amp; B &lt;C&gt;');
  });

  test('opacity + blend-mód → <g opacity / mix-blend-mode>', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'shape', id: 's', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#7c5cff', opacity: 0.6, blendMode: 'screen' })]));
    expect(svg).toContain('opacity="0.6"');
    expect(svg).toContain('mix-blend-mode:screen');
  });

  test('forgatás + tükrözés → transform (rotate + scale a középpont körül)', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'photo', id: 'p', uri: 'x', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, rotation: 30, flipH: true })]));
    expect(svg).toContain('transform="translate(360 360) rotate(30) scale(-1 1) translate(-360 -360)"');
  });

  test('a láthatatlan réteg kimarad', () => {
    const svg = imageDocToSvg(doc([L({ kind: 'fill', id: 'f', fill: '#000', visible: false }), L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#f00' })]));
    expect(svg).not.toContain('#000');
    expect(svg).toContain('#f00');
  });

  test('determinisztikus (kétszeri emit ugyanaz)', () => {
    const d = doc([
      L({ kind: 'fill', id: 'f', fill: '#101018' }),
      L({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#000', gradient: { type: 'linear', angle: 45, stops: [{ color: '#f00', at: 0 }, { color: '#00f', at: 1 }] } }),
    ]);
    expect(imageDocToSvg(d)).toBe(imageDocToSvg(d));
  });

  test('round-trip: a kimenet visszaolvasható az svgImport-tal (nem dob, rétegeket ad)', () => {
    const d = doc([
      L({ kind: 'fill', id: 'f', fill: '#223055' }),
      L({ kind: 'shape', id: 'r', shape: 'rectangle', position: { x: 0.4, y: 0.4 }, w: 0.3, h: 0.3, fill: '#ff2d95' }),
      L({ kind: 'shape', id: 'e', shape: 'ellipse', position: { x: 0.6, y: 0.6 }, w: 0.3, h: 0.3, fill: '#00e5ff' }),
      L({ kind: 'shape', id: 'p', shape: 'path', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#8ef6c4', closed: true, points: [{ x: 0.5, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] }),
    ]);
    const svg = imageDocToSvg(d);
    const back = parseSvg(svg);
    expect(back.layers.length).toBeGreaterThanOrEqual(3);
    expect(back.width).toBe(720);
    expect(back.layers.some((l) => l.kind === 'shape')).toBe(true);
  });
});
