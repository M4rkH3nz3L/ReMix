// 🎬 Kinetic typography: per-karakter/szó/sor animált szöveg PNG-KÉPSORA headless
// Chromiummal. Determinisztikus: minden képkockára az oldal-oldali
// `__applyMotion(T)` állítja be az egységek opacity/transform értékét (T = mp),
// majd screenshot. A render.js a képsort a felirat-overlay-láncba komponálja.
//
// A tipográfia/stílus (font, tracking, gradient, kontúr, glow, háttér) UGYANAZ,
// mint a statikus text-render.js-nél — a közös helpereket onnan importáljuk.
const { chromium } = require('playwright-core');
const path = require('path');
const {
  findChromium,
  fontFaceCss,
  fontFamilyCss,
  typographyCss,
  textStyleCss,
  presetCss,
} = require('./text-render');

const MAX_FRAMES = 150; // ~5 mp 30 fps-en — a beérkező animáció ennél sosem hosszabb
const WAVE_PERIOD = 1.6; // a hullám egy periódusa (mp) — a render.js loopolja

/** a szöveget az animáció egysége szerint bontja fel HTML-darabokra */
function splitUnits(text, by) {
  if (by === 'line') {
    return text.split('\n').map((line) => ({ kind: 'line', text: line }));
  }
  if (by === 'word') {
    // szó-egységek, közéjük NEM animált szóköz (a sortörés megmarad)
    const out = [];
    const parts = text.split(/(\s+)/);
    for (const p of parts) {
      if (p === '') continue;
      out.push(/^\s+$/.test(p) ? { kind: 'space', text: p } : { kind: 'word', text: p });
    }
    return out;
  }
  // char: minden karakter külön egység (szóköz is, hogy a köz megmaradjon)
  return Array.from(text).map((ch) => ({ kind: 'char', text: ch }));
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** az egységek HTML-je: az animálandók `.u` osztályt kapnak, a szóközök nem */
function unitsHtml(units) {
  return units
    .map((u) => {
      const content = u.kind === 'space' ? u.text.replace(/ /g, '&nbsp;') : escapeHtml(u.text) || '&nbsp;';
      if (u.kind === 'space') {
        return `<span style="white-space:pre">${content}</span>`;
      }
      const block = u.kind === 'line' ? 'display:block;' : 'display:inline-block;';
      return `<span class="u" style="${block}white-space:pre;will-change:transform,opacity">${content}</span>`;
    })
    .join('');
}

// az oldal-oldali mozgás-függvény (stringként injektálva). Minden egységre
// opacity + transform(translate em, scale) a globális T (mp) alapján.
const MOTION_SOURCE = `
(() => {
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);
  const bounceOut = (x) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
    if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
    x -= 2.625 / d1; return n1 * x * x + 0.984375;
  };
  window.__applyMotion = (T) => {
    const cfg = window.__cfg;
    const units = document.querySelectorAll('.u');
    units.forEach((el, i) => {
      let opacity = 1, tx = 0, ty = 0, sc = 1;
      if (cfg.preset === 'wave') {
        const ph = (T / cfg.period) * 2 * Math.PI - i * 0.6;
        ty = Math.sin(ph) * 0.16;
      } else {
        const start = i * cfg.stagger;
        let p = (T - start) / cfg.dur;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        const e = easeOut(p);
        if (cfg.preset === 'reveal') { opacity = e; ty = (1 - e) * 0.4; }
        else if (cfg.preset === 'slideIn') { opacity = e; tx = (1 - e) * -0.6; }
        else if (cfg.preset === 'typeOn') { opacity = p > 0 ? 1 : 0; }
        else if (cfg.preset === 'popIn') { opacity = Math.min(1, p * 2.5); sc = p < 1 ? 1.35 * p * (2 - p) : 1; }
        else if (cfg.preset === 'bounce') { opacity = Math.min(1, p * 3); ty = (1 - bounceOut(p)) * 0.45; }
      }
      el.style.opacity = String(opacity);
      el.style.transform = 'translate(' + tx.toFixed(4) + 'em,' + ty.toFixed(4) + 'em) scale(' + sc.toFixed(4) + ')';
    });
  };
})();
`;

/**
 * Egy szövegklip kinetic PNG-képsora.
 * @returns null, ha nincs Chromium; egyébként { pattern, count, fps, w, h, loop,
 *          animTotal, lastFile }. `loop=true` (wave) → a render.js loopolja;
 *          `loop=false` (beérkező) → a `lastFile` a beállt (teljes) szöveg.
 */
async function renderTextSequence(clip, canvas, outDir, fps = 30) {
  const executablePath = findChromium();
  if (!executablePath) {
    return null;
  }
  const motion = clip.textMotion;
  const by = motion.by || 'word';
  const preset = motion.preset || 'reveal';
  const dur = Math.max(0.1, motion.dur ?? 0.4);
  const units = splitUnits(clip.text, by);
  const nUnits = units.filter((u) => u.kind !== 'space').length || 1;
  const loop = preset === 'wave';

  // a stagger úgy vágva, hogy a beérkezés összideje ≤ ~2.4 mp maradjon
  const rawStagger = motion.stagger ?? (by === 'char' ? 0.03 : by === 'word' ? 0.08 : 0.14);
  const stagger = Math.min(rawStagger, 2.4 / Math.max(1, nUnits - 1));
  const animTotal = loop ? WAVE_PERIOD : (nUnits - 1) * stagger + dur;
  const count = Math.min(MAX_FRAMES, Math.max(2, Math.ceil(animTotal * fps)));

  const fontPx = (clip.fontSize / 100) * canvas.h;
  const html = `<!doctype html><html><head><style>${fontFaceCss(clip.fontFamily)}</style></head>
    <body style="margin:0;background:transparent;">
      <div id="t" style="
        display:inline-block;
        max-width:${Math.round(canvas.w * 0.92)}px;
        font-family:${fontFamilyCss(clip.fontFamily)};
        font-size:${fontPx}px;
        font-weight:${clip.fontWeight === 'bold' ? 700 : 400};
        color:${clip.color};
        text-align:center;
        line-height:1.25;
        white-space:pre-wrap;
        word-wrap:break-word;
        padding:0.85em;
        ${presetCss(clip, fontPx)}
        ${typographyCss(clip)}
        ${textStyleCss(clip, fontPx)}
      ">${unitsHtml(units)}</div>
    </body></html>`;

  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: { width: canvas.w, height: canvas.h },
    deviceScaleFactor: 1,
  });
  let result = null;
  try {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(MOTION_SOURCE);
    await page.evaluate(
      (cfg) => {
        window.__cfg = cfg;
      },
      { preset, stagger, dur, period: WAVE_PERIOD }
    );
    const el = page.locator('#t');
    const box = await el.boundingBox();
    const pattern = path.join(outDir, `tseq_${clip.id}_%04d.png`);
    for (let f = 0; f < count; f++) {
      const T = (f / fps) % (loop ? WAVE_PERIOD : Infinity);
      await page.evaluate((t) => window.__applyMotion(t), T);
      const file = path.join(outDir, `tseq_${clip.id}_${String(f).padStart(4, '0')}.png`);
      await el.screenshot({ path: file, omitBackground: true });
    }
    // beérkező animációnál a beállt (teljes) állapot külön PNG-je a farokhoz
    let lastFile = null;
    if (!loop) {
      await page.evaluate(() => window.__applyMotion(1e9));
      lastFile = path.join(outDir, `tseq_${clip.id}_last.png`);
      await el.screenshot({ path: lastFile, omitBackground: true });
    }
    result = {
      pattern,
      count,
      fps,
      w: Math.ceil(box?.width ?? 0),
      h: Math.ceil(box?.height ?? 0),
      loop,
      animTotal,
      lastFile,
    };
  } finally {
    await browser.close();
  }
  return result;
}

module.exports = { renderTextSequence };
