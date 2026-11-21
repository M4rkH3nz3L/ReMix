// 🛡️ Mélységi védelem: csak HELYI fájlút mehet az FFmpeg `-i`-jére / `lut3d`-jébe (a videoFilters.js-ből).

/**
 * 🛡️ Csak HELYI fájl kerülhet az FFmpeg bemenetére. Az FFmpeg a `-i`-n (és a
 * `lut3d`-ben) érti a `http(s)://`, `file://`, `pipe:`, `concat:` stb. sémákat —
 * egy séma-előtagos érték így belső HTTP-kérést indítana a workerről, vagy
 * tetszőleges helyi fájlt olvasna be. A `/render` átírja a klip-uri-kat a
 * feltöltött fájlokra, de a BEÁGYAZOTT kompozíciók belső klipjei nem mennek át
 * azon a cikluson — ez a mélységi védelem azokra is hat.
 * @returns a path, vagy null ha nem elfogadható
 */
function localPathOnly(p) {
  const s = String(p || '');
  if (!s || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    return null; // bármilyen séma-előtag (http:, file:, pipe:, concat:, C:)
  }
  return s;
}

module.exports = { localPathOnly };
