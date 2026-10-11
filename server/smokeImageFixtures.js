// 🎨 Image-rasterize parity SMOKE — per-funkció ImageDoc-ok (pure, IO-mentes).
//
// Minden fixture egy EGYSZERŰ réteg-fa, ami EGY kép-render-funkciót gyakorol. A
// runner (scripts/imagedoc-smoke.js) ezeket a worker `/imagedoc`-jával PNG-be
// raszterizálja, hogy a kimenetet VIZUÁLISAN össze lehessen vetni a szerkesztő
// előnézetével (Preview == Export). A doc-ok tiszták → a struktúra tesztelhető.

const PHOTO = 'smoke:photo'; // 720×720 teszt-fotó (a runner ffmpeg-gel gyártja)
const W = 720;
const H = 720;

function doc(name, layers, over = {}) {
  return {
    id: `imgsmoke-${name}`,
    name: `IMG ${name}`,
    aspectRatio: '1:1',
    width: W,
    height: H,
    layers,
    ...over,
  };
}

let n = 0;
const id = (p) => `${p}${n++}`;

const fill = (color = '#12121a') => ({ kind: 'fill', id: id('fill'), fill: color });
const photo = (over = {}) => ({
  kind: 'photo', id: id('photo'), uri: PHOTO, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover', ...over,
});
const shape = (shapeKind, over = {}) => ({
  kind: 'shape', id: id('shape'), shape: shapeKind, position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff2d95', ...over,
});
const text = (over = {}) => ({
  kind: 'text', id: id('text'), text: 'PARITY', color: '#ffffff', fontSize: 14, fontWeight: 'bold',
  position: { x: 0.5, y: 0.5 }, ...over,
});

/** A fixture-lista: { name, description, doc }. */
function buildSmokeDocs() {
  n = 0;
  return [
    { name: 'baseline-fill', description: 'Sima háttér-kitöltés (referencia).', doc: doc('baseline', [fill('#223055')]) },
    { name: 'photo', description: 'Fotó-réteg (cover) a háttéren.', doc: doc('photo', [fill(), photo()]) },
    {
      name: 'photo-rotate-flip',
      description: 'Fotó forgatva (30°) + vízszintes tükrözés.',
      doc: doc('photorf', [fill(), photo({ rotation: 30, flipH: true, w: 0.8, h: 0.8 })]),
    },
    {
      name: 'photo-adjust',
      description: 'Fotó korrekció: meleg + deszaturáció (adjust).',
      doc: doc('photoadj', [fill(), photo({ adjust: { temperature: 0.5, saturation: -0.4, contrast: 0.2 } })]),
    },
    {
      name: 'shape-gradient',
      description: 'Téglalap multi-stop lineáris gradienssel (135°).',
      doc: doc('grad', [fill(), shape('rectangle', { gradient: { type: 'linear', angle: 135, stops: [{ color: '#ff2d95', at: 0 }, { color: '#00e5ff', at: 1 }] } })]),
    },
    {
      name: 'shape-glow-shadow',
      description: 'Ellipszis ragyogással (glow) + árnyékkal.',
      doc: doc('glow', [fill(), shape('ellipse', { fill: '#00e5ff', glow: { color: '#00e5ff', size: 8 }, shadow: true })]),
    },
    {
      name: 'shape-stroke',
      description: 'Csillag kontúrral (stroke: szín + vastagság).',
      doc: doc('stroke', [fill(), shape('star', { fill: '#ffd166', borderColor: '#ffffff', borderWidth: 2 })]),
    },
    {
      name: 'shape-pattern',
      description: 'Téglalap geometrikus mintával (pöttyök).',
      doc: doc('pattern', [fill(), shape('rectangle', { pattern: { preset: 'dots', fg: '#00e5ff', bg: '#101018', size: 14 } })]),
    },
    {
      name: 'path-shape',
      description: 'Path-forma (toll): kitöltött háromszög bezier-pontokból.',
      doc: doc('path', [fill(), shape('path', { fill: '#8ef6c4', closed: true, points: [{ x: 0.5, y: 0.08 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.92 }] })]),
    },
    {
      name: 'boolean-evenodd',
      description: 'Boolean eredmény: lyukas forma (subpaths + evenodd).',
      doc: doc('bool', [fill(), {
        kind: 'shape', id: id('bshape'), shape: 'path', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fill: '#ff6b6b',
        fillRule: 'evenodd',
        subpaths: [
          [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }],
          [{ x: 0.38, y: 0.38 }, { x: 0.62, y: 0.38 }, { x: 0.62, y: 0.62 }, { x: 0.38, y: 0.62 }],
        ],
      }]),
    },
    { name: 'text', description: 'Szöveg-réteg (stílus + font).', doc: doc('text', [fill('#101018'), text()]) },
    {
      name: 'transparent-bg',
      description: 'Háttér-fill NÉLKÜL → alfás PNG (fotó átlátszó háttéren).',
      doc: doc('alpha', [photo({ w: 0.6, h: 0.6 })]),
    },
    {
      name: 'multi-layer',
      description: 'Kompozit: háttér + fotó + félig-átlátszó forma + szöveg (blend/opacity).',
      doc: doc('multi', [
        fill('#0b0d14'),
        photo({ w: 0.9, h: 0.9 }),
        shape('ellipse', { fill: '#7c5cff', opacity: 0.6, blendMode: 'screen', w: 0.7, h: 0.7 }),
        text({ text: 'ReMix', fontSize: 16 }),
      ]),
    },
  ];
}

/** A doc-ban hivatkozott SZIMBOLIKUS média-uri-k (a runner ezeket generálja). */
function mediaUrisOf(d) {
  const out = new Set();
  for (const l of d.layers || []) {
    if (l.kind === 'photo' && l.uri) {
      out.add(l.uri);
    }
    if (l.kind === 'shape' && l.imageUri) {
      out.add(l.imageUri);
    }
  }
  return [...out];
}

module.exports = { buildSmokeDocs, mediaUrisOf, SMOKE_IMAGE_MEDIA: { PHOTO }, W, H };
