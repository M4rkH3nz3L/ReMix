// ✨ Részecske-generátor (🧊 3D V2): Chromium-canvas rendereli az átlátszó
// hátterű PNG-képsort — determinisztikus (seedelt) szimuláció, beat-burstökkel.
// A render a képsort a videóra komponálja a feliratok alá. A felbontás a
// vászon fele (a részecskék lágyak, a felskálázás nem látszik), így a
// generálás és a lemezhasználat is barátságos marad.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_FRAMES = 2700; // ~90 mp 30 fps-en — e fölött a réteg véget ér (eof pass)

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

/** az oldal-oldali szimuláció — stringként megy be, a page.evaluate futtatja */
const SIM_SOURCE = `
(() => {
  // mulberry32 — determinisztikus RNG (resume/teszt-stabil)
  let seedState = 0;
  const srand = (s) => { seedState = s >>> 0; };
  const rnd = () => {
    seedState = (seedState + 0x6d2b79f5) >>> 0;
    let t = seedState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const CONFETTI_COLORS = ['#ff2ea6','#7c5cff','#ffd166','#06d6a0','#4dc9ff','#ff6b4a'];
  let W, H, preset, intensity, particles, canvas, ctx;

  window.__initSim = (opts) => {
    W = opts.W; H = opts.H; preset = opts.preset; intensity = opts.intensity;
    srand(opts.seed);
    particles = [];
    canvas = document.getElementById('c');
    canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d');
  };

  const spawn = (burst) => {
    const k = burst ? 1 : 0.016;
    if (preset === 'confetti') {
      // ambient alig — a konfetti a burstben él
      const n = Math.round((burst ? 90 : 0.6) * intensity);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: rnd() * W, y: burst ? -10 - rnd() * H * 0.15 : -10,
          vx: (rnd() - 0.5) * W * 0.25, vy: H * (0.25 + rnd() * 0.35),
          rot: rnd() * Math.PI, vr: (rnd() - 0.5) * 8,
          size: (4 + rnd() * 7) * (W / 540),
          color: CONFETTI_COLORS[(rnd() * CONFETTI_COLORS.length) | 0],
          ttl: 3 + rnd() * 2, life: 0, kind: 'rect',
        });
      }
    } else if (preset === 'sparkle') {
      const n = Math.round((burst ? 50 : 1.2) * intensity * (burst ? 1 : 1));
      for (let i = 0; i < n; i++) {
        if (!burst && rnd() > 0.12 * intensity) continue;
        particles.push({
          x: rnd() * W, y: rnd() * H,
          vx: 0, vy: 0, rot: rnd() * Math.PI, vr: 0.6,
          size: (3 + rnd() * 5) * (W / 540),
          color: '#ffffff', ttl: 0.7 + rnd() * 0.9, life: 0, kind: 'star',
        });
      }
    } else if (preset === 'snow') {
      const n = Math.round((burst ? 30 : 1.6) * intensity);
      for (let i = 0; i < n; i++) {
        if (!burst && rnd() > 0.5) continue;
        particles.push({
          x: rnd() * W, y: -8,
          vx: (rnd() - 0.5) * W * 0.05, vy: H * (0.06 + rnd() * 0.06),
          rot: rnd() * 7, vr: 1.2,
          size: (2.5 + rnd() * 4) * (W / 540),
          color: '#ffffff', ttl: 20, life: 0, kind: 'dot',
        });
      }
    } else { // embers
      const n = Math.round((burst ? 45 : 1.4) * intensity);
      for (let i = 0; i < n; i++) {
        if (!burst && rnd() > 0.4) continue;
        particles.push({
          x: rnd() * W, y: H + 8,
          vx: (rnd() - 0.5) * W * 0.06, vy: -H * (0.09 + rnd() * 0.12),
          rot: rnd() * 7, vr: 2.5,
          size: (2 + rnd() * 3.5) * (W / 540),
          color: rnd() > 0.4 ? '#ffb347' : '#ff6b4a',
          ttl: 3 + rnd() * 3, life: 0, kind: 'glow',
        });
      }
    }
    void k;
  };

  window.__renderFrames = (opts) => {
    const { count, dt, bursts, tStart } = opts;
    const out = [];
    for (let f = 0; f < count; f++) {
      const t = tStart + f * dt;
      spawn(false);
      if (bursts.some((b) => t <= b && b < t + dt)) {
        spawn(true);
      }
      ctx.clearRect(0, 0, W, H);
      const next = [];
      for (const p of particles) {
        p.life += dt;
        if (p.life > p.ttl || p.y > H + 30 || p.y < -H * 0.3) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.kind === 'rect') p.vy += H * 0.25 * dt; // gravitáció
        if (p.kind === 'snowdrift' || p.kind === 'dot') p.x += Math.sin(p.rot) * 0.4;
        const fade = Math.min(1, Math.min(p.life * 4, (p.ttl - p.life) * 2));
        ctx.globalAlpha = Math.max(0, fade) * 0.95;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (p.kind === 'rect') {
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.kind === 'star') {
          const tw = 0.5 + 0.5 * Math.sin(p.life * 14 + p.rot * 9);
          ctx.globalAlpha *= tw;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          for (let a = 0; a < 4; a++) {
            const ang = p.rot + (a * Math.PI) / 2;
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
            ctx.lineTo(Math.cos(ang + 0.5) * p.size * 0.25, Math.sin(ang + 0.5) * p.size * 0.25);
          }
          ctx.fill();
        } else if (p.kind === 'glow') {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = p.size * 3;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        next.push(p);
      }
      particles = next;
      out.push(canvas.toDataURL('image/png'));
    }
    return out;
  };
})();
`;

/**
 * @param preset confetti|sparkle|snow|embers
 * @param opts { W, H, fps, duration, bursts (mp-lista), intensity, seed }
 * @param outDir ide kerül a pt_%05d.png képsor
 * @returns {Promise<{pattern: string, frames: number}>}
 */
async function renderParticleSequence(preset, opts, outDir) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error('Nincs Chromium headless shell a részecskékhez.');
  }
  const fps = opts.fps;
  const frames = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(opts.duration * fps)));
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage({
      viewport: { width: opts.W, height: opts.H },
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<canvas id="c"></canvas><script>${SIM_SOURCE}</script></body></html>`
    );
    await page.evaluate(
      (o) => window.__initSim(o),
      {
        W: opts.W,
        H: opts.H,
        preset,
        intensity: Math.min(1.6, Math.max(0.4, opts.intensity ?? 1)),
        seed: opts.seed ?? 42,
      }
    );
    const dt = 1 / fps;
    const BATCH = 24;
    let written = 0;
    while (written < frames) {
      const count = Math.min(BATCH, frames - written);
      const urls = await page.evaluate((o) => window.__renderFrames(o), {
        count,
        dt,
        bursts: opts.bursts ?? [],
        tStart: written * dt,
      });
      for (let i = 0; i < urls.length; i++) {
        const idx = String(written + i + 1).padStart(5, '0');
        fs.writeFileSync(
          path.join(outDir, `pt_${idx}.png`),
          Buffer.from(urls[i].split(',')[1], 'base64')
        );
      }
      written += count;
    }
    return { pattern: path.join(outDir, 'pt_%05d.png'), frames: written };
  } finally {
    await browser.close();
  }
}

module.exports = { renderParticleSequence };
