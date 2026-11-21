// 🧭 A headless Chromium felkutatása (CHROMIUM_PATH → playwright-cache) — a szöveg-/forma-raszter és a renderer-tesztek közös kapuja.
const { logCaught } = require('../lib/caught');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
  } catch (caught) {
    logCaught('text-render.js:findChromium', caught);
    // nincs playwright-cache
  }
  return null;
}

module.exports = { findChromium };
