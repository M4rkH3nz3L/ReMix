// 🎬 Animált maszk → szürke PNG-képsor (Chromium-canvas), a per-frame maszkhoz.
//
// A render EZT komponálja alfa-maszként (alphaextract × mask, majd alphamerge),
// így a maszk geometriája tetszőleges pontszámmal, feather-animációval együtt
// követhető/rotoszkópolható — a ≤16 csúcsú per-frame geq korlát NÉLKÜL.
// A geometriát a maskSample.js sampleli (a kliens maskAnim.ts tükre → paritás),
// a rajzolás pedig a részecske-generátor (particles.js) bevált canvas-mintáját
// követi. Chromium hiányában null-t ad → a render a geq-útra esik vissza.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sampleMaskAt } = require('./maskSample');

const MAX_FRAMES = 2700; // ~90 mp 30 fps-en

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

/** az oldal-oldali rajzoló — a sampleolt geometriát szürke maszkká festi (opak feketén) */
const DRAW_SOURCE = `
(() => {
  const cv = document.getElementById('m');
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  window.__setup = (W, H) => { cv.width = W; cv.height = H; };
  window.__drawFrames = (o) => {
    const { W, H, shape, invert, opacity, frames } = o;
    const urls = [];
    for (const g of frames) {
      ctx.filter = 'none';
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, W, H); // OPAK fekete háttér → a blur szürkébe olvad (nem premultiply-gond)
      const featherPx = Math.max(0, (g.feather != null ? g.feather : 0.05) * H);
      const expand = g.expand || 0;
      const cx = g.x * W, cy = g.y * H;
      ctx.filter = featherPx > 0.5 ? ('blur(' + featherPx.toFixed(1) + 'px)') : 'none';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      if (shape === 'ellipse') {
        const rw = Math.max(2, (g.w * W) / 2) * (1 + expand);
        const rh = Math.max(2, (g.h * H) / 2) * (1 + expand);
        ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      } else if (shape === 'polygon' && Array.isArray(g.points) && g.points.length >= 3) {
        const pts = g.points.map((p) => ({ x: p.x * W, y: p.y * H }));
        const ccx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const ccy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const sp = pts.map((p) => ({ x: ccx + (p.x - ccx) * (1 + expand), y: ccy + (p.y - ccy) * (1 + expand) }));
        ctx.moveTo(sp[0].x, sp[0].y);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
        ctx.closePath();
      } else {
        const rw = Math.max(2, (g.w * W) / 2) * (1 + expand);
        const rh = Math.max(2, (g.h * H) / 2) * (1 + expand);
        ctx.rect(cx - rw, cy - rh, rw * 2, rh * 2);
      }
      ctx.fill();
      ctx.filter = 'none';
      // invert + maszk-opacity (alfa-padló) a luminancián
      const mo = Math.max(0, Math.min(1, opacity || 0));
      if (invert || mo > 0) {
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          let v = d[i];
          if (invert) v = 255 - v;
          if (mo > 0) v = mo * 255 + (1 - mo) * v;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      urls.push(cv.toDataURL('image/png'));
    }
    return urls;
  };
})();
`;

/**
 * @param mask a ClipMask (track-kel)
 * @param opts { skip, duration, fps, W, H } — skip = a szegmens klipbeli kezdete
 * @returns {Promise<{pattern:string, frames:number}|null>} image2-minta vagy null
 */
async function renderMaskSequence(mask, opts, outDir) {
  const executablePath = findChromium();
  if (!executablePath) {
    return null; // → a render a geq-útra esik vissza
  }
  const { fps, W, H, skip = 0 } = opts;
  const frames = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(opts.duration * fps)));
  // geometria-sampling NODE-ban (paritás a klienssel), majd a page rajzolja
  const geoms = [];
  for (let f = 0; f < frames; f++) {
    const t = skip + f / fps;
    const s = sampleMaskAt(mask, t);
    geoms.push({
      x: s.x, y: s.y, w: s.w, h: s.h,
      feather: s.feather, expand: s.expand,
      points: s.points ? s.points.map((p) => ({ x: p.x, y: p.y })) : undefined,
    });
  }
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.setContent(
      `<!doctype html><html><body style="margin:0"><canvas id="m"></canvas><script>${DRAW_SOURCE}</script></body></html>`
    );
    await page.evaluate(([w, h]) => window.__setup(w, h), [W, H]);
    const BATCH = 24;
    let written = 0;
    while (written < frames) {
      const count = Math.min(BATCH, frames - written);
      const urls = await page.evaluate((o) => window.__drawFrames(o), {
        W,
        H,
        shape: mask.shape,
        invert: !!mask.invert,
        opacity: mask.opacity || 0,
        frames: geoms.slice(written, written + count),
      });
      for (let i = 0; i < urls.length; i++) {
        const idx = String(written + i + 1).padStart(5, '0');
        fs.writeFileSync(path.join(outDir, `mk_${idx}.png`), Buffer.from(urls[i].split(',')[1], 'base64'));
      }
      written += count;
    }
    return { pattern: path.join(outDir, 'mk_%05d.png'), frames: written };
  } finally {
    await browser.close();
  }
}

module.exports = { renderMaskSequence };
