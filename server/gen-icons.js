// Remix márka-ikonok generálása (gradiens + shuffle-glyph) a meglévő
// playwright-Chromiummal. Futtatás: `cd server && node gen-icons.js`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

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
    /* nincs cache */
  }
  return null;
}

const GRAD = 'linear-gradient(135deg,#7c5cff 0%,#b95ce0 50%,#ff5ca8 100%)';

function shuffleSvg(px) {
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>`;
}

function html(t) {
  const svgScale = t.svgScale ?? 0.52;
  if (t.mode === 'full') {
    const glyph = shuffleSvg(Math.round(t.size * svgScale));
    return `<body style="margin:0;padding:0"><div style="width:${t.size}px;height:${t.size}px;background:${GRAD};display:flex;align-items:center;justify-content:center">${glyph}</div></body>`;
  }
  // badge: átlátszó háttér + lekerekített gradiens-badge (a logó-mark)
  const badge = Math.round(t.size * (t.badgeScale ?? 0.8));
  const glyph = shuffleSvg(Math.round(badge * 0.54));
  return `<body style="margin:0;padding:0;background:transparent"><div style="width:${t.size}px;height:${t.size}px;display:flex;align-items:center;justify-content:center;background:transparent"><div style="width:${badge}px;height:${badge}px;border-radius:${Math.round(badge * 0.24)}px;background:${GRAD};display:flex;align-items:center;justify-content:center">${glyph}</div></div></body>`;
}

async function main() {
  const exe = findChromium();
  if (!exe) {
    console.error('Nincs playwright-Chromium a cache-ben.');
    process.exit(1);
  }
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  const root = path.join(__dirname, '..');
  const targets = [
    { out: 'assets/images/icon.png', size: 1024, mode: 'full' },
    { out: 'assets/images/favicon.png', size: 48, mode: 'full' },
    { out: 'assets/images/splash-icon.png', size: 512, mode: 'badge', badgeScale: 0.82 },
    { out: 'assets/images/android-icon-foreground.png', size: 512, mode: 'full', svgScale: 0.44 },
  ];
  for (const t of targets) {
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(html(t));
    await page.screenshot({
      path: path.join(root, t.out),
      omitBackground: t.mode === 'badge',
      clip: { x: 0, y: 0, width: t.size, height: t.size },
    });
    console.log('írva:', t.out);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
