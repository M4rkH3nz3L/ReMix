// Szövegklipek rasterizálása átlátszó PNG-vé headless Chromiummal.
// A CSS ugyanazokat a stílus-preseteket valósítja meg, mint az app TextOverlay-e,
// így a beégetett felirat vizuálisan egyezik az előnézettel.
//
// Egy klip több PNG-állapotot kaphat: a typewriter a szöveg prefixeit, a
// karaoke a szó-kiemelés fázisait rendereli; a render.js enable-ablakokkal
// váltja őket. A többi animáció (fade/slide/pop/pulse/shake) egyetlen PNG-t
// kap, a mozgás/alpha az FFmpeg-oldalon fut.
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** az app palette.accent-je — a karaoke aktív szava ezt kapja */
const ACCENT = '#7c5cff';
/** a kliens gépelés-animációja: 1 karakter / 60 ms */
const TYPEWRITER_CHAR_SEC = 0.06;
const MAX_TYPEWRITER_STEPS = 20;
const MAX_KARAOKE_STATES = 24;

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => d.startsWith('chromium_headless_shell-'))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const bin = path.join(cache, dir, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) {
        return bin;
      }
    }
  } catch {
    // nincs playwright-cache
  }
  return null;
}

// Választható betűtípusok (a család-név egyezik az app expo-font kulcsával).
// A TTF base64 data-URI-ként ágyazódik a HTML-be — nem kell Chromium file-access.
const FONT_FILES = {
  Anton: 'Anton-Regular.ttf',
  BebasNeue: 'BebasNeue-Regular.ttf',
  Poppins: 'Poppins-Bold.ttf',
  Pacifico: 'Pacifico-Regular.ttf',
  Bungee: 'Bungee-Regular.ttf',
  Oswald: 'Oswald-Regular.ttf',
  ArchivoBlack: 'ArchivoBlack-Regular.ttf',
  Righteous: 'Righteous-Regular.ttf',
  Lobster: 'Lobster-Regular.ttf',
  PermanentMarker: 'PermanentMarker-Regular.ttf',
};
const FALLBACK_FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";
const fontFaceCache = {};

function fontFaceCss(family) {
  if (!family || !FONT_FILES[family]) {
    return '';
  }
  if (fontFaceCache[family] === undefined) {
    try {
      const b64 = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', FONT_FILES[family])).toString('base64');
      fontFaceCache[family] = `@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block;}`;
    } catch {
      fontFaceCache[family] = '';
    }
  }
  return fontFaceCache[family];
}

function fontFamilyCss(family) {
  return family && FONT_FILES[family] ? `'${family}', ${FALLBACK_FONT}` : FALLBACK_FONT;
}

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
 * Typewriter-fázisok: a szöveg prefixei, a kliens 60 ms/karakter üteméhez
 * időzítve. Hosszú szövegnél legfeljebb MAX_TYPEWRITER_STEPS lépésre bontva.
 * from/to a klip kezdetéhez képesti mp; to=null → a klip végéig.
 */
function typewriterStates(clip) {
  const len = clip.text.length;
  if (len === 0) {
    return null;
  }
  const steps = Math.min(len, MAX_TYPEWRITER_STEPS);
  const states = [];
  let prevChars = 0;
  for (let k = 0; k < steps; k++) {
    const chars = Math.max(1, Math.round((len * (k + 1)) / steps));
    if (chars === prevChars) {
      continue;
    }
    states.push({
      content: { mode: 'plain', text: clip.text.slice(0, chars) },
      from: prevChars * TYPEWRITER_CHAR_SEC,
      to: k === steps - 1 ? null : chars * TYPEWRITER_CHAR_SEC,
    });
    prevChars = chars;
  }
  return states;
}

/**
 * Karaoke-fázisok: a szavak az idő arányában gyulladnak fel (aktív = accent,
 * hátralévő = 45% opacitás) — az app TextOverlay-ével megegyező szabály.
 * Sok szónál csoportosítva, hogy az állapotszám korlátos maradjon.
 */
function karaokeStates(clip) {
  const words = clip.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  const emphasis = new Set(clip.emphasis ?? []);
  const group = Math.ceil(words.length / MAX_KARAOKE_STATES);
  const stateCount = Math.ceil(words.length / group);
  // 🎤 szó-szintű időzítés (Whisper-igazítás), ha van; enélkül egyenletes
  // elosztás. A `wordAt(i)` a fázis-ablakok határait adja klip-időben.
  const timings =
    Array.isArray(clip.wordTimings) && clip.wordTimings.length === words.length
      ? clip.wordTimings
      : null;
  const per = clip.duration / words.length;
  const wordStart = (i) => (timings ? timings[i].t : i * per);
  const states = [];
  for (let s = 0; s < stateCount; s++) {
    const activeFrom = s * group;
    const activeTo = Math.min(words.length, (s + 1) * group) - 1;
    states.push({
      content: {
        mode: 'words',
        accent: ACCENT,
        words: words.map((word, i) => ({
          word,
          state: i < activeFrom ? 'past' : i <= activeTo ? 'active' : 'next',
          emp: emphasis.has(i),
        })),
      },
      from: wordStart(activeFrom),
      to: s === stateCount - 1 ? null : wordStart(activeTo + 1),
    });
  }
  return states;
}

/** ✨ kiemelt szavak sima (nem animált) feliraton — egyetlen words-állapot */
function emphasisState(clip) {
  const words = clip.text.split(/\s+/).filter(Boolean);
  const emphasis = new Set(clip.emphasis ?? []);
  if (words.length === 0 || emphasis.size === 0) {
    return null;
  }
  return [
    {
      content: {
        mode: 'words',
        accent: ACCENT,
        words: words.map((word, i) => ({ word, state: 'past', emp: emphasis.has(i) })),
      },
      from: 0,
      to: null,
    },
  ];
}

function statesFor(clip) {
  if (clip.animation === 'typewriter') {
    const states = typewriterStates(clip);
    if (states) {
      return states;
    }
  }
  if (clip.animation === 'karaoke') {
    const states = karaokeStates(clip);
    if (states) {
      return states;
    }
  }
  const emp = emphasisState(clip);
  if (emp) {
    return emp;
  }
  return [{ content: { mode: 'plain', text: clip.text }, from: 0, to: null }];
}

/**
 * @param textClips a projekt szövegklipjei
 * @param canvas {w,h} render-felbontás
 * @param outDir ide kerülnek a PNG-k
 * @returns [{clip, states: [{file, from, to}]}]
 */
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
    font-family: ${fontFamilyCss(clip.fontFamily)};
    font-size:${fontPx}px;
    font-weight:800;
    text-align:center;
    line-height:1.2;
    white-space:pre-wrap;
    word-wrap:break-word;`;
  return `<!doctype html><html><body style="margin:0;background:transparent;display:inline-block;padding:${Math.round(fontPx * 0.6)}px;">
    <style>${fontFaceCss(clip.fontFamily)}</style>
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
  return `<!doctype html><html><head><style>${fontFaceCss(clip.fontFamily)}</style></head>
    <body style="margin:0;background:transparent;">
      <svg id="t" width="${svgW}" height="${H}" viewBox="${-pad} ${-pad} ${svgW + 2 * pad} ${H + 2 * pad}"
           style="overflow:visible;display:block;font-family:${fontFamilyCss(clip.fontFamily)};font-weight:${clip.fontWeight === 'bold' ? 700 : 400};${filterStyle}">
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

async function renderTextPngs(textClips, canvas, outDir) {
  if (textClips.length === 0) {
    return [];
  }
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs elérhető Chromium a felirat-rasterizáláshoz (CHROMIUM_PATH?)');
  }
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: { width: canvas.w, height: canvas.h },
    deviceScaleFactor: 1,
  });
  const results = [];
  try {
    for (let i = 0; i < textClips.length; i++) {
      const clip = textClips[i];
      const fontPx = (clip.fontSize / 100) * canvas.h;

      // 3D szöveg: saját kétrétegű HTML, egyetlen állapottal (a typewriter/
      // karaoke fázisok 3D-ben v1-ben nem kombinálódnak)
      if (clip.text3d) {
        await page.setContent(text3dHtml(clip, fontPx, canvas.w));
        await page.evaluate((text) => {
          document.querySelector('.d').textContent = text;
          document.querySelector('.f').textContent = text;
        }, clip.text);
        const el3 = page.locator('#t');
        await page.evaluate(() => document.fonts.ready);
        const file3 = path.join(outDir, `text_${i}_0.png`);
        const box3 = await el3.boundingBox();
        await el3.screenshot({ path: file3, omitBackground: true });
        results.push({
          clip,
          states: [
            {
              file: file3,
              from: 0,
              to: null,
              w: Math.ceil(box3?.width ?? 0),
              h: Math.ceil(box3?.height ?? 0),
            },
          ],
        });
        continue;
      }

      // 🛤️ Szöveg görbe mentén (text path): SVG textPath, egyetlen állapot
      if (clip.textPath) {
        await page.setContent(textPathHtml(clip, fontPx, canvas.w));
        await page.evaluate(() => document.fonts.ready);
        const elp = page.locator('#t');
        const filep = path.join(outDir, `text_${i}_0.png`);
        const boxp = await elp.boundingBox();
        await elp.screenshot({ path: filep, omitBackground: true });
        results.push({
          clip,
          states: [
            {
              file: filep,
              from: 0,
              to: null,
              w: Math.ceil(boxp?.width ?? 0),
              h: Math.ceil(boxp?.height ?? 0),
            },
          ],
        });
        continue;
      }

      const html = `<!doctype html><html><body style="margin:0;background:transparent;display:flex;align-items:flex-start;justify-content:flex-start;">
        <style>${fontFaceCss(clip.fontFamily)}</style>
        <div id="t" style="
          display:inline-block;
          max-width:${Math.round(canvas.w * 0.92)}px;
          font-family: ${fontFamilyCss(clip.fontFamily)};
          font-size:${fontPx}px;
          font-weight:${clip.fontWeight === 'bold' ? 700 : 400};
          color:${clip.color};
          text-align:center;
          line-height:1.25;
          white-space:pre-wrap;
          word-wrap:break-word;
          ${presetCss(clip, fontPx)}
          ${typographyCss(clip)}
          ${textStyleCss(clip, fontPx)}
        "></div>
      </body></html>`;
      const states = statesFor(clip);
      const rendered = [];
      for (let s = 0; s < states.length; s++) {
        await page.setContent(html);
        await page.evaluate((content) => {
          const el = document.getElementById('t');
          if (content.mode === 'plain') {
            el.textContent = content.text;
            return;
          }
          el.textContent = '';
          const hasEmp = content.words.some((w) => w.emp);
          if (hasEmp) {
            // a 3D-be pattanó szó túlnyúlik a sorközön — legyen hely a dobozban
            el.style.padding = '0.45em 0.5em';
          }
          content.words.forEach((w, wi) => {
            const span = document.createElement('span');
            span.textContent = w.word + (wi < content.words.length - 1 ? ' ' : '');
            if (w.state === 'active') {
              span.style.color = content.accent;
            }
            if (w.state === 'next') {
              span.style.opacity = '0.45';
            }
            // 🧊 3D caption: a kiemelt szó extrudált, döntött, előre ugró —
            // karaoke aktív állapotban a legerősebb pop (a fázis-PNG-kbe ég)
            if (w.emp) {
              const active = w.state === 'active';
              const steps = active ? 6 : 4;
              const shadows = [];
              for (let i = 1; i <= steps; i++) {
                shadows.push(`${i * 0.02}em ${i * 0.02}em 0 #8f0f5c`);
              }
              span.style.color = '#ff2ea6';
              span.style.fontWeight = '900';
              span.style.fontSize = '1.14em';
              span.style.textShadow = shadows.join(', ');
              span.style.display = 'inline-block';
              span.style.transform =
                `perspective(8em) rotateX(10deg) scale(${active ? 1.3 : 1.12})`;
              if (w.state === 'next') {
                span.style.opacity = '0.6';
              }
            }
            el.appendChild(span);
          });
        }, states[s].content);
        const el = page.locator('#t');
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(outDir, `text_${i}_${s}.png`);
        const box = await el.boundingBox();
        await el.screenshot({ path: file, omitBackground: true });
        rendered.push({
          file,
          from: states[s].from,
          to: states[s].to,
          w: Math.ceil(box?.width ?? 0),
          h: Math.ceil(box?.height ?? 0),
        });
      }
      results.push({ clip, states: rendered });
    }
  } finally {
    await browser.close();
  }
  return results;
}

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

/**
 * Forma-klipek rasterizálása (Creative Canvas): a CSS ugyanazt rajzolja, mint
 * az app ShapeOverlay-e (kitöltés/gradiens/keret/lekerekítés) — a kimenet a
 * text-overlay lánccal kompatibilis {clip, states} bejegyzés.
 */
async function renderShapePngs(shapeClips, canvas, outDir) {
  if (shapeClips.length === 0) {
    return [];
  }
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs elérhető Chromium a forma-rasterizáláshoz (CHROMIUM_PATH?)');
  }
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: { width: canvas.w, height: canvas.h },
    deviceScaleFactor: 1,
  });
  const results = [];
  try {
    for (let i = 0; i < shapeClips.length; i++) {
      const clip = shapeClips[i];
      const w = Math.max(2, Math.round(clip.w * canvas.w));
      const h = Math.max(
        2,
        Math.round((clip.shape === 'line' ? Math.max(clip.h, 0.004) : clip.h) * canvas.h)
      );
      const radius =
        clip.shape === 'ellipse'
          ? Math.max(w, h)
          : Math.round((clip.cornerRadius ?? 0) * Math.min(w, h));
      const borderWidth = Math.round(((clip.borderWidth ?? 0) / 100) * canvas.h);
      // kép-kitöltés (logó/watermark): a fájl data-URI-ként ágyazódik be —
      // az SVG-t a Chromium natívan rendereli, méretezés contain-nel
      let background = clip.gradient
        ? cssGradient(clip.gradient)
        : clip.fillGradient
          ? `linear-gradient(135deg, ${clip.fillGradient.from}, ${clip.fillGradient.to})`
          : clip.fill;
      let backgroundExtra = '';
      const isImageFillEarly = Boolean(clip.imageUri && fs.existsSync(clip.imageUri));
      if (isImageFillEarly) {
        const ext = path.extname(clip.imageUri).toLowerCase();
        const mime =
          ext === '.svg'
            ? 'image/svg+xml'
            : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
        const b64 = fs.readFileSync(clip.imageUri).toString('base64');
        background = `url(data:${mime};base64,${b64})`;
        backgroundExtra =
          'background-size:contain;background-position:center;background-repeat:no-repeat;';
      }
      // ✏️ szabadkézi vonal: INLINE SVG polyline. Azért SVG és nem CSS, mert
      // a Chromium az SVG-t élsimítja (a clip-path-ot nem), és a `stroke`
      // pontosan követi a vonalat — kerek sapkával/illesztéssel.
      let pathSvg = '';
      if (clip.shape === 'path' && Array.isArray(clip.points) && clip.points.length >= 2) {
        const sw = Math.max(1, Math.round(((clip.strokeWidth ?? 0.9) / 100) * canvas.h));
        const closed = Boolean(clip.closed);
        const d = pathDataJs(clip.points, w, h, closed);
        // ✂️ stroke-attribútumok: vonalvég/illesztés + szaggatás
        const cap = clip.strokeCap ?? 'round';
        const join = clip.strokeJoin ?? 'round';
        const dashArr =
          clip.strokeDash && clip.strokeDash > 0
            ? ` stroke-dasharray="${(clip.strokeDash * sw).toFixed(1)} ${(clip.strokeDash * sw).toFixed(1)}"`
            : '';
        // zárt path = kitöltött forma (gradient/szín) + opcionális kontúr;
        // nyitott path = vonal a `fill` színével
        let fillAttr = 'none';
        let gradDefPath = '';
        if (closed) {
          if (clip.gradient && clip.gradient.type !== 'conic') {
            gradDefPath = svgGradientDef(`pgp${i}`, clip.gradient);
            fillAttr = `url(#pgp${i})`;
          } else if (clip.gradient && clip.gradient.type === 'conic') {
            // SVG path-fill nem tud konikust → az első stop színe
            fillAttr = (clip.gradient.stops[0] && clip.gradient.stops[0].color) || clip.fill;
          } else if (clip.fillGradient) {
            gradDefPath = `<linearGradient id="pgp${i}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${clip.fillGradient.from}"/><stop offset="1" stop-color="${clip.fillGradient.to}"/></linearGradient>`;
            fillAttr = `url(#pgp${i})`;
          } else {
            fillAttr = clip.fill;
          }
        }
        const cStrokeW = closed
          ? clip.outline
            ? Math.max(1, Math.round((clip.outline.width / 100) * canvas.h))
            : clip.borderWidth
              ? borderWidth
              : 0
          : sw;
        const cStrokeCol = closed ? clip.outline?.color ?? clip.borderColor ?? '#ffffff' : clip.fill;
        const strokeAttrs =
          cStrokeW > 0
            ? ` stroke="${cStrokeCol}" stroke-width="${cStrokeW}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dashArr}`
            : '';
        const glow = clip.glow
          ? `<path d="${d}" ${closed ? `fill="${clip.glow.color}"` : `fill="none" stroke="${clip.glow.color}" stroke-width="${sw * 2.4}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dashArr}`} opacity="0.5" filter="url(#blur)"/>`
          : '';
        pathSvg =
          `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible;display:block">` +
          (clip.glow || gradDefPath
            ? `<defs>${clip.glow ? `<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(1, sw * 0.6)}"/></filter>` : ''}${gradDefPath}</defs>`
            : '') +
          glow +
          `<path d="${d}" fill="${fillAttr}"${closed ? strokeAttrs : ` stroke="${clip.fill}" stroke-width="${sw}" stroke-linecap="${cap}" stroke-linejoin="${join}"${dashArr}`}/>` +
          `</svg>`;
      }

      // nyíl/csillag SVG-vel (élsimított, pontos stroke-kal)
      let polySvg = '';
      // (a definíció lentebb, a POLY_POINTS után töltődik fel)

      // nyíl/csillag: clip-path sokszög — a fill/gradiens/kép-kitöltéssel is
      // működik; keret ezekre nem értelmezett (a clip levágná)
      // 0–100-as koordináták — az előnézet (ShapeOverlay) UGYANEZEKET használja
      const POLY_POINTS = {
        arrow: [[0, 35], [60, 35], [60, 12], [100, 50], [60, 88], [60, 65], [0, 65]],
        star: [
          [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70],
          [21, 91], [32, 57], [2, 35], [39, 35],
        ],
      };
      // A sokszögek INLINE SVG-vel rajzolódnak, nem CSS clip-path-tal:
      //  · a Chromium az SVG-t ÉLSIMÍTJA, a clip-path élét nem (a csillag
      //    hegyei fűrészesek voltak),
      //  · a `stroke` PONTOSAN a kontúrt adja — nem kell méretezett
      //    háttér-másolattal vagy drop-shadow-lánccal közelíteni.
      // Kép-kitöltésnél marad a clip-path: ott a kitöltés egy háttérkép, amit
      // az SVG polygon nem tudna átvenni.
      const svgPoly = POLY_POINTS[clip.shape];
      // konikus gradienst az SVG nem tud → az ilyen poligon clip-path-ra esik
      // vissza (a CSS-háttér konikus gradientjével)
      const polyConic = Boolean(clip.gradient && clip.gradient.type === 'conic');
      const useSvgPoly = Boolean(svgPoly) && !isImageFillEarly && !polyConic;
      const clipPath = svgPoly && !useSvgPoly
        ? `clip-path:polygon(${svgPoly.map(([px, py]) => `${px}% ${py}%`).join(', ')});`
        : '';
      if (useSvgPoly) {
        const pts = svgPoly.map(([px, py]) => `${(px / 100) * w},${(py / 100) * h}`).join(' ');
        const gradId = `pg${i}`;
        // új multi-stop gradient > legacy fillGradient > tömör szín
        const gradDef = clip.gradient
          ? svgGradientDef(gradId, clip.gradient)
          : clip.fillGradient
            ? `<linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${clip.fillGradient.from}"/><stop offset="1" stop-color="${clip.fillGradient.to}"/></linearGradient>`
            : '';
        const fillRef = gradDef ? `url(#${gradId})` : clip.fill;
        const strokeW = clip.outline
          ? Math.max(1, Math.round((clip.outline.width / 100) * canvas.h))
          : borderWidth > 0
            ? borderWidth
            : 0;
        const strokeCol = clip.outline
          ? clip.outline.color ?? '#ffffff'
          : clip.borderColor ?? '#ffffff';
        polySvg =
          `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
          `style="overflow:visible;display:block">` +
          (gradDef ? `<defs>${gradDef}</defs>` : '') +
          `<polygon points="${pts}" fill="${fillRef}"` +
          (strokeW > 0
            ? ` stroke="${strokeCol}" stroke-width="${strokeW * 2}" stroke-linejoin="${clip.strokeJoin ?? 'round'}" paint-order="stroke"` +
              (clip.strokeDash && clip.strokeDash > 0
                ? ` stroke-dasharray="${(clip.strokeDash * strokeW * 2).toFixed(1)} ${(clip.strokeDash * strokeW * 2).toFixed(1)}"`
                : '')
            : '') +
          `/></svg>`;
      }
      const border =
        borderWidth > 0 && !clipPath && !useSvgPoly
          ? `border:${borderWidth}px ${clip.strokeDash && clip.strokeDash > 0 ? 'dashed' : 'solid'} ${clip.borderColor ?? '#ffffff'};`
          : '';
      // az árnyék a sziluettet követi (drop-shadow), és túlnyúlik a formán —
      // a wrapper paddingje ad neki helyet, a screenshot a wrapperről készül
      // (szimmetrikus margó = a középre igazítás nem csúszik)
      const shadowSpread = clip.shadow ? Math.max(8, Math.round(h * 0.18)) : 0;
      // ✨ ragyogás és 🖊️ kontúr: egymásra fűzött drop-shadow-k. A CSS
      // filter-lánc minden tagja az ELŐZŐ EREDMÉNYÉRE hat — ezért ad az
      // eltolás nélküli, növekvő elmosású sor ragyogást, a négy tengely-irányú,
      // elmosás nélküli pedig kontúrt (az átlókat a láncolás tölti ki).
      // Mindkettő a SZILUETTET követi, tehát clip-path-os formán és
      // kép-kitöltésű logón is működik, ahol a `border` nem.
      const glowPx = clip.glow
        ? Math.max(2, Math.round((clip.glow.size / 100) * canvas.h))
        : 0;
      const outlinePx = clip.outline
        ? Math.max(1, Math.round((clip.outline.width / 100) * canvas.h))
        : 0;
      const filters = [];
      // 🖊️ KONTÚR — két út, mert egyik sem jó mindkét esetre:
      //  · tömör/gradiens forma (clip-path is): MÉRETEZETT HÁTTÉR-MÁSOLAT.
      //    Tiszta élt ad, mert egyetlen alakzat — az egymásra fűzött
      //    drop-shadow-k viszont lépcsőznek az éles csúcsokon (a csillag
      //    hegyei csipkéssé váltak tőle).
      //  · kép-kitöltésű logó: ott a sziluett a KÉP ALFÁJÁBÓL jön, egy
      //    nagyobb másolat nem adná ki — marad a 8 irányú drop-shadow.
      const isImageFill = isImageFillEarly;
      let outlineLayer = '';
      if (outlinePx > 0) {
        const c = clip.outline.color ?? '#ffffff';
        if (isImageFill) {
          const d = Math.max(1, Math.round(outlinePx * 0.7071));
          for (const [dx, dy] of [
            [outlinePx, 0], [-outlinePx, 0], [0, outlinePx], [0, -outlinePx],
            [d, d], [-d, d], [d, -d], [-d, -d],
          ]) {
            filters.push(`drop-shadow(${dx}px ${dy}px 0 ${c})`);
          }
        } else if (!useSvgPoly) {
          // (SVG-s sokszögnél a stroke adja a kontúrt — ide már nem jutunk)
          // ISMERT KORLÁT: a Chromium a `clip-path` élét nem simítja, ezért a
          // CSILLAG éles csúcsain a kontúr fűrészes marad (a nyíl tompább
          // szögein nem látszik). Végleges javítás: a sokszögeket inline SVG
          // <polygon>-ná átírni — ott a `stroke` pontosan a kontúrt adja, és
          // az élsimítás is működik.
          const ow = w + outlinePx * 2;
          const oh = h + outlinePx * 2;
          // a lekerekítés arányosan nő, hogy a kontúr egyenletes maradjon
          const oRadius = radius > 0 ? Math.round(radius * (ow / Math.max(1, w))) : 0;
          outlineLayer =
            `<div style="position:absolute;left:0;top:0;width:${ow}px;height:${oh}px;` +
            `background:${c};border-radius:${oRadius}px;${clipPath}"></div>`;
        }
      }
      if (glowPx > 0 && clip.shape !== 'path') {
        const c = clip.glow.color ?? '#ffffff';
        filters.push(
          `drop-shadow(0 0 ${Math.round(glowPx * 0.5)}px ${c})`,
          `drop-shadow(0 0 ${glowPx}px ${c})`
        );
      }
      if (clip.shadow) {
        filters.push(
          `drop-shadow(0 ${Math.round(shadowSpread * 0.4)}px ${Math.round(
            shadowSpread * 0.6
          )}px rgba(0,0,0,0.55))`
        );
      }
      // a wrapper paddingjének MINDEN effektet el kell bírnia, különben a
      // screenshot levágná a szélüket (szimmetrikus, hogy a középre igazítás
      // ne csússzon el)
      const shadowPad =
        filters.length > 0 || clip.shadow || glowPx > 0
          ? Math.max(8, shadowSpread, glowPx * 2, outlinePx * 2)
          : 0;
      const shadowCss = filters.length > 0 ? `filter:${filters.join(' ')};` : '';
      const usesWrap = shadowPad > 0;
      // FONTOS: a szűrő a WRAPPERRE megy, nem a formára. A CSS-ben a
      // `clip-path` a `filter` UTÁN vág — ha ugyanazon az elemen van, a
      // clip-path levágja a formán túlnyúló ragyogást/kontúrt/árnyékot
      // (a nyíl és a csillag effektjei így nyom nélkül eltűntek).
      const html = `<!doctype html><html><body style="margin:0;background:transparent;">
        <div id="wrap" style="padding:${shadowPad}px;display:inline-block;${shadowCss}">
        <div id="box" style="position:relative;width:${w + outlinePx * 2}px;height:${
          h + outlinePx * 2
        }px;">
        ${outlineLayer}
        <div id="s" style="
          position:absolute;left:${outlinePx}px;top:${outlinePx}px;
          width:${w}px;height:${h}px;
          background:${pathSvg || polySvg ? 'transparent' : background};
          ${backgroundExtra}
          border-radius:${radius}px;
          ${clipPath}
          ${border}
          box-sizing:border-box;
          opacity:${clip.opacity ?? 1};
        ">${pathSvg}${polySvg}</div>
        </div>
        </div>
      </body></html>`;
      await page.setContent(html);
      const el = page.locator(usesWrap ? '#wrap' : outlinePx > 0 ? '#box' : '#s');
      const file = path.join(outDir, `shape_${i}.png`);
      const box = await el.boundingBox();
      await el.screenshot({ path: file, omitBackground: true });
      results.push({
        clip,
        states: [
          {
            file,
            from: 0,
            to: null,
            w: Math.ceil(box?.width ?? w),
            h: Math.ceil(box?.height ?? h),
          },
        ],
      });
    }
  } finally {
    await browser.close();
  }
  return results;
}

/**
 * 🔁 Text → Shape: egyetlen szövegklipet a TELJES stílusával (font, tipográfia,
 * gradient, kontúr, glow, path, 3D) átlátszó hátterű PNG-vé süt, hogy forma-
 * klip kép-kitöltéseként (imageUri) tovább animálható/stílusozható legyen a
 * forma-eszköztárral. Az animációt/kinetic-et a bake-hez kikapcsoljuk (statikus
 * kép kell). @returns { pngBase64, w, h }
 */
async function bakeTextPng(clip, canvas) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txtbake-'));
  try {
    const bakeClip = { ...clip, animation: 'none', textMotion: undefined, maskReveal: undefined };
    const res = await renderTextPngs([bakeClip], canvas, outDir);
    const st = res[0] && res[0].states && res[0].states[0];
    if (!st) {
      throw new Error('Nem sikerült a szöveget képpé alakítani.');
    }
    return {
      pngBase64: fs.readFileSync(st.file).toString('base64'),
      w: st.w,
      h: st.h,
    };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

module.exports = {
  renderTextPngs,
  renderShapePngs,
  bakeTextPng,
  // a kinetic (per-frame) szöveg-szekvencia UGYANEZEKET a helpereket használja
  findChromium,
  fontFaceCss,
  fontFamilyCss,
  typographyCss,
  textStyleCss,
  presetCss,
};
