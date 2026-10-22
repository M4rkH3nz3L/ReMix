// 🖼️ PSD-export mag (IMAGE 01.2): `ImageDoc` réteg-fa → Photoshop .psd (bináris),
// RÉTEG-MEGŐRZÉSSEL (NEM flatten!). Ez a `psdImport.js` FORDÍTOTTJA.
//
// ELV: a mag PURE-ish — a réteg-PNG-ket NEM ez tölti le, hanem egy INJEKTÁLT
// `fetchLayerPng(srcOrUri) → Promise<Buffer>` adja (→ tesztelhető valós tár +
// hálózat nélkül: a teszt egy memóriabeli PNG-buffert ad vissza). Az `ag-psd`
// `writePsd`-je építi a .psd-t; a per-réteg RGBA-t a `pngjs` `PNG.sync.read`-del
// dekódoljuk a réteg-PNG-kből (NINCS natív canvas-build → remote/CI-barát).
//
// A réteg-modellt a `psdImport` dokumentálja: PhotoLayer/TextLayer/ShapeLayer/
// FillLayer/AdjustmentLayer + `layer.groupId`, opacity/blendMode/hidden/position/
// w/h. A pozíció a `psdImport.normBox` FORDÍTOTTJA (0–1 közép+méret → PSD-pixel
// left/top/right/bottom), a blend a `BLEND_MAP` MEGFORDÍTÁSA (modell → PSD-mód).

const agPsd = require('ag-psd');
const { PNG } = require('pngjs');

const { BLEND_MAP } = require('./psdImport');
const { shapeToVector } = require('./psdVector');

// 🧩 PURE-JS canvas-shim az ag-psd ÍRÓJÁHOZ. Az `imageDataStyle: 'raw'` úttal a
// writer a nyers RGBA-t közvetlenül csomagolja, de a defenzív init így is kell
// (a writer bizonyos ágakon `createCanvas`-t hívhat) — ugyanaz a minimális shim,
// mint a `psdImport.ensureCanvasShim`-ben (natív függőség nélkül).
let canvasInit = false;
function ensureCanvasShim() {
  if (canvasInit) {
    return;
  }
  const createImageData = (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
  });
  const createCanvas = (width, height) => ({
    width,
    height,
    getContext: () => ({
      createImageData: (w, h) => createImageData(w, h),
      getImageData: (_x, _y, w, h) => createImageData(w, h),
      putImageData: () => {},
      drawImage: () => {},
    }),
  });
  agPsd.initializeCanvas(createCanvas, createImageData);
  canvasInit = true;
}

// 🛡️ Védőkorlátok (a `psdImport` MAX_LAYERS/MAX_CANVAS_PX tükre): egy pathológikus
// doc (több ezer réteg / óriás vászon) elfogyasztaná a memóriát a PSD-építésnél.
const MAX_LAYERS = 400;
const MAX_CANVAS_PX = 8192; // a leghosszabb oldal px-plafonja

// 🎨 A `psdImport.BLEND_MAP` MEGFORDÍTÁSA: modell-blend → PSD-mód (ag-psd kulcs).
// A `BLEND_MAP` PSD→modell; itt modell→PSD-t építünk belőle. Mivel több PSD-mód
// képződhet UGYANARRA a modell-blendre (pl. 'linear dodge'→'screen'), a reverznél
// az ELSŐ (kanonikus) PSD-nevet választjuk — az 1:1 párok (multiply/screen/…)
// pontosan visszajönnek, a közelítők (linear dodge/burn) a kanonikus párra esnek.
const MODEL_TO_PSD = (() => {
  const out = {};
  for (const [psdMode, modelBlend] of Object.entries(BLEND_MAP)) {
    // csak az ELSŐ előfordulás nyer → kanonikus (multiply/screen/overlay/…)
    if (!(modelBlend in out)) {
      out[modelBlend] = psdMode;
    }
  }
  return out;
})();

/** modell-blend → PSD blend-mode (ismeretlen/hiányzó → 'normal'). */
function psdBlendMode(modelBlend) {
  if (!modelBlend || typeof modelBlend !== 'string') {
    return 'normal';
  }
  return MODEL_TO_PSD[modelBlend] || 'normal';
}

/** 0–1 közé szorított szám (hibás bemenet → `fallback`). */
function clamp01(v, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, n));
}

/**
 * A modell-doboz (0–1 KÖZÉPPONT + w/h) → PSD-pixel `{ left, top, right, bottom }`
 * — a `psdImport.normBox` FORDÍTOTTJA. A hiányzó méret (text/adjust → nincs box)
 * vagy degenerált eset → teljes vászon (0,0 … W,H). A pixel-határok egészre
 * kerekítve, a vásznon belülre szorítva nem szükséges (a PSD enged túllógást),
 * de a kerek-számokkal a roundtrip pixelpontos.
 */
function docBox(layer, canvasW, canvasH) {
  const pos = layer && layer.position;
  const hasBox =
    pos &&
    Number.isFinite(Number(pos.x)) &&
    Number.isFinite(Number(pos.y)) &&
    Number.isFinite(Number(layer.w)) &&
    Number.isFinite(Number(layer.h));
  if (!hasBox) {
    return { left: 0, top: 0, right: canvasW, bottom: canvasH };
  }
  const w = clamp01(layer.w, 1) * canvasW;
  const h = clamp01(layer.h, 1) * canvasH;
  const cx = clamp01(pos.x, 0.5) * canvasW;
  const cy = clamp01(pos.y, 0.5) * canvasH;
  const left = Math.round(cx - w / 2);
  const top = Math.round(cy - h / 2);
  return {
    left,
    top,
    right: left + Math.max(1, Math.round(w)),
    bottom: top + Math.max(1, Math.round(h)),
  };
}

/**
 * Egy PNG-buffer → ag-psd `imageData` (`{ width, height, data: Uint8ClampedArray }`,
 * RGBA, 4 bájt/px). A `pngjs` `PNG.sync.read`-del dekódol (pure JS). Visszaad
 * `null`, ha a PNG nem dekódolható (a hívó ezt a réteget üresen hagyja — a réteg
 * NEM vész el, csak pixel nélkül kerül a PSD-be).
 */
function pngToImageData(pngBuffer) {
  if (!pngBuffer || !pngBuffer.length) {
    return null;
  }
  let png;
  try {
    png = PNG.sync.read(Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer));
  } catch {
    return null;
  }
  if (!png || !png.width || !png.height || !png.data) {
    return null;
  }
  // a pngjs `data`-ja Buffer (RGBA) → ag-psd Uint8ClampedArray-t vár
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
  };
}

/**
 * Egy nem-group modell-réteg → ag-psd réteg-objektum (vagy `null`, ha a réteg
 * kihagyandó — pl. a RASZTERIZÁLÓ nem adott PNG-t). A `base` hordozza a közös
 * mezőket (név/opacity/blend/visibility/box); a `fetchLayerPng` injektált.
 *
 * - PhotoLayer: a réteg PNG-jét a `fetchLayerPng(src||uri)` adja → `pngToImageData`.
 * - ShapeLayer: ÉL-VEKTOR (VECTOR 03.2) — `shapeToVector` → `vectorMask`+`vectorFill`
 *   (+`vectorStroke`); a forma Photoshopban tovább-szerkeszthető vektor marad (NEM
 *   raszter). Ha a forma nem vektorizálható → raszter-fallback (lásd alább).
 * - TextLayer/FillLayer/AdjustmentImageLayer: RASZTER-réteg — a hívó
 *   `rasterizeLayerPng`-je (ha van) PNG-t ad vissza, különben a réteg kimarad.
 *   (A v1-ben NINCS szerkeszthető PSD-SZÖVEG — dokumentálva: a text-réteg a
 *   Photoshopban raszter-pixelként nyílik, nem típus-szerkeszthetően.)
 */
async function buildLayer(layer, ctx) {
  if (!layer || typeof layer !== 'object') {
    return null;
  }
  const box = docBox(layer, ctx.canvasW, ctx.canvasH);
  const base = {
    name: typeof layer.name === 'string' && layer.name ? layer.name : layerFallbackName(layer),
    left: box.left,
    top: box.top,
    opacity: clamp01(layer.opacity, 1),
    hidden: Boolean(layer.hidden),
    blendMode: psdBlendMode(layer.blendMode),
  };

  // 🖼️ fotó-réteg: a PNG-t az injektált fetch adja → RGBA imageData
  if (layer.kind === 'photo') {
    const srcRef = layer.src || layer.uri;
    if (!srcRef) {
      return null; // nincs honnan betölteni — a réteg kimarad (nincs pixel)
    }
    let png = null;
    try {
      png = await ctx.fetchLayerPng(srcRef);
    } catch {
      png = null; // a hívó dönthet szigorúbban; itt best-effort (a réteg kimarad)
    }
    const imageData = pngToImageData(png);
    if (!imageData) {
      return null;
    }
    // a PSD box-a a PNG tényleges mérete a left/top-tól (pixelpontos visszahelyezés)
    return {
      ...base,
      right: base.left + imageData.width,
      bottom: base.top + imageData.height,
      imageData,
    };
  }

  // 🔷 shape-réteg → PSD-VEKTOR (VECTOR 03.2): a rect/ellipse/line/arrow/star/path
  // formát `vectorMask` + `vectorFill` (+ `vectorStroke`) ÉL-VEKTORKÉNT őrizzük (NEM
  // raszterizáljuk) → Photoshopban tovább-szerkeszthető vektor-forma. A geometria a
  // `psdVector.shapeToVector`-ban (a svgExport matekjának pure-JS párja). A roundtrip
  // BIZONYÍTOTT (psdVector.test.js + a lenti export-teszt): a knots/fill/stroke pontosan
  // visszaolvasható. Ha a forma nem vektorizálható (null) → raszter-fallback alább.
  if (layer.kind === 'shape') {
    const vec = shapeToVector(layer, ctx.canvasW, ctx.canvasH);
    if (vec) {
      // a box-a a forma-doboz (docBox), a vektor-mask doc-pixel koordinátái mellé;
      // nincs `imageData` → a réteg tiszta vektor (a PS a maszkból rajzolja a formát).
      return {
        ...base,
        right: box.right,
        bottom: box.bottom,
        ...vec,
      };
    }
    // vec === null → a forma nem vektorizálható (pl. 1-pontos path) → raszter alább
  }

  // ✍️/🔷/🎚️ nem-fotó réteg (text/shape/fill/adjust): RASZTERIZÁLÁS. A hívó opcionális
  // `rasterizeLayerPng(layer, box)`-a a `server/imagedoc.js` per-réteg renderével
  // állít elő egy átlátszó PNG-t; ha nincs rasterizáló, a réteg kimarad (dokumentált
  // v1-korlát: az exportban a fotó-rétegek réteg-pixelként, a shape-ek ÉL-VEKTORként
  // garantáltak; a text/fill/adjust raszterként, ha van rasterizáló).
  if (typeof ctx.rasterizeLayerPng === 'function') {
    let png = null;
    try {
      png = await ctx.rasterizeLayerPng(layer, box);
    } catch {
      png = null;
    }
    const imageData = pngToImageData(png);
    if (imageData) {
      return {
        ...base,
        right: base.left + imageData.width,
        bottom: base.top + imageData.height,
        imageData,
      };
    }
  }
  return null;
}

/** emberi fallback-név a PSD-rétegnek a `kind`-ból (ha a modellen nincs `name`). */
function layerFallbackName(layer) {
  switch (layer && layer.kind) {
    case 'text':
      return 'Text';
    case 'shape':
      return 'Shape';
    case 'fill':
      return 'Fill';
    case 'adjust':
      return 'Adjustment';
    case 'photo':
    default:
      return 'Layer';
  }
}

/**
 * 🖼️ `ImageDoc` → PSD-buffer (réteg-megőrzéssel). PURE-ish mag: a `fetchLayerPng`
 * (fotó-rétegek) és az opcionális `rasterizeLayerPng` (nem-fotó rétegek) INJEKTÁLT.
 *
 * RÉTEG-FA: a lapos `doc.layers` + `doc.groups` (layer.groupId) → ag-psd fa:
 * minden `ImageGroup` egy `{ name, children: [...] }` group-réteg, a NEM-csoportos
 * rétegek a gyökéren maradnak. A rajzolási sorrend (alulról fölfelé) megőrződik:
 * a `doc.layers` SORRENDJÉT tartjuk, a csoportokat az ELSŐ tagjuk pozíciójánál
 * szúrjuk be (hogy a z-sorrend konzisztens legyen a renderrel).
 *
 * DOC-SZINTŰ EFFEKTEK (grain/vignette/grade/adjust): a v1 KIHAGYJA ezeket a
 * PSD-ből (determinisztikus döntés) — INDOK: a réteg-megőrzés a cél (szerkeszthető
 * rétegek Photoshopban), egy beégetett „korrekciós háttér-raszter” HAMIS WYSIWYG-et
 * adna (a Photoshop a doc-effekteket nem ismeri, a beégetett raszter viszont
 * duplázná a hatást egy újra-render/flatten-nél). A doc-effektek a RASZTER-exporton
 * (PNG/JPG/WebP a `/imagedoc`-on) élnek, ahol a flatten amúgy is megtörténik.
 * Így a PSD a NYERS, szerkeszthető rétegeket viszi, a doc-korrekció a kliens
 * `ImageDoc`-ban marad (újra-importnál visszajön). (A választást a roundtrip-teszt
 * is lefedi: a réteg-szám/arány konzisztens, nincs plusz „effekt-réteg”.)
 *
 * @param {ImageDoc} doc a kép-dokumentum (réteg-fa)
 * @param {object} opts
 * @param {(srcOrUri:string)=>Promise<Buffer>} opts.fetchLayerPng a fotó-réteg PNG-jét adó fetch
 * @param {(layer:object, box:object)=>Promise<Buffer|null>} [opts.rasterizeLayerPng]
 *        opcionális rasterizáló a nem-fotó rétegekhez (text/shape/fill/adjust)
 * @returns {Promise<Buffer>} a kész .psd bináris
 * @throws {Error} barátságos (magyar) hibaüzenettel (olvashatatlan doc / túl nagy /
 *         túl sok réteg / nincs exportálható réteg).
 */
async function buildPsdFromImageDoc(doc, opts = {}) {
  const fetchLayerPng = opts.fetchLayerPng;
  if (typeof fetchLayerPng !== 'function') {
    throw new Error('fetchLayerPng letöltő-függvény kötelező.');
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.layers)) {
    throw new Error('Érvénytelen kép-dokumentum (hiányzó réteg-lista).');
  }

  ensureCanvasShim();

  // 🖼️ vászon-méret: az EXPLICIT width×height a mérvadó (mint a renderernél,
  // imagedoc.js:191); hiányzó → az arányból egy alap-felbontással (9:16 → 1080 széles).
  const { canvasW, canvasH } = resolveCanvas(doc);
  if (canvasW < 1 || canvasH < 1) {
    throw new Error('A dokumentumnak nincs érvényes vászon-mérete.');
  }
  if (canvasW > MAX_CANVAS_PX || canvasH > MAX_CANVAS_PX) {
    throw new Error(
      `A vászon túl nagy (${canvasW}×${canvasH}; max ${MAX_CANVAS_PX}px/oldal) a PSD-exporthoz.`
    );
  }
  if (doc.layers.length > MAX_LAYERS) {
    throw new Error(`Túl sok réteg (${doc.layers.length} > ${MAX_LAYERS}) a PSD-exporthoz.`);
  }

  const ctx = {
    canvasW,
    canvasH,
    fetchLayerPng,
    rasterizeLayerPng: typeof opts.rasterizeLayerPng === 'function' ? opts.rasterizeLayerPng : null,
  };

  // 🗂️ csoport-térkép: a groupId → ag-psd group-réteg (children-tömbbel). A group
  // metaadata (név/opacity/hidden) a `doc.groups`-ból; ismeretlen groupId → gyökér.
  const groupDefs = new Map((Array.isArray(doc.groups) ? doc.groups : []).map((g) => [g.id, g]));
  const groupNodes = new Map(); // groupId → ag-psd group-réteg
  const rootChildren = []; // a gyökér réteg-sorrendje (groupok + gyökér-rétegek)

  for (const layer of doc.layers) {
    const built = await buildLayer(layer, ctx);
    if (!built) {
      continue; // nincs pixel/raszter → kimarad (nem adat-vesztés: nincs mit írni)
    }
    const gid = layer.groupId;
    if (gid && groupDefs.has(gid)) {
      let node = groupNodes.get(gid);
      if (!node) {
        const def = groupDefs.get(gid);
        node = {
          name: typeof def.name === 'string' && def.name ? def.name : 'Group',
          opened: !def.collapsed,
          hidden: Boolean(def.hidden),
          opacity: clamp01(def.opacity, 1),
          children: [],
        };
        groupNodes.set(gid, node);
        rootChildren.push(node); // a group az ELSŐ tagja pozíciójánál a gyökérbe
      }
      node.children.push(built);
    } else {
      rootChildren.push(built);
    }
  }

  if (rootChildren.length === 0) {
    throw new Error('Nincs exportálható réteg (üres vagy csak nem-rasterizálható rétegek).');
  }

  const psd = {
    width: canvasW,
    height: canvasH,
    children: rootChildren,
  };

  // `imageDataStyle: 'raw'` → a réteg-RGBA-t közvetlenül csomagolja (a shim-mel
  // natív canvas nélkül); a kompozit (flatten) előállítását KIHAGYJUK — a réteg-fa
  // a lényeg, és a kompozit-render natív canvas-t kívánna. (A Photoshop a
  // réteg-adatból úgyis újra-kompozitál; a thumbnailt is kihagyjuk.)
  const ab = agPsd.writePsd(psd, {
    imageDataStyle: 'raw',
    generateThumbnail: false,
    psb: false,
  });
  return Buffer.from(ab);
}

/** a vászon pixel-mérete a doc-ból (explicit W×H → az; különben arány + alap-felbontás). */
function resolveCanvas(doc) {
  if (doc.width && doc.height) {
    return { canvasW: Math.round(Number(doc.width)), canvasH: Math.round(Number(doc.height)) };
  }
  const [aw, ah] = String(doc.aspectRatio || '9:16')
    .split(':')
    .map((v) => Number(v) || 1);
  // alap-felbontás: a rövidebb logika a renderer canvasSize-éval egyezik (H=1280 alap),
  // de itt a HOSSZABB oldalt 1080-ra célozzuk a kerek PSD-vászonért.
  const base = 1080;
  if (aw >= ah) {
    const W = base;
    const H = Math.max(1, Math.round((W * ah) / aw));
    return { canvasW: W, canvasH: H };
  }
  const H = base;
  const W = Math.max(1, Math.round((H * aw) / ah));
  return { canvasW: W, canvasH: H };
}

module.exports = {
  buildPsdFromImageDoc,
  psdBlendMode,
  docBox,
  pngToImageData,
  resolveCanvas,
  MODEL_TO_PSD,
  MAX_LAYERS,
  MAX_CANVAS_PX,
};
