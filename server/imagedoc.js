// 🎨 Kép-dokumentum rasterizáló (Creative Canvas V1): réteg-fa → PNG.
//
// ELV: a formákat és a feliratokat UGYANAZOK a generátorok rajzolják, mint az
// idővonalon (text-render.js) — nem külön HTML-lel, mert két külön generátor
// előbb-utóbb szétcsúszna, és a képben mást látnál, mint a videóban. A rétegek
// külön PNG-be mennek, majd ffmpeg-gel, RAJZOLÁSI SORRENDBEN egymásra
// komponálódnak; a fotó-rétegek skálázása/vágása is itt történik.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { adjustChain } = require('./render');
const { filterChain, maskGradientFilter, shadowSilhouette, glowSilhouette } = require('./imageFilters');
const { renderShapePngs, renderTextPngs } = require('./text-render');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// 🎨 réteg-keverési mód → ffmpeg `blend` all_mode (a BlendMode típusból). A hiányzó/'normal' = source-over.
const BLEND_FF = {
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  hardlight: 'hardlight',
  softlight: 'softlight',
  colordodge: 'dodge',
  colorburn: 'burn',
};

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 1 << 26 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).slice(-1500))) : resolve()
    );
  });
}

/** a vászon mérete az arányból (a rövidebb oldal a megadott felbontás) */
function canvasSize(aspectRatio, height) {
  const [aw, ah] = String(aspectRatio || '9:16')
    .split(':')
    .map((v) => Number(v) || 1);
  const H = Math.round(height / 2) * 2;
  const W = Math.round((H * aw) / ah / 2) * 2;
  return { w: W, h: H };
}

/** páros px-re kerekített, [16, 4096] közé zárt méret (a kép-editor szabad W×H-ja) */
function evenClamp(n) {
  return Math.round(Math.max(16, Math.min(4096, Number(n) || 0)) / 2) * 2;
}

/** a vászon mérete: ha a doc EXPLICIT width×height-ot hordoz, AZ a mérvadó
 *  (szabad méret, kép-editor); különben a régi arány+magasság út. */
function docCanvas(doc, height) {
  if (doc.width && doc.height) {
    return { w: evenClamp(doc.width), h: evenClamp(doc.height) };
  }
  return canvasSize(doc.aspectRatio, height);
}

/** a réteg rajzolódik-e (a klienssel AZONOS szabály — lásd imageDoc.ts) */
function isVisible(layer) {
  return !layer.hidden && (layer.opacity ?? 1) > 0.001;
}

/**
 * A `fill` réteg úgy megy át a forma-generátoron, mint egy vászon-méretű
 * téglalap — így a gradiens-kezelés is közös, nem kell külön ág.
 */
function fillAsShape(layer) {
  return {
    kind: 'shape',
    id: layer.id,
    shape: 'rectangle',
    position: { x: 0.5, y: 0.5 },
    w: 1,
    h: 1,
    fill: layer.fill,
    fillGradient: layer.fillGradient,
    gradient: layer.gradient,
  };
}

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

/**
 * A kimeneti formátum ffmpeg-argumentumai + kiterjesztés. A `quality` 0–1 (1 = a
 * legjobb). PNG = veszteségmentes, alfával; JPG = nincs alfa (az átlátszó rész
 * feketére lapul), q:v 2–31; WebP = alfás, 0–100 minőség.
 */
function imageOutputArgs(format, quality) {
  const q = Math.max(0, Math.min(1, Number.isFinite(quality) ? quality : 0.92));
  switch (String(format || 'png').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      // 2 (legjobb) … 31 (legrosszabb); az alfát le kell lapítani
      return { ext: 'jpg', args: ['-pix_fmt', 'yuv420p', '-q:v', String(Math.round(2 + (1 - q) * 29))] };
    case 'webp':
      return { ext: 'webp', args: ['-c:v', 'libwebp', '-lossless', '0', '-quality', String(Math.round(q * 100))] };
    case 'png':
    default:
      return { ext: 'png', args: [] };
  }
}

/** 🏷️ Kötelező free-vízjel text-rétege (alul-középen, félig-átlátszó). A text-render
 * lánc (Chromium) rendereli, mint bármely text-réteget → a legfelső rétegként komponálódik. */
function watermarkLayer() {
  return {
    kind: 'text',
    id: 'wm-remix',
    text: 'Made with ReMix',
    color: '#ffffff',
    fontSize: 3.2, // a vászon-MAGASSÁG %-a
    fontWeight: 'bold',
    position: { x: 0.5, y: 0.95 },
    opacity: 0.72,
  };
}

async function renderImageDoc(doc, height, workDir, opts = {}) {
  const canvas = docCanvas(doc, height);
  const layers = (doc.layers ?? []).filter(isVisible);
  if (layers.length === 0) {
    throw new Error('A dokumentumnak nincs látható rétege.');
  }
  // 🏷️ free-vízjel: a szerver-hiteles tier szerint (opts.watermark) a LEGFELSŐ rétegként
  if (opts.watermark) {
    layers.push(watermarkLayer());
  }

  // 1) a forma- és szöveg-rétegek a MEGLÉVŐ generátorokkal PNG-be
  const shapeLike = layers
    .filter((l) => l.kind === 'shape' || l.kind === 'fill')
    .map((l) => (l.kind === 'fill' ? fillAsShape(l) : { ...l, kind: 'shape' }));
  const textLike = layers
    .filter((l) => l.kind === 'text')
    .map((l) => ({ ...l, kind: 'text', animation: 'none', start: 0, duration: 1 }));

  const rendered = new Map(); // layer.id → png útvonal
  if (shapeLike.length > 0) {
    for (const entry of await renderShapePngs(shapeLike, canvas, workDir)) {
      rendered.set(entry.clip.id, entry.states[0].file);
    }
  }
  if (textLike.length > 0) {
    for (const entry of await renderTextPngs(textLike, canvas, workDir)) {
      rendered.set(entry.clip.id, entry.states[0].file);
    }
  }

  // 2) ffmpeg-kompozit rajzolási sorrendben
  const inputs = ['-f', 'lavfi', '-i', `color=black@0:s=${canvas.w}x${canvas.h}`];
  const filters = [];
  let last = '[0:v]';
  let idx = 1;

  filters.push(`${last}format=rgba[base]`);
  last = '[base]';

  for (const layer of layers) {
    const opacity = Math.min(1, Math.max(0, layer.opacity ?? 1));
    let prepared;

    if (layer.kind === 'photo') {
      if (!layer.uri || !fs.existsSync(layer.uri)) {
        continue; // hiányzó média — a réteg kimarad, a többi mehet
      }
      inputs.push('-i', layer.uri);
      const boxW = Math.max(2, Math.round((layer.w ?? 1) * canvas.w));
      const boxH = Math.max(2, Math.round((layer.h ?? 1) * canvas.h));
      // 'cover' kitölti a keretet (a túllógó rész levágódik), 'contain' belefér
      const fit =
        layer.fit === 'contain'
          ? `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,` +
            `pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase,` +
            `crop=${boxW}:${boxH}`;
      // 🔁 tükrözés a forgatás ELŐTT (helyi tér) — a preview scaleX/Y-nal egyezik
      const flip = `${layer.flipH ? ',hflip' : ''}${layer.flipV ? ',vflip' : ''}`;
      const rotate = layer.rotation
        ? `,rotate=${((layer.rotation * Math.PI) / 180).toFixed(5)}:c=black@0:ow=rotw(iw):oh=roth(ih)`
        : '';
      prepared = `p${idx}`;
      filters.push(
        `[${idx}:v]${fit},format=rgba${adjustChain(layer)}${filterChain(layer.filters)}${flip}${rotate}` +
          `${maskGradientFilter(layer.maskGradient)},colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;
    } else {
      const png = rendered.get(layer.id);
      if (!png || !fs.existsSync(png)) {
        continue;
      }
      inputs.push('-i', png);
      prepared = `p${idx}`;
      // 🔄 forgatás + 🔁 tükrözés (kép-stúdió) a forma/szöveg PNG-n — a fotó-ág
      // mintája; a fill (teljes vászon) nem forog/tükröződik, csak az elhelyezett rétegek
      const flip =
        layer.kind !== 'fill' ? `${layer.flipH ? ',hflip' : ''}${layer.flipV ? ',vflip' : ''}` : '';
      const rot =
        layer.kind !== 'fill' && layer.rotation
          ? `,rotate=${((layer.rotation * Math.PI) / 180).toFixed(5)}:c=black@0:ow=rotw(iw):oh=roth(ih)`
          : '';
      filters.push(
        `[${idx}:v]format=rgba${flip}${rot}${maskGradientFilter(layer.maskGradient)},colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;
    }

    // elhelyezés: a réteg KÖZÉPPONTJA a `position`, a fill a teljes vászon
    const out = `c${idx}`;
    const posX = layer.kind === 'fill' ? '0' : `${Math.round((layer.position?.x ?? 0.5) * canvas.w)}-overlay_w/2`;
    const posY = layer.kind === 'fill' ? '0' : `${Math.round((layer.position?.y ?? 0.5) * canvas.h)}-overlay_h/2`;

    // ✨ külső ragyogás (pozícionált rétegre): paddelt, színes sziluett → MÖGÉ overlay (középre).
    if (layer.outerGlow && layer.kind !== 'fill') {
      const gsig = Math.max(2, Math.round(canvas.w * 0.02));
      const gm = gsig * 3;
      const gout = `gl${idx}`;
      filters.push(`[${prepared}]split[plg${idx}][psg${idx}]`);
      filters.push(`[psg${idx}]${glowSilhouette(gm, gsig, 0.85)}[gll${idx}]`);
      filters.push(`${last}[gll${idx}]overlay=${posX}:${posY}[${gout}]`);
      last = `[${gout}]`;
      prepared = `plg${idx}`;
    }

    // 🌑 vetett árnyék (pozícionált rétegre): a prepared másolatából sziluett → MÖGÉ overlay eltolva.
    if (layer.dropShadow && layer.kind !== 'fill') {
      const sig = Math.max(1, Math.round(canvas.w * 0.012));
      const dx = Math.round(canvas.w * 0.02);
      const dy = Math.round(canvas.h * 0.02);
      const sout = `sh${idx}`;
      filters.push(`[${prepared}]split[pl${idx}][ps${idx}]`);
      filters.push(`[ps${idx}]${shadowSilhouette(sig, 0.5)}[shl${idx}]`);
      filters.push(`${last}[shl${idx}]overlay=${posX}+${dx}:${posY}+${dy}[${sout}]`);
      last = `[${sout}]`;
      prepared = `pl${idx}`; // a réteg a split másik fele (az árnyék-sziluett nem fogyasztja el)
    }

    const mode = BLEND_FF[layer.blendMode];
    if (!mode) {
      // normál (source-over)
      filters.push(`${last}[${prepared}]overlay=${posX}:${posY}[${out}]`);
    } else {
      // 🎨 keverési mód: a réteget teljes átlátszó vászonra helyezzük (Lfull), a base-szel
      // `blend`-eljük a módnak megfelelően, majd a réteg ALFÁJÁVAL maszkolva a base fölé mergeljük
      // (így a blend csak ott hat, ahol a réteg átlátszatlan; az opacity az alfában benne van).
      inputs.push('-f', 'lavfi', '-i', `color=black@0:s=${canvas.w}x${canvas.h}`);
      const tIdx = idx;
      idx += 1;
      filters.push(`[${tIdx}:v]format=rgba[t${tIdx}]`);
      filters.push(`[t${tIdx}][${prepared}]overlay=${posX}:${posY}[Lf${tIdx}]`);
      filters.push(`[Lf${tIdx}]split[Lb${tIdx}][La${tIdx}]`);
      filters.push(`${last}split[bb${tIdx}][bc${tIdx}]`);
      // ⚠️ a `blend` RGB-SÍKOKON számoljon (gbrp), különben YUV-ban keverne → színhiba
      filters.push(`[bb${tIdx}]format=gbrp[bbf${tIdx}]`);
      filters.push(`[Lb${tIdx}]format=gbrp[Lbf${tIdx}]`);
      filters.push(`[bbf${tIdx}][Lbf${tIdx}]blend=all_mode=${mode}:shortest=1[bl${tIdx}]`);
      filters.push(`[La${tIdx}]alphaextract[am${tIdx}]`);
      filters.push(`[bc${tIdx}][bl${tIdx}][am${tIdx}]maskedmerge[${out}]`);
    }
    last = `[${out}]`;
  }

  const { ext, args: fmtArgs } = imageOutputArgs(opts.format, opts.quality);
  const outFile = path.join(workDir, `imagedoc.${ext}`);
  await run([
    '-hide_banner',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    last,
    '-frames:v',
    '1',
    ...fmtArgs,
    '-y',
    outFile,
  ]);
  return outFile;
}

module.exports = { renderImageDoc, canvasSize, imageOutputArgs, imageDocGuard, MAX_LAYERS, MAX_TOTAL_POINTS };
