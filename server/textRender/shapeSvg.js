// ✏️ Forma-primitívek stringként: SVG path `d` a horgonypontokból + CSS/SVG gradient-definíciók.

/** ✏️ SVG path `d` a horgonypontokból (Bézier-tudatos) — a kliens draw.ts tükre. */
function pathDataJs(points, w, h, closed) {
  if (!Array.isArray(points) || points.length === 0) {
    return '';
  }
  const P = (p) => `${(p.x * w).toFixed(2)},${(p.y * h).toFixed(2)}`;
  const n = points.length;
  let d = `M${P(points[0])}`;
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.h2 || b.h1) {
      d += `C${P(a.h2 || a)} ${P(b.h1 || b)} ${P(b)}`;
    } else {
      d += `L${P(b)}`;
    }
  }
  if (closed) {
    d += 'Z';
  }
  return d;
}

/** 🌈 CSS gradient-string a fejlett gradientből (rect/ellipse/path-doboz + konikus). */
function cssGradient(g) {
  const stops = (g.stops || [])
    .map((s) => `${s.color} ${Math.round(Math.min(1, Math.max(0, s.at ?? 0)) * 100)}%`)
    .join(', ');
  if (g.type === 'radial') {
    return `radial-gradient(circle at center, ${stops})`;
  }
  if (g.type === 'conic') {
    return `conic-gradient(from ${(g.angle ?? 0).toFixed(1)}deg at center, ${stops})`;
  }
  return `linear-gradient(${(g.angle ?? 135).toFixed(1)}deg, ${stops})`;
}

/** 🌈 SVG gradient-def (arrow/star polygon lineáris/radiális kitöltéséhez). */
function svgGradientDef(id, g) {
  const stops = (g.stops || [])
    .map(
      (s) =>
        `<stop offset="${Math.min(1, Math.max(0, s.at ?? 0)).toFixed(3)}" stop-color="${s.color}"/>`
    )
    .join('');
  if (g.type === 'radial') {
    return `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5">${stops}</radialGradient>`;
  }
  // lineáris: a CSS-szöget (0°=fel, óramutató) SVG-vektorra képezzük
  const a = ((g.angle ?? 135) * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  return (
    `<linearGradient id="${id}" x1="${(0.5 - dx * 0.5).toFixed(3)}" y1="${(0.5 - dy * 0.5).toFixed(3)}" ` +
    `x2="${(0.5 + dx * 0.5).toFixed(3)}" y2="${(0.5 + dy * 0.5).toFixed(3)}">${stops}</linearGradient>`
  );
}

module.exports = { pathDataJs, cssGradient, svgGradientDef };
