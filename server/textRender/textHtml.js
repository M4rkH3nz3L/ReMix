// 🧊 Különleges szöveg-HTML-ek: 3D (extrúzió + anyag) és görbe menti szöveg (SVG textPath).
const { fontFaceCss, fontFamilyCss } = require('./fontFaces');

/** 3D szöveg anyag-definíciói: felület-gradiens + extrúzió-szín (+ glow) */
const TEXT3D_MATERIALS = {
  chrome: {
    face: 'linear-gradient(180deg,#f8f8fc 0%,#b9bcc8 35%,#5a5e6e 50%,#c6c9d4 65%,#eceef4 100%)',
    depth: '#23252e',
    glow: '',
  },
  gold: {
    face: 'linear-gradient(180deg,#fff2b0 0%,#f2c14e 45%,#a06a1f 55%,#ffd97a 100%)',
    depth: '#4a3208',
    glow: '',
  },
  neon: {
    face: 'linear-gradient(180deg,#ffffff 0%,#e9d5ff 30%,CURRENT 60%,CURRENT 100%)',
    depth: '#14061f',
    glow: '0 0 14px CURRENT, 0 0 30px CURRENT',
  },
  plastic: {
    face: 'linear-gradient(180deg,#ffffff22 0%,CURRENT 30%,CURRENT 100%)',
    depth: '#1c1c24',
    glow: '',
  },
};

/**
 * 3D szöveg HTML-je (🧊 3D V1): két réteg — alul az extrúzió (stackelt
 * text-shadow), felül az anyag-gradiens (background-clip: text) — az egész
 * perspektivikusan döntve. A Chromium ezt natívan, élesen rendereli.
 */
function text3dHtml(clip, fontPx, canvasW) {
  const t3 = clip.text3d;
  const mat = TEXT3D_MATERIALS[t3.material] ?? TEXT3D_MATERIALS.plastic;
  const face = mat.face.replaceAll('CURRENT', clip.color || '#7c5cff');
  const glow = mat.glow.replaceAll('CURRENT', clip.color || '#7c5cff');
  const steps = Math.max(2, Math.round(Math.min(1, Math.max(0, t3.depth)) * fontPx * 0.14));
  const shadows = [];
  for (let i = 1; i <= steps; i++) {
    shadows.push(`${i}px ${i}px 0 ${mat.depth}`);
  }
  const tiltX = Math.max(-45, Math.min(45, t3.tiltX || 0));
  const tiltY = Math.max(-45, Math.min(45, t3.tiltY || 0));
  const common = `
    font-family: ${fontFamilyCss(clip.fontFamily, clip.fontUri)};
    font-size:${fontPx}px;
    font-weight:800;
    text-align:center;
    line-height:1.2;
    white-space:pre-wrap;
    word-wrap:break-word;`;
  return `<!doctype html><html><body style="margin:0;background:transparent;display:inline-block;padding:${Math.round(fontPx * 0.6)}px;">
    <style>${fontFaceCss(clip.fontFamily, clip.fontUri)}</style>
    <div id="t" style="position:relative;display:inline-block;max-width:${Math.round(canvasW * 0.86)}px;
      transform: perspective(${Math.round(fontPx * 9)}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg);">
      <div class="d" style="${common} color:${mat.depth}; text-shadow:${shadows.join(',')};"></div>
      <div class="f" style="${common} position:absolute; inset:0; background:${face};
        -webkit-background-clip:text; background-clip:text; color:transparent;
        ${glow ? `filter: drop-shadow(0 0 ${Math.round(fontPx * 0.18)}px ${clip.color || '#7c5cff'});` : ''}"></div>
    </div>
  </body></html>`;
}

/**
 * 🛤️ Szöveg görbe mentén (text path): inline SVG `textPath`. A görbe alakja
 * arc (domb) / valley (völgy) / wave (hullám) / circle (kör). A kitöltés
 * (gradient/szín), a kontúr és a tracking a `textStyle`/klip-mezőkből; a
 * glow/árnyék CSS `drop-shadow` szűrővel. A doboz-hátteret path-on nem tesszük.
 */
function textPathHtml(clip, fontPx, canvasW) {
  const tp = clip.textPath;
  const curve = Math.min(1, Math.max(0, tp.curve ?? 0.5));
  const ts = clip.textStyle || {};
  const W = Math.round(canvasW * 0.85);
  const amp = curve * fontPx * 2;
  const isCircle = tp.shape === 'circle';
  // kör: a kerület ~ a szöveg hossza; a sugár ezt kielégíti
  const est = Math.max(fontPx * 2, Array.from(clip.text).length * fontPx * 0.6);
  const r = Math.max(fontPx * 1.2, est / (2 * Math.PI));
  const H = isCircle ? Math.round(2 * r + fontPx * 2.4) : Math.round(amp * 2 + fontPx * 2.4);
  const svgW = isCircle ? H : W;
  const cy = H / 2;
  let d;
  if (isCircle) {
    const cx = svgW / 2;
    // felül kezdődő kör (óramutató-irányban) — a szöveg körbefut
    d = `M ${cx},${(cy - r).toFixed(1)} A ${r.toFixed(1)},${r.toFixed(1)} 0 1,1 ${(cx - 0.01).toFixed(2)},${(cy - r).toFixed(1)}`;
  } else if (tp.shape === 'valley') {
    d = `M 0,${cy} Q ${W / 2},${cy + amp} ${W},${cy}`;
  } else if (tp.shape === 'wave') {
    d = `M 0,${cy} Q ${W * 0.25},${cy - amp} ${W * 0.5},${cy} T ${W},${cy}`;
  } else {
    // arc (domb)
    d = `M 0,${cy} Q ${W / 2},${cy - amp} ${W},${cy}`;
  }
  // kitöltés: gradient (SVG def) vagy tömör szín
  let gradDef = '';
  let fill = clip.color || '#ffffff';
  if (ts.gradient) {
    const a = ((ts.gradient.angle ?? 135) * Math.PI) / 180;
    const x2 = (Math.cos(a) * 0.5 + 0.5).toFixed(3);
    const y2 = (Math.sin(a) * 0.5 + 0.5).toFixed(3);
    gradDef = `<linearGradient id="tg" x1="${(0.5 - Math.cos(a) * 0.5).toFixed(3)}" y1="${(0.5 - Math.sin(a) * 0.5).toFixed(3)}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${ts.gradient.from}"/><stop offset="1" stop-color="${ts.gradient.to}"/></linearGradient>`;
    fill = 'url(#tg)';
  }
  const strokeAttr =
    ts.stroke && ts.stroke.width > 0
      ? ` stroke="${ts.stroke.color}" stroke-width="${Math.max(1, ts.stroke.width * fontPx).toFixed(1)}" paint-order="stroke"`
      : '';
  const filters = [];
  if (ts.glow && ts.glow.size > 0) {
    const g = ts.glow.size * fontPx;
    filters.push(`drop-shadow(0 0 ${(g * 0.5).toFixed(1)}px ${ts.glow.color})`);
    filters.push(`drop-shadow(0 0 ${g.toFixed(1)}px ${ts.glow.color})`);
  }
  if (ts.shadow) {
    filters.push(
      `drop-shadow(${(ts.shadow.dx * fontPx).toFixed(1)}px ${(ts.shadow.dy * fontPx).toFixed(1)}px ${(ts.shadow.blur * fontPx).toFixed(1)}px ${ts.shadow.color})`
    );
  }
  const filterStyle = filters.length ? `filter:${filters.join(' ')};` : '';
  const ls = clip.letterSpacing ? ` letter-spacing="${(clip.letterSpacing * fontPx).toFixed(1)}"` : '';
  const text = escapeHtmlLite(clip.text);
  const pad = Math.round(fontPx * 0.6);
  return `<!doctype html><html><head><style>${fontFaceCss(clip.fontFamily, clip.fontUri)}</style></head>
    <body style="margin:0;background:transparent;">
      <svg id="t" width="${svgW}" height="${H}" viewBox="${-pad} ${-pad} ${svgW + 2 * pad} ${H + 2 * pad}"
           style="overflow:visible;display:block;font-family:${fontFamilyCss(clip.fontFamily, clip.fontUri)};font-weight:${clip.fontWeight === 'bold' ? 700 : 400};${filterStyle}">
        <defs>${gradDef}</defs>
        <path id="tp" d="${d}" fill="none"/>
        <text font-size="${fontPx}" fill="${fill}"${strokeAttr}${ls}>
          <textPath href="#tp" startOffset="50%" text-anchor="middle">${text}</textPath>
        </text>
      </svg>
    </body></html>`;
}

function escapeHtmlLite(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { TEXT3D_MATERIALS, text3dHtml, textPathHtml, escapeHtmlLite };
