// 🖊️ A forma körvonalának igazítása (IMAGE-PROD S18) — a kliens `src/lib/shapeStroke.ts` SZÓ SZERINTI
// tükre (contract-teszt: src/lib/shapeStroke.contract.test.ts). Belül: az alakra vágva, dupla szélesség;
// középen: a kontúron; kívül: maszkkal a formán kívül, dupla szélesség.
const { polygonFor } = require('./shapeGeometry');

function borderAlignOf(v) {
  return v === 'inside' || v === 'center' || v === 'outside' ? v : null;
}

function strokeSpec(align, width) {
  if (align === 'center') {
    return { width, pad: width / 2, clip: false, mask: false };
  }
  if (align === 'inside') {
    return { width: width * 2, pad: 0, clip: true, mask: false };
  }
  return { width: width * 2, pad: width, clip: false, mask: true };
}

function strokeJoinOf(shape) {
  return shape.strokeJoin || (shape.shape === 'rectangle' || shape.shape === 'ellipse' ? 'miter' : 'round');
}

const f = (n) => n.toFixed(2);

/** a kliens draw.ts `pathData`-jának tükre (zárt gyűrű) */
function ringD(points, w, h) {
  const P = (p) => `${(p.x * w).toFixed(2)},${(p.y * h).toFixed(2)}`;
  const n = points.length;
  let d = `M${P(points[0])}`;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    d += a.h2 || b.h1 ? `C${P(a.h2 || a)} ${P(b.h1 || b)} ${P(b)}` : `L${P(b)}`;
  }
  return `${d}Z`;
}

function shapeOutlineD(s, w, h) {
  const poly = polygonFor(s);
  if (poly) {
    return `${poly.map(([px, py], i) => `${i ? 'L' : 'M'}${f((px / 100) * w)},${f((py / 100) * h)}`).join('')}Z`;
  }
  if (s.shape === 'ellipse') {
    return `M0,${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(w)},${f(h / 2)}A${f(w / 2)},${f(h / 2)} 0 1 0 0,${f(h / 2)}Z`;
  }
  if (s.shape === 'rectangle') {
    const r = Math.max(0, Math.min(0.5, s.cornerRadius || 0)) * Math.min(w, h);
    if (r <= 0) {
      return `M0,0H${f(w)}V${f(h)}H0Z`;
    }
    const a = `A${f(r)},${f(r)} 0 0 1`;
    return `M${f(r)},0H${f(w - r)}${a} ${f(w)},${f(r)}V${f(h - r)}${a} ${f(w - r)},${f(h)}H${f(r)}${a} 0,${f(h - r)}V${f(r)}${a} ${f(r)},0Z`;
  }
  if (s.shape === 'path') {
    if (Array.isArray(s.subpaths) && s.subpaths.length) {
      return s.subpaths.map((sp) => ringD(sp, w, h)).join(' ');
    }
    if (s.closed && Array.isArray(s.points) && s.points.length >= 3) {
      return ringD(s.points, w, h);
    }
  }
  return null;
}

/** a körvonal SVG-rétege (a forma dobozára igazítva, túlnyúlhat), vagy üres */
function shapeBorderSvg(s, w, h, borderPx, align, id) {
  const d = shapeOutlineD(s, w, h);
  if (!d || !(borderPx > 0)) {
    return '';
  }
  const spec = strokeSpec(align, borderPx);
  const P = Math.ceil(spec.pad) + 2;
  const dash = s.strokeDash && s.strokeDash > 0 ? ` stroke-dasharray="${f(s.strokeDash * borderPx * 2)} ${f(s.strokeDash * borderPx * 2)}"` : '';
  const defs = spec.clip
    ? `<clipPath id="bc${id}"><path d="${d}"/></clipPath>`
    : spec.mask
      ? `<mask id="bm${id}" maskUnits="userSpaceOnUse" x="${-P}" y="${-P}" width="${w + 2 * P}" height="${h + 2 * P}"><rect x="${-P}" y="${-P}" width="${w + 2 * P}" height="${h + 2 * P}" fill="white"/><path d="${d}" fill="black"/></mask>`
      : '';
  const ref = spec.clip ? ` clip-path="url(#bc${id})"` : spec.mask ? ` mask="url(#bm${id})"` : '';
  return (
    `<svg width="${w + 2 * P}" height="${h + 2 * P}" viewBox="${-P} ${-P} ${w + 2 * P} ${h + 2 * P}" ` +
    `style="position:absolute;left:${-P}px;top:${-P}px;overflow:visible;pointer-events:none">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    `<path d="${d}" fill="none" stroke="${s.borderColor || '#ffffff'}" stroke-width="${f(spec.width)}" stroke-linejoin="${strokeJoinOf(s)}"${dash}${ref}/>` +
    `</svg>`
  );
}

module.exports = { borderAlignOf, strokeSpec, strokeJoinOf, shapeOutlineD, shapeBorderSvg };
