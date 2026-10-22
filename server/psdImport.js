// 🖼️ PSD-import mag (IMAGE 01.1): Photoshop .psd → `ImageDoc` réteg-fa.
//
// ELV: a parser-mag TISZTA (injektált `makeId`/`uploadLayerPng` → tesztelhető
// valós tár + valós feltöltés nélkül). Az `ag-psd` beolvassa a réteg-fát
// (`useImageData` → rétegenkénti nyers RGBA), a raszter-rétegeket a `pngjs`
// pure-JS enkóderrel PNG-vé kódoljuk (NINCS natív canvas-build → remote-barát),
// és a kész PNG-t a hívó `uploadLayerPng`-je tölti a média-tárba. A réteg-fa a
// lapos `ImageDoc`-modellre (layers[] + groups[], `layer.groupId`) képződik — a
// `src/types/project.ts` `PhotoLayer`/`TextLayer`/`ImageGroup`/`ImageLayerBase`
// szerint; a pozíciók a VÁSZON-MÉRETRE 0–1-re normalizálva (a `svgImport.ts`
// viewBox→0–1 mintája). SOHA nem vész el réteg: amit nem ismerünk szövegként,
// raszter-fallbackként megőrizzük.

const agPsd = require('ag-psd');
const { PNG } = require('pngjs');

// 🧩 PURE-JS canvas-shim az ag-psd olvasójához. Az `ag-psd` a réteg-csatornák
// visszaépítéséhez `createImageData`-t hív, ami alapból natív canvas-t igényelne
// (node-canvas / böngésző). Mi NEM akarunk natív buildet (remote/CI-barát), ezért
// egy minimális, tiszta-JS ImageData-gyárat regisztrálunk: a reader csak az
// `{ width, height, data: Uint8ClampedArray }` alakot és egy no-op 2D-kontextust
// vár. A `useImageData: true` így nyers RGBA-t ad vissza natív függőség nélkül.
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

// 🛡️ Védőkorlátok: egy pathológikus PSD (több ezer réteg / óriás vászon)
// elfogyasztaná a memóriát a PNG-enkódolásnál. A limit-minta a `imagedoc.js:137`
// (`MAX_LAYERS`) körüli védőkorláté — inkább BESZÉDES (magyar) hiba, mint crash.
const MAX_LAYERS = 400;
const MAX_CANVAS_PX = 8192; // a leghosszabb oldal px-plafonja (readPsd már dekódolt)

// 🎨 PSD blend-mode (ag-psd kulcs) → a modell `BlendMode`-enumja. Az ismeretlen
// (ill. a 'normal'/'pass through') → nincs leképezés (a réteg normál source-over).
// A modell-enum: multiply/screen/overlay/darken/lighten/difference/exclusion/
// hardlight/softlight/colordodge/colorburn (lásd `src/types/project.ts` BlendMode).
const BLEND_MAP = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  'hard light': 'hardlight',
  'soft light': 'softlight',
  'color dodge': 'colordodge',
  'color burn': 'colorburn',
  // 'linear dodge' (add) ≈ screen, 'linear burn' ≈ multiply — közeli leképezés
  'linear dodge': 'screen',
  'linear burn': 'multiply',
};

/** PSD blend-mode → modell-blend (ismeretlen/normal → `null` = source-over). */
function mapBlendMode(mode) {
  if (!mode || typeof mode !== 'string') {
    return null;
  }
  return BLEND_MAP[mode.toLowerCase().trim()] || null;
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
 * Egy ag-psd réteg nyers RGBA ImageData-ja → PNG-buffer (pure JS, pngjs).
 * Az `imageData` egy `{ width, height, data: Uint8ClampedArray }` (RGBA, 4 bájt/px).
 * Visszaad `null`, ha nincs értelmezhető pixeladat (üres/al-réteg).
 */
function imageDataToPng(imageData) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    return null;
  }
  const { width, height, data } = imageData;
  if (width < 1 || height < 1 || data.length < width * height * 4) {
    return null;
  }
  const png = new PNG({ width, height });
  // a pngjs `data`-ja is RGBA — másoljuk át (Buffer-be), a Uint8ClampedArray-ből
  png.data = Buffer.from(data.buffer, data.byteOffset, data.length);
  return PNG.sync.write(png);
}

/**
 * A réteg box-a (left/top/right/bottom, PSD-pixel) → a modell doboza:
 * KÖZÉPPONT + méret, a vászon-méretre 0–1-re NORMALIZÁLVA (a `svgImport.ts`
 * `boxToDoc` mintája). Üres/degenerált box → egész vászon (középre, 1×1).
 */
function normBox(layer, canvasW, canvasH) {
  const left = Number(layer.left) || 0;
  const top = Number(layer.top) || 0;
  const right = Number(layer.right) || 0;
  const bottom = Number(layer.bottom) || 0;
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  if (w <= 0 || h <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { position: { x: 0.5, y: 0.5 }, w: 1, h: 1 };
  }
  const cx = left + w / 2;
  const cy = top + h / 2;
  return {
    position: {
      x: clamp01(cx / canvasW, 0.5),
      y: clamp01(cy / canvasH, 0.5),
    },
    w: clamp01(w / canvasW, 1),
    h: clamp01(h / canvasH, 1),
  };
}

/**
 * Egy PSD szöveg-réteg stílus-kinyerése → a modell `TextLayer`-mezői, VAGY
 * `null`, ha a szöveg nem nyerhető ki (akkor a hívó raszter-fallbackre vált).
 * A font-méret a vászon-MAGASSÁG %-ára képződik (a modell `fontSize`-konvenciója,
 * lásd `TextClip.fontSize` — „az előnézet magasságának %-a").
 */
function extractText(layer, canvasH) {
  const txt = layer.text;
  if (!txt || typeof txt.text !== 'string' || txt.text.trim() === '') {
    return null;
  }
  const style = (txt.style && typeof txt.style === 'object' && txt.style) || {};
  // PSD font-méret px → a vászon-MAGASSÁG %-a (a modell konvenciója)
  const px = Number(style.fontSize) || 0;
  const fontSize = px > 0 && canvasH > 0 ? clamp01(px / canvasH) * 100 : 7;
  // szín: a PSD stílus `fillColor` {r,g,b} 0–255 → hex (hiányzó = fehér)
  const fc = style.fillColor;
  const color =
    fc && typeof fc === 'object'
      ? rgbToHex(fc.r, fc.g, fc.b)
      : '#ffffff';
  const bold = /bold|black|heavy|semibold/i.test(String(style.font?.name || ''));
  return {
    text: txt.text,
    color,
    backgroundColor: null,
    fontSize: Math.max(1, Math.min(40, fontSize)),
    fontWeight: bold ? 'bold' : 'normal',
  };
}

/** 0–255 r/g/b → `#rrggbb` (hiányzó komponens = 0). */
function rgbToHex(r, g, b) {
  const h = (v) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
    return n.toString(16).padStart(2, '0');
  };
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * A PSD réteg-fa (gyermek-rétegek + group-ok) bejárása → lapos `layers` +
 * `groups`. A PSD fában egy group egy `children`-tömböt tartó réteg (`name` +
 * esetleg `opened`); a tag-rétegek kapják a `groupId`-t (lapos modell, v1 NINCS
 * beágyazás — a beágyazott csoportokat is EGY szint-re lapítjuk). A `ctx` hordozza
 * a `makeId`/`uploadLayerPng`-t, a vászon-méretet és az eredmény-tömböket.
 */
async function walkLayers(children, ctx, groupId) {
  for (const layer of children || []) {
    if (ctx.layers.length >= MAX_LAYERS) {
      // a guard a hívóban (parsePsdToImageDoc) előre levág — ez csak védőháló
      break;
    }
    const isGroup = Array.isArray(layer.children);
    if (isGroup) {
      // 🗂️ csoport → lapos `ImageGroup` + a tagok groupId-ja. A beágyazott group
      // is ide lapul (v1 lapos modell): a tagok a LEGKÖZELEBBI group-hoz kötődnek.
      const gid = ctx.makeId('grp');
      ctx.groups.push({
        id: gid,
        name: typeof layer.name === 'string' && layer.name ? layer.name : 'Csoport',
        ...(layer.hidden ? { hidden: true } : {}),
        ...(layer.opacity != null && layer.opacity < 1 ? { opacity: clamp01(layer.opacity) } : {}),
      });
      await walkLayers(layer.children, ctx, gid);
      continue;
    }
    const built = await buildLayer(layer, ctx, groupId);
    if (built) {
      ctx.layers.push(built);
    }
  }
}

/**
 * Egy nem-group PSD réteg → modell-réteg (`TextLayer` vagy `PhotoLayer`). SOHA nem
 * vész el réteg: ha a szöveg-kinyerés nem megy, raszter-fallback; ha a raszter-
 * pixeladat is hiányzik (üres réteg), `null` (átugorjuk — ez nem adat-vesztés,
 * mert nincs mit megőrizni).
 */
async function buildLayer(layer, ctx, groupId) {
  const name = typeof layer.name === 'string' && layer.name ? layer.name : undefined;
  const base = {
    id: ctx.makeId('lyr'),
    ...(name ? { name } : {}),
    ...(layer.hidden ? { hidden: true } : {}),
    opacity: clamp01(layer.opacity, 1),
    ...(mapBlendMode(layer.blendMode) ? { blendMode: mapBlendMode(layer.blendMode) } : {}),
    ...(groupId ? { groupId } : {}),
  };

  // ✍️ szöveg-réteg: ha a `text` kinyerhető → TextLayer; a POZÍCIÓ a box középpontja
  if (layer.text) {
    const text = extractText(layer, ctx.canvasH);
    if (text) {
      const box = normBox(layer, ctx.canvasW, ctx.canvasH);
      return {
        ...base,
        kind: 'text',
        ...text,
        position: box.position,
      };
    }
    // ha nem nyerhető ki a szöveg, NEM dobjuk el → esünk a raszter-fallbackre
  }

  // 🖼️ raszter-réteg (és a szöveg-fallback is): a nyers RGBA → PNG → feltöltés
  const png = imageDataToPng(layer.imageData || layer.canvas?.imageData);
  if (!png) {
    return null; // nincs pixeladat (üres réteg / csak effekt) — nincs mit megőrizni
  }
  const { src, uri } = await ctx.uploadLayerPng(png, base.id);
  const box = normBox(layer, ctx.canvasW, ctx.canvasH);
  return {
    ...base,
    kind: 'photo',
    uri: uri || src || '',
    ...(src ? { src } : {}),
    position: box.position,
    w: box.w,
    h: box.h,
    // 'stretch' = a box-ra nyújtva — a PSD box PONTOSAN a réteg pixel-mérete,
    // tehát a vászon-normalizált dobozba nyújtás pixelpontos visszahelyezés
    fit: 'stretch',
  };
}

/**
 * 🖼️ PSD-buffer → `ImageDoc` (réteg-megőrzéssel). PURE-ish mag: a `makeId` és az
 * `uploadLayerPng` INJEKTÁLT (→ tesztelhető valós tár nélkül).
 *
 * @param {Buffer|ArrayBuffer} buffer a .psd nyers tartalma
 * @param {object} opts
 * @param {(prefix:string)=>string} opts.makeId azonosító-generátor (prefix-szel)
 * @param {(png:Buffer, layerId:string)=>Promise<{src?:string, uri?:string}>} opts.uploadLayerPng
 *        a réteg-PNG feltöltője → a réteg `src`/`uri`-ja
 * @param {string} [opts.name] a dokumentum neve (hiányzó = 'PSD import')
 * @returns {Promise<ImageDoc>}
 * @throws {Error} barátságos (magyar) hibaüzenettel, ha a PSD olvashatatlan /
 *         túl sok réteg / túl nagy vászon (a UI ezt mutatja; nem crash).
 */
async function parsePsdToImageDoc(buffer, opts = {}) {
  const makeId = typeof opts.makeId === 'function' ? opts.makeId : defaultMakeId();
  const uploadLayerPng = opts.uploadLayerPng;
  if (typeof uploadLayerPng !== 'function') {
    throw new Error('uploadLayerPng feltöltő-függvény kötelező.');
  }

  ensureCanvasShim();
  let psd;
  try {
    const buf = buffer instanceof ArrayBuffer ? buffer : toArrayBuffer(buffer);
    psd = agPsd.readPsd(buf, {
      useImageData: true, // rétegenkénti nyers RGBA (nem canvas → remote-barát)
      skipCompositeImageData: true, // a lapos kompozitra nincs szükség (réteg-fa kell)
      skipThumbnail: true,
    });
  } catch (err) {
    throw new Error(`A PSD-fájl nem olvasható: ${String(err && err.message ? err.message : err).slice(0, 160)}`);
  }

  const canvasW = Math.round(Number(psd.width) || 0);
  const canvasH = Math.round(Number(psd.height) || 0);
  if (canvasW < 1 || canvasH < 1) {
    throw new Error('A PSD-fájlnak nincs érvényes vászon-mérete.');
  }
  if (canvasW > MAX_CANVAS_PX || canvasH > MAX_CANVAS_PX) {
    throw new Error(
      `A PSD vászna túl nagy (${canvasW}×${canvasH}; max ${MAX_CANVAS_PX}px/oldal). Méretezd át exportálás előtt.`
    );
  }

  // 🛡️ réteg-szám gát a feltöltések ELŐTT (rekurzívan számolva a nem-group rétegeket)
  const total = countLeafLayers(psd.children);
  if (total > MAX_LAYERS) {
    throw new Error(`Túl sok réteg a PSD-ben (${total} > ${MAX_LAYERS}). Egyesíts vagy lapíts rétegeket az importhoz.`);
  }

  const ctx = { makeId, uploadLayerPng, canvasW, canvasH, layers: [], groups: [] };
  await walkLayers(psd.children, ctx, undefined);

  if (ctx.layers.length === 0) {
    throw new Error('A PSD-ben nincs importálható réteg (üres vagy csak effekt-rétegek).');
  }

  // 🖼️ vászon-arány: a 3 kanonikus arányhoz közelítünk (a `width`/`height` a
  // mérvadó — a renderer `docCanvas`-ja az explicit W×H-t használja, lásd imagedoc.js:191)
  const doc = {
    id: makeId('doc'),
    name: typeof opts.name === 'string' && opts.name ? opts.name : 'PSD import',
    aspectRatio: nearestAspect(canvasW, canvasH),
    width: canvasW,
    height: canvasH,
    format: 'raster',
    layers: ctx.layers,
    ...(ctx.groups.length ? { groups: ctx.groups } : {}),
  };
  return doc;
}

/** rekurzív levél-réteg (nem-group) számlálás a guardhoz. */
function countLeafLayers(children) {
  let n = 0;
  for (const l of children || []) {
    if (Array.isArray(l.children)) {
      n += countLeafLayers(l.children);
    } else {
      n += 1;
    }
  }
  return n;
}

/** a legközelebbi kanonikus arány a vászon-méretből (16:9 / 9:16 / 1:1). */
function nearestAspect(w, h) {
  const r = w / h;
  const cands = [
    { a: '16:9', r: 16 / 9 },
    { a: '9:16', r: 9 / 16 },
    { a: '1:1', r: 1 },
  ];
  let best = cands[0];
  let bestD = Infinity;
  for (const c of cands) {
    const d = Math.abs(Math.log(r) - Math.log(c.r));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.a;
}

/** Node Buffer → a buffer-nézetnek megfelelő ArrayBuffer-szelet (ag-psd ezt kéri). */
function toArrayBuffer(buf) {
  if (!buf) {
    throw new Error('Üres PSD-buffer.');
  }
  if (buf instanceof Uint8Array) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return buf;
}

/** tartalék id-generátor (ha a hívó nem ad) — a teszt/kliens úgyis injektál. */
function defaultMakeId() {
  let n = 0;
  return (prefix) => `${prefix}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
  parsePsdToImageDoc,
  mapBlendMode,
  normBox,
  extractText,
  imageDataToPng,
  nearestAspect,
  countLeafLayers,
  MAX_LAYERS,
  MAX_CANVAS_PX,
  BLEND_MAP,
};
