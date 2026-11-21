// 🎨 Kép-dokumentum — réteg-segédek: láthatóság, forgatás/szín-preset lánc, fill → forma, vízjel, szöveg-körvonal.
const { FILTERS } = require('../render');

/** Forgatás a teljes elforgatott befoglalóval (a `rotw`/`roth` argumentuma a SZÖG). */
function rotateChain(deg) {
  if (!deg) {
    return '';
  }
  const rad = ((deg * Math.PI) / 180).toFixed(5);
  return `,rotate=${rad}:c=black@0:ow=rotw(${rad}):oh=roth(${rad})`;
}

/** 🎞️ szín-preset (filterId) mint tónus-tint: az alfát nem érinti, átlátszó részt nem színez. */
function filterTintChain(filterId, intensity) {
  const f = FILTERS[filterId];
  if (!f) {
    return '';
  }
  const op = Math.max(0, Math.min(1, f.opacity * (intensity ?? 1)));
  const channel = (hex) => `val*${(1 - op).toFixed(4)}+${(parseInt(hex, 16) * op).toFixed(3)}`;
  return `,lutrgb=r='${channel(f.color.slice(0, 2))}':g='${channel(f.color.slice(2, 4))}':b='${channel(f.color.slice(4, 6))}'`;
}

/** a réteg rajzolódik-e (a klienssel AZONOS szabály — lásd imageDoc.ts) */
function isVisible(layer) {
  return !layer.hidden && (layer.opacity ?? 1) > 0.001;
}

/**
 * A `fill` réteg úgy megy át a forma-generátoron, mint egy vászon-méretű
 * téglalap — így a gradiens-kezelés is közös, nem kell külön ág.
 */
function fillAsShape(layer) {
  return {
    kind: 'shape',
    id: layer.id,
    shape: 'rectangle',
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fill: layer.fill,
    fillGradient: layer.fillGradient,
    gradient: layer.gradient,
  };
}

/** 🏷️ Kötelező free-vízjel text-rétege (alul-középen, félig-átlátszó). A text-render
 * lánc (Chromium) rendereli, mint bármely text-réteget → a legfelső rétegként komponálódik. */
function watermarkLayer() {
  return {
    kind: 'text',
    id: 'wm-remix',
    text: 'Made with ReMix',
    color: '#ffffff',
    fontSize: 3.2, // a vászon-MAGASSÁG %-a
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.95 },
    opacity: 0.72,
  };
}

/**
 * 🖊️ A szöveg körvonala valódi betű-kontúr (`-webkit-text-stroke`): a felnagyított sziluett a
 * betűk közepén nem adna keretet. A CSS-vonal fele esik kifelé, ezért a kétszerese kell.
 */
function textWithStroke(layer, canvas) {
  const width = Number(layer.stroke?.width) || 0;
  if (width <= 0) {
    return layer;
  }
  const fontPx = ((layer.fontSize ?? 8) / 100) * canvas.h;
  const stroke = { color: layer.stroke.color, width: (2 * width * canvas.w) / fontPx };
  return { ...layer, textStyle: { ...layer.textStyle, stroke } };
}

module.exports = { rotateChain, filterTintChain, isVisible, fillAsShape, watermarkLayer, textWithStroke };
