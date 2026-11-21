// 🛡️ Mélységi védelem: csak HELYI fájlút mehet az FFmpeg `-i`-jére / `lut3d`-jébe (a videoFilters.js-ből).
const os = require('os');
const path = require('path');

/** a render-munkakönyvtárak neve (lib/upload.js multer-storage + render-worker.js) */
const RENDER_DIR_RE = /^(vided|remix)-render-/;

/**
 * 🛡️ Csak HELYI fájl kerülhet az FFmpeg bemenetére. Az FFmpeg a `-i`-n (és a
 * `lut3d`-ben) érti a `http(s)://`, `file://`, `pipe:`, `concat:` stb. sémákat —
 * egy séma-előtagos érték így belső HTTP-kérést indítana a workerről, vagy
 * tetszőleges helyi fájlt olvasna be. A `/render` átírja a klip-uri-kat a
 * feltöltött fájlokra (a beágyazott kompozíciókét is, rekurzívan); ez a mélységi
 * védelem a matte-re és a LUT-ra minden úton hat. Séma nélkül is csak a render-
 * munkakönyvtáron belüli fájl fogadható el.
 * @returns a path, vagy null ha nem elfogadható
 */
function localPathOnly(p) {
  const s = String(p || '');
  if (!s || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    return null; // bármilyen séma-előtag (http:, file:, pipe:, concat:, C:)
  }
  // 🛡️ séma nélkül is csak a render-munkakönyvtár(ak)on BELÜLI fájl: a /render feltöltése
  // (`<tmp>/vided-render-*`, multer) vagy a felhő-worker letöltése (`<tmp>/remix-render-*`). Egy
  // abszolút `/etc/…`, relatív vagy `..`-os út eddig átment (pl. a /color/lut-export
  // `adjust.lut.uri`-ján át bármely létező helyi fájl a lut3d-be került).
  const rel = path.relative(path.resolve(os.tmpdir()), path.resolve(s));
  const [root, ...rest] = rel.split(path.sep);
  if (path.isAbsolute(rel) || !RENDER_DIR_RE.test(root) || rest.length === 0) {
    return null;
  }
  return s;
}

module.exports = { localPathOnly };
