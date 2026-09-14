// 🎞️ Path-animáció: a forma-path „megrajzolja magát" (drawOn) vagy átalakul egy
// másik alakba (morph) — determinisztikus PNG-KÉPSOR headless Chromiummal, a
// text-motion.js mintájára. A render.js a felirat/forma-overlay láncba komponálja.
const { chromium } = require('playwright-core');
const path = require('path');
const { findChromium, pathDataJs } = require('./text-render');

const MAX_FRAMES = 150;

/** Bézier-path → sűrű polyline pont-sor (a morph egyenletes újramintázásához). */
function flattenPoints(points, closed) {
  if (!Array.isArray(points) || points.length < 2) {
    return (points || []).map((p) => ({ x: p.x, y: p.y }));
  }
  const cubic = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };
  const n = points.length;
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.h2 || b.h1) {
      for (let s = 0; s < 12; s++) out.push(cubic(a, a.h2 || a, b.h1 || b, b, s / 12));
    } else {
      out.push({ x: a.x, y: a.y });
    }
  }
  if (!closed) out.push({ x: points[n - 1].x, y: points[n - 1].y });
  return out;
}

/** Polyline egyenletes újramintázása `n` pontra (ív-hossz szerint). */
function resample(poly, n, closed) {
  if (poly.length < 2) {
    return Array.from({ length: n }, () => poly[0] || { x: 0.5, y: 0.5 });
  }
  const pts = closed ? [...poly, poly[0]] : poly;
  const seg = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    seg.push(d);
    total += d;
  }
  const out = [];
  const step = total / (closed ? n : n - 1);
  let si = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (si < seg.length - 1 && acc + seg[si] < target) {
      acc += seg[si];
      si++;
    }
    const t = seg[si] > 0 ? (target - acc) / seg[si] : 0;
    out.push({
      x: pts[si].x + t * (pts[si + 1].x - pts[si].x),
      y: pts[si].y + t * (pts[si + 1].y - pts[si].y),
    });
  }
  return out;
}

const polylineToD = (poly, w, h, closed) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.x * w).toFixed(2)},${(p.y * h).toFixed(2)}`).join(' ') +
  (closed ? 'Z' : '');

/**
 * Path-animáció képsora. @returns null (nincs Chromium) vagy { pattern, count,
 * fps, w, h, loop:false, animTotal, lastFile }.
 */
async function renderPathSequence(clip, canvas, outDir, fps = 30) {
  const executablePath = findChromium();
  if (!executablePath) {
    return null;
  }
  const pa = clip.pathAnim;
  const dur = Math.max(0.2, pa.dur || 1);
  const count = Math.min(MAX_FRAMES, Math.max(2, Math.ceil(dur * fps)));
  const sw = Math.max(1, Math.round(((clip.strokeWidth ?? 0.9) / 100) * canvas.h));
  const closed = Boolean(clip.closed);
  const pad = Math.max(sw, 4);
  const bw = Math.max(2, Math.round(clip.w * canvas.w));
  const bh = Math.max(2, Math.round(clip.h * canvas.h));
  const W = bw + 2 * pad;
  const H = bh + 2 * pad;
  const cap = clip.strokeCap ?? 'round';
  const join = clip.strokeJoin ?? 'round';

  const html = `<!doctype html><html><body style="margin:0;background:transparent;">
    <svg id="s" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible;display:block">
      <g transform="translate(${pad},${pad})">
        <path id="p" fill="none" stroke="${clip.fill}" stroke-width="${sw}"
              stroke-linecap="${cap}" stroke-linejoin="${join}"/>
      </g>
    </svg></body></html>`;

  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  let result = null;
  try {
    await page.setContent(html);
    const el = page.locator('#s');
    const pattern = path.join(outDir, `pseq_${clip.id}_%04d.png`);
    const shot = async (f) => {
      const file = path.join(outDir, `pseq_${clip.id}_${String(f).padStart(4, '0')}.png`);
      await el.screenshot({ path: file, omitBackground: true });
    };

    if (pa.mode === 'morph' && Array.isArray(pa.to) && pa.to.length >= 2) {
      const src = resample(flattenPoints(clip.points, closed), 64, closed);
      const dst = resample(flattenPoints(pa.to, closed), 64, closed);
      const fillCol = closed ? clip.fill : 'none';
      await page.evaluate(
        (fc) => {
          document.getElementById('p').setAttribute('fill', fc);
        },
        fillCol
      );
      for (let f = 0; f < count; f++) {
        const p = count > 1 ? f / (count - 1) : 1;
        const poly = src.map((s, i) => ({
          x: s.x + (dst[i].x - s.x) * p,
          y: s.y + (dst[i].y - s.y) * p,
        }));
        const d = polylineToD(poly, bw, bh, closed);
        await page.evaluate((dd) => document.getElementById('p').setAttribute('d', dd), d);
        await shot(f);
      }
    } else {
      // drawOn: a stroke a klip elején „megrajzolódik", a kitöltés beúszik
      const d = pathDataJs(clip.points, bw, bh, closed);
      await page.evaluate((dd) => document.getElementById('p').setAttribute('d', dd), d);
      const L = await page.evaluate(() => {
        const p = document.getElementById('p');
        const len = p.getTotalLength();
        p.style.strokeDasharray = String(len);
        return len;
      });
      for (let f = 0; f < count; f++) {
        const prog = count > 1 ? f / (count - 1) : 1;
        await page.evaluate(
          (args) => {
            const p = document.getElementById('p');
            p.style.strokeDashoffset = String(args.L * (1 - args.prog));
            if (args.closed) {
              p.setAttribute('fill', args.fill);
              p.setAttribute('fill-opacity', String(args.prog));
            }
          },
          { L, prog, closed, fill: clip.fill }
        );
        await shot(f);
      }
    }
    // beállt (teljes) állapot a farokhoz
    const lastFile = path.join(outDir, `pseq_${clip.id}_last.png`);
    await el.screenshot({ path: lastFile, omitBackground: true });
    const box = await el.boundingBox();
    result = {
      pattern,
      count,
      fps,
      w: Math.ceil(box?.width ?? W),
      h: Math.ceil(box?.height ?? H),
      loop: false,
      animTotal: dur,
      lastFile,
    };
  } finally {
    await browser.close();
  }
  return result;
}

module.exports = { renderPathSequence };
