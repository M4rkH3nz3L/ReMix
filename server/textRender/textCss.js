// 🎨 A szöveg-doboz CSS-darabjai: tipográfia, granuláris stílus (textStyle), stílus-preset, forgatás/tükrözés.

/** 🔡 Pro tipográfia: betűköz (tracking) · sorköz (leading) · kerning. */
function typographyCss(clip) {
  const parts = [];
  if (typeof clip.letterSpacing === 'number' && clip.letterSpacing !== 0) {
    parts.push(`letter-spacing:${clip.letterSpacing}em;`);
  }
  if (typeof clip.lineHeight === 'number' && clip.lineHeight > 0) {
    parts.push(`line-height:${clip.lineHeight};`);
  }
  if (clip.kerning === false) {
    parts.push('font-kerning:none;');
  }
  return parts.join('');
}

/**
 * 🎨 Granuláris szöveg-stílus (textStyle): gradient-kitöltés · kontúr · árnyék ·
 * ragyogás · háttér-doboz. A stylePreset FÖLÉ rétegződik. A gradient és a
 * háttér-doboz kölcsönösen kizárja egymást (a background-clip:text a dobozt is
 * a szövegre vágná) — gradient esetén a doboz kimarad.
 */
function textStyleCss(clip, fontPx) {
  const ts = clip.textStyle;
  if (!ts) {
    return '';
  }
  const parts = [];
  const shadows = [];
  if (ts.gradient) {
    const ang = ts.gradient.angle ?? 135;
    parts.push(
      `background-image:linear-gradient(${ang}deg,${ts.gradient.from},${ts.gradient.to});` +
        '-webkit-background-clip:text;background-clip:text;' +
        '-webkit-text-fill-color:transparent;color:transparent;'
    );
  }
  if (ts.stroke && ts.stroke.width > 0) {
    const w = Math.max(1, ts.stroke.width * fontPx);
    parts.push(`-webkit-text-stroke:${w.toFixed(1)}px ${ts.stroke.color};paint-order:stroke fill;`);
  }
  if (ts.shadow) {
    const dx = (ts.shadow.dx ?? 0) * fontPx;
    const dy = (ts.shadow.dy ?? 0) * fontPx;
    const blur = Math.max(0, (ts.shadow.blur ?? 0) * fontPx);
    shadows.push(`${dx.toFixed(1)}px ${dy.toFixed(1)}px ${blur.toFixed(1)}px ${ts.shadow.color}`);
  }
  if (ts.glow && ts.glow.size > 0) {
    const g = ts.glow.size * fontPx;
    shadows.push(`0 0 ${(g * 0.5).toFixed(1)}px ${ts.glow.color}`);
    shadows.push(`0 0 ${g.toFixed(1)}px ${ts.glow.color}`);
  }
  if (shadows.length) {
    parts.push(`text-shadow:${shadows.join(',')};`);
  }
  if (ts.background && !ts.gradient) {
    const pad = (ts.background.padding ?? 0.2) * fontPx;
    const rad = (ts.background.radius ?? 0) * fontPx;
    parts.push(
      `background-color:${ts.background.color};padding:${(pad * 0.5).toFixed(1)}px ${pad.toFixed(1)}px;border-radius:${rad.toFixed(1)}px;`
    );
  }
  if (ts.glow && ts.glow.size > 0) {
    // a glow túlnyúlását befogadó padding (különben a screenshot levágná)
    parts.push(`padding:${Math.max(16, ts.glow.size * fontPx).toFixed(0)}px;`);
  }
  return parts.join('');
}

function presetCss(clip, fontPx) {
  const preset = clip.stylePreset ?? 'plain';
  switch (preset) {
    case 'bubble':
      return `background: ${clip.backgroundColor ?? 'rgba(0,0,0,0.70)'}; border-radius: ${Math.max(8, fontPx * 0.4)}px; padding: ${fontPx * 0.25}px ${fontPx * 0.5}px;`;
    case 'outline':
      return `font-weight: 900; -webkit-text-stroke: ${Math.max(2, fontPx * 0.08)}px #000; paint-order: stroke fill;`;
    case 'neon': {
      // a padding befogadja a glow túlnyúlását, különben a screenshot négyszögletűre vágná
      const glow = Math.max(16, fontPx * 0.9);
      return `text-shadow: 0 0 ${Math.max(8, fontPx * 0.45)}px ${clip.color}, 0 0 ${glow}px ${clip.color}; padding: ${glow}px;`;
    }
    default:
      return `text-shadow: 0 1px 4px rgba(0,0,0,0.67);`;
  }
}

/**
 * 🔄 B18: a szöveg-réteg forgatása + tükrözése — a preview (TextOverlay) sorrendjében:
 * `rotate(R) scaleX(-1) scaleY(-1)` (a tükrözés a forgatás ELŐTT hat). A PNG-be ég,
 * a render a PNG KÖZEPÉT teszi a pozícióra → a forgatott doboz közepe is a helyén marad.
 */
function textTransformCss(clip) {
  const parts = [];
  if (clip.rotation) parts.push(`rotate(${Number(clip.rotation)}deg)`);
  if (clip.flipH) parts.push('scaleX(-1)');
  if (clip.flipV) parts.push('scaleY(-1)');
  return parts.join(' ');
}

module.exports = { typographyCss, textStyleCss, presetCss, textTransformCss };
