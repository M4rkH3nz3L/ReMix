const { spawnSync } = require('child_process');

const { findChromium } = require('../text-render');

/**
 * 🧪 A renderer-függő tesztek (Chromium-raszter, ffmpeg-képpont, szerveres render) közös kapuja.
 *
 * Lokálisan a hiányzó eszköz miatt a blokk ÉRTHETŐ címmel átugrik (nem hamis bukás); CI-ben
 * (`CI=true`) viszont egy bukó tesztté válik, ami megnevezi a hiányt — egy csendben átugrott
 * minőségkapu nem kapu.
 *
 *   describeIfRenderer('cím', { chromium: true, ffmpeg: true }, () => { … });
 *   itIfRenderer({ chromium: true })('cím', async () => { … });
 *
 * `ffmpeg` lehet minimum-verzió is (`'8.1'`): a szín-pontos képtesztek erre a verzióra mértek.
 */

let chromiumCache;
let ffmpegCache;

function chromiumPath() {
  if (chromiumCache === undefined) {
    chromiumCache = findChromium();
  }
  return chromiumCache;
}

/** a telepített ffmpeg verziója `[major, minor]`-ként, vagy null, ha nincs ffmpeg */
function ffmpegVersion() {
  if (ffmpegCache === undefined) {
    const r = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    if (r.status !== 0) {
      ffmpegCache = null;
    } else {
      const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(r.stdout);
      // a git-buildek (`N-12345-…`) verziószám nélküliek → a legfrissebbnek tekintjük
      ffmpegCache = m ? [Number(m[1]), Number(m[2])] : [Infinity, 0];
    }
  }
  return ffmpegCache;
}

function versionAtLeast(have, want) {
  const [wMaj, wMin = 0] = String(want).split('.').map(Number);
  return have[0] > wMaj || (have[0] === wMaj && have[1] >= wMin);
}

/**
 * A hiányzó eszközök emberi nyelvű listája (üres = minden megvan).
 * @param {{ chromium?: boolean, ffmpeg?: boolean | string }} needs
 * @returns {string[]}
 */
function missingRenderer(needs) {
  const missing = [];
  if (needs.chromium && !chromiumPath()) {
    missing.push('Chromium (CHROMIUM_PATH vagy Playwright-cache)');
  }
  if (needs.ffmpeg) {
    const v = ffmpegVersion();
    if (!v) {
      missing.push('ffmpeg');
    } else if (typeof needs.ffmpeg === 'string' && !versionAtLeast(v, needs.ffmpeg)) {
      missing.push(`ffmpeg ≥ ${needs.ffmpeg} (telepítve: ${v.join('.')})`);
    }
  }
  return missing;
}

function ciFailure(missing) {
  return new Error(`A CI-ben kötelező a renderer, de hiányzik: ${missing.join(', ')}.`);
}

function describeIfRenderer(name, needs, fn) {
  const missing = missingRenderer(needs);
  if (missing.length === 0) {
    describe(name, fn);
  } else if (process.env.CI) {
    describe(name, () => {
      it('a renderer elérhető', () => {
        throw ciFailure(missing);
      });
    });
  } else {
    describe.skip(`${name} [átugorva: nincs ${missing.join(', ')}]`, fn);
  }
}

function itIfRenderer(needs) {
  const missing = missingRenderer(needs);
  if (missing.length === 0) {
    return it;
  }
  if (process.env.CI) {
    const fail = (name) =>
      it(name, () => {
        throw ciFailure(missing);
      });
    fail.each = () => fail;
    return fail;
  }
  const suffix = ` [átugorva: nincs ${missing.join(', ')}]`;
  const skip = (name, fn, timeout) => it.skip(`${name}${suffix}`, fn, timeout);
  skip.each = (table) => (name, fn, timeout) => it.skip.each(table)(`${name}${suffix}`, fn, timeout);
  return skip;
}

module.exports = { chromiumPath, ffmpegVersion, versionAtLeast, missingRenderer, describeIfRenderer, itIfRenderer };
