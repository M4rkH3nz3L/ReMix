// 🎨 Kép-dokumentum — nagy-doc védőkorlát (réteg- és vektorpont-plafon) a /imagedoc renderhez.
// REFACTOR: az alábbi JSDoc a renderImageDoc-é, de az eredetiben is ITT állt (a korlátok előtt) — így nem
// kötődik a függvényhez, és a renderImageDoc típusa (doc: any) változatlan marad.
/**
 * A réteg-fa kirasterizálása.
 * @param doc {{aspectRatio, layers}}
 * @param height a vászon magassága pixelben
 * @param workDir munkakönyvtár (a hívó takarítja)
 * @returns {Promise<string>} a kész PNG útvonala
 */
// 🛡️ Nagy-doc védőkorlátok: a /imagedoc RÉTEGENKÉNT egy Chromium-screenshotot
// készít (külön, 30 mp-es időkorláttal), majd ffmpeg-gel kompozitál — egy
// pathológikus dokumentum (több ezer réteg / millió path-pont) percekre
// elakasztaná a workert / elfogyasztaná a memóriát. Inkább BESZÉDES hibát adunk,
// mint hogy csendben megakadjunk vagy csonka képet adjunk vissza.
const MAX_LAYERS = 400;
const MAX_TOTAL_POINTS = 200000;

/**
 * A dokumentum túllépi-e a render-korlátokat? `null` = rendben, különben a
 * felhasználónak szánt (magyar) hibaüzenet.
 */
function imageDocGuard(doc) {
  const layers = Array.isArray(doc && doc.layers) ? doc.layers : [];
  if (layers.length > MAX_LAYERS) {
    return `Túl sok réteg (${layers.length} > ${MAX_LAYERS}). Egyesíts vagy lapíts rétegeket az exporthoz.`;
  }
  let points = 0;
  for (const l of layers) {
    // a kijelölésből jött maszk gyűrűi is vektor-tartalom: a raszterizálás ideje ezekkel nő
    for (const mask of [l?.mask, l?.localAdjust?.mask]) {
      for (const op of Array.isArray(mask?.ops) ? mask.ops : []) {
        points += Array.isArray(op?.points) ? op.points.length : 0;
      }
    }
    if (Array.isArray(l && l.points)) {
      points += l.points.length;
    }
    if (Array.isArray(l && l.subpaths)) {
      for (const sp of l.subpaths) {
        points += Array.isArray(sp) ? sp.length : 0;
      }
    }
  }
  if (points > MAX_TOTAL_POINTS) {
    return `Túl összetett vektor-tartalom (${points} pont > ${MAX_TOTAL_POINTS}). Egyszerűsítsd a path-okat.`;
  }
  return null;
}

module.exports = { MAX_LAYERS, MAX_TOTAL_POINTS, imageDocGuard };
