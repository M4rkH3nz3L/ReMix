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
const { gradeFilterChain } = require('./grades');
const {
  filterChain,
  maskGradientFilter,
  shadowSilhouette,
  glowSilhouette,
  strokeSilhouette,
  perspectiveFilter,
  gradientMapFilter,
  healChain,
} = require('./imageFilters');
const { maskGrayChain, maskToBox } = require('./imageMask');
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
  // 🗂️ csoportok: a rejtett csoport tagjai kimaradnak, az opacity a tagokra RÁszorzódik
  const groups = new Map((doc.groups ?? []).map((g) => [g.id, g]));
  const groupHidden = (l) => l.groupId && groups.get(l.groupId)?.hidden;
  const groupOpacity = (l) => (l.groupId ? Math.max(0, Math.min(1, Number(groups.get(l.groupId)?.opacity ?? 1))) : 1);
  const layers = (doc.layers ?? []).filter((l) => isVisible(l) && !groupHidden(l));
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
  let maskSeq = 0; // 🎭 maszk-belső címke-számláló (NEM input → az idx-et nem növeli)

  for (const layer of layers) {
    // 🎚️ korrekció-réteg: nincs saját tartalma — az ALATTA felépült kompozitra (last) hat.
    // `mask` esetén csak a maszkolt régióra (a korrigált alfa = maszk → az eredeti fölé overlay).
    if (layer.kind === 'adjust') {
      const corr = (gradeFilterChain(layer.grade) + adjustChain({ adjust: layer.adjust })).replace(/^,/, '');
      if (!corr) {
        continue;
      }
      const ai = maskSeq;
      maskSeq += 1;
      if (layer.mask && layer.mask.shape) {
        filters.push(`${last}format=rgba,split[ao${ai}][ax${ai}]`);
        filters.push(`[ax${ai}]${corr},format=rgba[acx${ai}]`);
        filters.push(maskGrayChain(layer.mask, canvas.w, canvas.h, `[amg${ai}]`));
        filters.push(`[acx${ai}]split[acc${ai}][aca${ai}]`);
        filters.push(`[aca${ai}]alphaextract[acae${ai}]`);
        filters.push(`[acae${ai}][amg${ai}]blend=all_mode=multiply:shortest=1[acam${ai}]`);
        filters.push(`[acc${ai}][acam${ai}]alphamerge[acadjA${ai}]`);
        filters.push(`[ao${ai}][acadjA${ai}]overlay=0:0[adj${ai}]`);
      } else {
        filters.push(`${last}${corr}[adj${ai}]`);
      }
      last = `[adj${ai}]`;
      continue;
    }

    const opacity = Math.min(1, Math.max(0, layer.opacity ?? 1)) * groupOpacity(layer);
    let prepared;

    if (layer.kind === 'photo') {
      if (!layer.uri || !fs.existsSync(layer.uri)) {
        continue; // hiányzó média — a réteg kimarad, a többi mehet
      }
      inputs.push('-i', layer.uri);
      const boxW = Math.max(2, Math.round((layer.w ?? 1) * canvas.w));
      const boxH = Math.max(2, Math.round((layer.h ?? 1) * canvas.h));
      // 'cover' kitölti a keretet (a túllógó rész levágódik), 'contain' belefér,
      // 'stretch' NEM-arányosan a keretre nyújt (szabad transzform — torzíthat)
      const fit =
        layer.fit === 'contain'
          ? `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,` +
            `pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : layer.fit === 'stretch'
            ? `scale=${boxW}:${boxH}`
            : `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase,` +
              `crop=${boxW}:${boxH}`;
      // 🔁 tükrözés a forgatás ELŐTT (helyi tér) — a preview scaleX/Y-nal egyezik
      const flip = `${layer.flipH ? ',hflip' : ''}${layer.flipV ? ',vflip' : ''}`;
      const rotate = layer.rotation
        ? `,rotate=${((layer.rotation * Math.PI) / 180).toFixed(5)}:c=black@0:ow=rotw(iw):oh=roth(ih)`
        : '';
      // 🎞️ saját 3D LUT (.cube): a feltöltött fájlnak nincs .cube kiterjesztése (multer
      // generált név) → workDir-be másoljuk .cube-ként, hogy az ffmpeg felismerje. A grade UTÁN.
      let lutFrag = '';
      if (layer.lut && fs.existsSync(layer.lut)) {
        try {
          const lutFile = path.join(workDir, `lut${idx}.cube`);
          fs.copyFileSync(layer.lut, lutFile);
          lutFrag = `,lut3d='${lutFile.replace(/'/g, "'\\''")}'`;
        } catch {
          lutFrag = '';
        }
      }
      // 📐 perspektíva/3D-dőlés a box-méretű fotóra (a filterek UTÁN, a flip/rotate ELŐTT)
      const persp = perspectiveFilter(layer.perspectiveX, layer.perspectiveY, boxW, boxH);
      // 🎨 gradient-map (egyedi-színű duotone) — a grade/lut UTÁN, a struktúra-szűrők ELŐTT
      const gmap = layer.gradientMap
        ? gradientMapFilter(layer.gradientMap.shadow, layer.gradientMap.highlight)
        : '';
      // 🩹 folt-javítás: a nyers (fit-elt) fotón, a korrekció/szűrők ELŐTT (delogo a környezetből interpolál)
      const heal = healChain(layer.heal, boxW, boxH);
      prepared = `p${idx}`;
      filters.push(
        `[${idx}:v]${fit}${heal},format=rgba${adjustChain(layer)}${gradeFilterChain(layer.grade)}${lutFrag}${gmap}${filterChain(layer.filters)}${persp}${flip}${rotate}` +
          `${maskGradientFilter(layer.maskGradient)},colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;

      // 🎯 kijelölés-alapú (lokális) korrekció: a grade/adjust CSAK a maszk-régión BELÜL hat.
      // A box-méretű prepared két példánya (eredeti + korrigált) a box-lokális maszkkal maskedmerge-elve.
      const la = layer.localAdjust;
      if (la && la.mask && la.mask.shape) {
        const corr = (gradeFilterChain(la.grade) + adjustChain({ adjust: la.adjust })).replace(/^,/, '');
        if (corr) {
          const li = maskSeq;
          maskSeq += 1;
          const lmask = maskToBox(la.mask, layer);
          // a korrigált példány alfája = (saját alfa × maszk) → az EREDETI fölé overlay-eljük:
          // a maszkon belül a korrigált, kívül (alfa 0) az eredeti látszik. (A maskedmerge a szürke
          // maszkot az rgba-auto-konverzió miatt félreértette — ez a bevált alphamerge+overlay út.)
          filters.push(`[${prepared}]format=rgba,split[lo${li}][lx${li}]`);
          filters.push(`[lx${li}]${corr},format=rgba[cadj${li}]`);
          filters.push(maskGrayChain(lmask, boxW, boxH, `[lmg${li}]`));
          filters.push(`[cadj${li}]split[cc${li}][caa${li}]`);
          filters.push(`[caa${li}]alphaextract[cae${li}]`);
          filters.push(`[cae${li}][lmg${li}]blend=all_mode=multiply:shortest=1[cam${li}]`);
          filters.push(`[cc${li}][cam${li}]alphamerge[cadjA${li}]`);
          filters.push(`[lo${li}][cadjA${li}]overlay=0:0[lc${li}]`);
          prepared = `lc${li}`;
        }
      }
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

    // 🖊️ kontúr/stroke (pozícionált rétegre): a réteg színezett, N px-rel megnövelt sziluettje
    // MÖGÉ (középre) — a réteghez legközelebb (a glow/árnyék UTÁN). N a vászonszélesség törtje.
    if (layer.stroke && layer.kind !== 'fill') {
      const sw = Math.max(1, Math.round(canvas.w * (Number(layer.stroke.width) || 0)));
      if (sw >= 1 && Number(layer.stroke.width) > 0) {
        const kout = `st${idx}`;
        filters.push(`[${prepared}]split[plk${idx}][psk${idx}]`);
        filters.push(`[psk${idx}]${strokeSilhouette(layer.stroke.color, sw)}[stl${idx}]`);
        filters.push(`${last}[stl${idx}]overlay=${posX}:${posY}[${kout}]`);
        last = `[${kout}]`;
        prepared = `plk${idx}`;
      }
    }

    // 🎭 réteg-maszk (szelekció/alak): a réteget átlátszó TELJES vászonra helyezzük, az alfáját a
    // maszk-szürkével szorozzuk (a maszkon kívül átlátszó) → a base fölé. A maszk a blend ELŐTT nyer (v1).
    const mask = layer.mask;
    if (mask && mask.shape && layer.kind !== 'fill') {
      const mi = maskSeq;
      maskSeq += 1;
      filters.push(`color=black@0:s=${canvas.w}x${canvas.h}[mbg${mi}]`);
      filters.push(`[mbg${mi}][${prepared}]overlay=${posX}:${posY}[Lf${mi}]`);
      filters.push(maskGrayChain(mask, canvas.w, canvas.h, `[mimg${mi}]`));
      filters.push(`[Lf${mi}]split[mf${mi}][mfa${mi}]`);
      filters.push(`[mfa${mi}]alphaextract[mae${mi}]`);
      filters.push(`[mae${mi}][mimg${mi}]blend=all_mode=multiply:shortest=1[mab${mi}]`);
      filters.push(`[mf${mi}][mab${mi}]alphamerge[mk${mi}]`);
      filters.push(`${last}[mk${mi}]overlay=0:0[${out}]`);
      last = `[${out}]`;
      continue;
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

  // 🎚️ dokumentum-szintű GLOBÁLIS korrekció (grade preset + kézi adjust) a TELJES kompozitra
  const docCorr = (gradeFilterChain(doc.grade) + adjustChain({ adjust: doc.adjust })).replace(/^,/, '');
  if (docCorr) {
    filters.push(`${last}${docCorr}[docc]`);
    last = '[docc]';
  }

  // 🔦 dokumentum-szintű vignetta: a sarkokat sötétíti a TELJES kész képen (a kompozit után)
  const vignette = Math.max(0, Math.min(1, Number(doc.vignette) || 0));
  if (vignette > 0) {
    const angle = (vignette * (Math.PI / 3)).toFixed(4);
    filters.push(`${last}vignette=angle=${angle}[vig]`);
    last = '[vig]';
  }

  // 🎞️ dokumentum-szintű filmszemcse a TELJES kész képre (a kompozit után, a kimenet előtt)
  const grain = Math.max(0, Math.min(1, Number(doc.grain) || 0));
  if (grain > 0) {
    filters.push(`${last}noise=alls=${Math.round(grain * 30)}:allf=t+u[grained]`);
    last = '[grained]';
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
