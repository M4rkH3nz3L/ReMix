const { logCaught } = require('../lib/caught');
// 🎨 Kép-dokumentum — a réteg-fa ffmpeg-kompozitja (rajzolási sorrendben) → kész kép.
const fs = require('fs');
const path = require('path');

const { adjustChain } = require('../render');
const { gradeFilterChain } = require('../grades');
const {
  filterChain,
  maskGradientFilter,
  shadowSilhouette,
  glowSilhouette,
  strokeSilhouette,
  perspectiveFilter,
  gradientMapFilter,
  healChain,
  levelsFilter,
  channelMixFilter,
  innerEffectsFilters,
  straightenChain,
  cornerPinFilter,
} = require('../imageFilters');
const { maskGrayChain, maskToBox } = require('../imageMask');
const { hslCube, isNeutralHsl } = require('../hslBands');
const { renderShapePngs, renderTextPngs } = require('../text-render');
const { run, imageOutputArgs } = require('./ffmpeg');
const { developChain } = require('./develop');
const { docCanvas } = require('./canvas');
const { rotateChain, filterTintChain, isVisible, fillAsShape, watermarkLayer, textWithStroke } = require('./layers');

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

async function renderImageDoc(doc, height, workDir, opts = {}) {
  const canvas = docCanvas(doc, height);
  // 🗂️ csoportok: a rejtett csoport tagjai kimaradnak, az opacity a tagokra RÁszorzódik
  const groups = new Map((doc.groups ?? []).map((g) => [g.id, g]));
  // 🗂️ S18: beágyazott csoportok — a réteg csoportja és az ősei (belülről kifelé, körkörösség ellen védve)
  const chainOf = (l) => {
    const out = [];
    const seen = new Set();
    let g = l.groupId ? groups.get(l.groupId) : undefined;
    while (g && !seen.has(g.id)) {
      seen.add(g.id);
      out.push(g);
      g = g.parentId ? groups.get(g.parentId) : undefined;
    }
    return out;
  };
  const groupHidden = (l) => chainOf(l).some((g) => g.hidden);
  const groupOpacity = (l) => chainOf(l).reduce((acc, g) => acc * Math.max(0, Math.min(1, Number(g.opacity ?? 1))), 1);
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
    // az opacity a kompoziton hat (csoporttal együtt) — a PNG-be nem szabad még egyszer beégetni
    .map((l) => (l.kind === 'fill' ? { ...fillAsShape(l), opacity: 1 } : { ...l, kind: 'shape', opacity: 1 }));
  const textLike = layers
    .filter((l) => l.kind === 'text')
    .map((l) => ({ ...textWithStroke(l, canvas), kind: 'text', animation: 'none', start: 0, duration: 1 }));

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
  const inputs = ['-f', 'lavfi', '-i', `color=black@0:s=${canvas.w}x${canvas.h},format=rgba`];
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
      // 🎨 S17: a korrekciós réteg színenkénti HSL-je a grade + adjust után (a kliens `layerOps`-ával azonos sorrend)
      let adjHsl = '';
      if (!isNeutralHsl(layer.hsl)) {
        const cube = path.join(workDir, `hsladj${idx}_${maskSeq}.cube`);
        fs.writeFileSync(cube, hslCube(layer.hsl));
        adjHsl = `,lut3d='${cube.replace(/'/g, "'\\''")}'`;
      }
      const corr = (gradeFilterChain(layer.grade) + adjustChain({ adjust: layer.adjust }) + adjHsl).replace(/^,/, '');
      if (!corr) {
        continue;
      }
      const ai = maskSeq;
      maskSeq += 1;
      if (layer.mask && layer.mask.shape) {
        filters.push(`${last}format=rgba,split[ao${ai}][ax${ai}]`);
        filters.push(`[ax${ai}]${corr},format=rgba[acx${ai}]`);
        filters.push(maskGrayChain(layer.mask, canvas.w, canvas.h, `[amg${ai}]`, workDir));
        filters.push(`[acx${ai}]split[acc${ai}][aca${ai}]`);
        filters.push(`[aca${ai}]alphaextract[acae${ai}]`);
        filters.push(`[acae${ai}][amg${ai}]blend=all_mode=multiply:shortest=1[acam${ai}]`);
        filters.push(`[acc${ai}][acam${ai}]alphamerge[acadjA${ai}]`);
        filters.push(`[ao${ai}][acadjA${ai}]overlay=0:0:format=auto[adj${ai}]`);
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
        // hiányzó média — a réteg kimarad, a többi mehet; a hívó jelzi a usernek (I3)
        opts.onMissing?.(layer.id);
        continue;
      }
      inputs.push('-i', layer.uri);
      const boxW = Math.max(2, Math.round((layer.w ?? 1) * canvas.w));
      const boxH = Math.max(2, Math.round((layer.h ?? 1) * canvas.h));
      // 'cover' kitölti a keretet (a túllógó rész levágódik), 'contain' belefér,
      // 'stretch' NEM-arányosan a keretre nyújt (szabad transzform — torzíthat)
      // 👾 S15: a pixel-art réteg (a kliens csak a jelzést küldi, a rácsot nem) legközelebbi szomszéddal
      // skálázódik, mint a vásznon — különben a kész képen a pixelek széle elmosódik
      const sf = layer.pixelArt ? ':flags=neighbor' : '';
      const fit =
        layer.fit === 'contain'
          ? `format=rgba,scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease${sf},` +
            `pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : layer.fit === 'stretch'
            ? `scale=${boxW}:${boxH}${sf}`
            : `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase${sf},` +
              `crop=${boxW}:${boxH}`;
      // 🔁 tükrözés a forgatás ELŐTT (helyi tér) — a preview scaleX/Y-nal egyezik
      const flip = `${layer.flipH ? ',hflip' : ''}${layer.flipV ? ',vflip' : ''}`;
      const rotate = rotateChain(layer.rotation);
      // 🎞️ saját 3D LUT (.cube): a feltöltött fájlnak nincs .cube kiterjesztése (multer
      // generált név) → workDir-be másoljuk .cube-ként, hogy az ffmpeg felismerje. A grade UTÁN.
      let lutFrag = '';
      if (layer.lut && fs.existsSync(layer.lut)) {
        try {
          const lutFile = path.join(workDir, `lut${idx}.cube`);
          fs.copyFileSync(layer.lut, lutFile);
          lutFrag = `,lut3d='${lutFile.replace(/'/g, "'\\''")}'`;
        } catch (caught) {
          logCaught('imagedoc.js:renderImageDoc', caught);
          lutFrag = '';
        }
      }
      // 📐 perspektíva/3D-dőlés a box-méretű fotóra (a filterek UTÁN, a flip/rotate ELŐTT)
      // 🔲 S18: a 4-sarkos perspektíva felülírja a régi dőlést (a kettő egyszerre nem él)
      const persp = cornerPinFilter(layer.corners, boxW, boxH) || perspectiveFilter(layer.perspectiveX, layer.perspectiveY, boxW, boxH);
      // 🎨 gradient-map (egyedi-színű duotone) — a grade/lut UTÁN, a struktúra-szűrők ELŐTT
      const gmap = layer.gradientMap
        ? gradientMapFilter(layer.gradientMap.shadow, layer.gradientMap.highlight)
        : '';
      // 🎨 színenkénti HSL: a közös képletből írt .cube, a korrekció után
      let hslFrag = '';
      if (!isNeutralHsl(layer.hsl)) {
        const cube = path.join(workDir, `hsl${idx}.cube`);
        fs.writeFileSync(cube, hslCube(layer.hsl));
        hslFrag = `,lut3d='${cube.replace(/'/g, "'\\''")}'`;
      }
      // 🩹 folt-javítás: a nyers (fit-elt) fotón, a korrekció/szűrők ELŐTT (delogo a környezetből interpolál)
      const heal = healChain(layer.heal, boxW, boxH);
      // 📊 szintek (levels): a tonális remap a korrekció/grade UTÁN, a struktúra-szűrők előtt
      const lvl = levelsFilter(layer.levels);
      // 🎨 csatorna-mixer: a levels UTÁN (a kimeneti csatornák lineáris keverése)
      const chmix = channelMixFilter(layer.channelMix);
      // 📸 RAW-develop (S-PHOTO): a non-destruktív előhívás a korrekció/grade/szűrő-lánc
      // UTÁN, a geometria (persp/flip/rotate) ELŐTT. Contract-locked `developFilterPlan` tükör.
      const dev = developChain(layer.develop);
      // 🎞️ I15: a gyors szín-preset (filterId) a kész tónusra kerül
      const tint = filterTintChain(layer.filterId, layer.filterIntensity);
      prepared = `p${idx}`;
      // I18: a tartalom-lánc a réteg SAJÁT (doboz) terében fut; a geometria csak a lokális
      // korrekció UTÁN jön, így a maszk mérete mindig a doboz, nem az elforgatott befoglaló
      filters.push(
        `[${idx}:v]${fit}${heal},format=rgba${adjustChain(layer)}${hslFrag}${gradeFilterChain(layer.grade)}${lutFrag}${tint}${gmap}${lvl}${chmix}${filterChain(layer.filters)}${dev}${straightenChain(layer.straighten, boxW, boxH)}[${prepared}]`
      );
      const geomIdx = idx;
      idx += 1;

      // 🎯 kijelölés-alapú (lokális) korrekció: a grade/adjust CSAK a maszk-régión BELÜL hat.
      // A box-méretű prepared két példánya (eredeti + korrigált) a box-lokális maszkkal maskedmerge-elve.
      const la = layer.localAdjust;
      if (la && la.mask && la.mask.shape) {
        const corr = (gradeFilterChain(la.grade) + adjustChain({ adjust: la.adjust })).replace(/^,/, '');
        if (corr) {
          const li = maskSeq;
          maskSeq += 1;
          const lmask = maskToBox(la.mask, layer, canvas.w, canvas.h);
          // a korrigált példány alfája = (saját alfa × maszk) → az EREDETI fölé overlay-eljük:
          // a maszkon belül a korrigált, kívül (alfa 0) az eredeti látszik. (A maskedmerge a szürke
          // maszkot az rgba-auto-konverzió miatt félreértette — ez a bevált alphamerge+overlay út.)
          filters.push(`[${prepared}]format=rgba,split[lo${li}][lx${li}]`);
          filters.push(`[lx${li}]${corr},format=rgba[cadj${li}]`);
          filters.push(maskGrayChain(lmask, boxW, boxH, `[lmg${li}]`, workDir));
          filters.push(`[cadj${li}]split[cc${li}][caa${li}]`);
          filters.push(`[caa${li}]alphaextract[cae${li}]`);
          filters.push(`[cae${li}][lmg${li}]blend=all_mode=multiply:shortest=1[cam${li}]`);
          filters.push(`[cc${li}][cam${li}]alphamerge[cadjA${li}]`);
          filters.push(`[lo${li}][cadjA${li}]overlay=0:0:format=auto[lc${li}]`);
          prepared = `lc${li}`;
        }
      }
      // 🎨 S13: belső stílusok a réteg saját terében, a geometria és az átlátszóság ELŐTT (mint a vásznon)
      const innerP = innerEffectsFilters(`[${prepared}]`, `[ief${geomIdx}]`, layer, canvas.w, canvas.h, `p${geomIdx}`);
      if (innerP.length > 0) {
        filters.push(...innerP);
        prepared = `ief${geomIdx}`;
      }
      filters.push(
        `[${prepared}]format=rgba${persp}${flip}${rotate}${maskGradientFilter(layer.maskGradient)},colorchannelmixer=aa=${opacity.toFixed(3)}[pg${geomIdx}]`
      );
      prepared = `pg${geomIdx}`;
    } else {
      const png = rendered.get(layer.id);
      if (!png || !fs.existsSync(png)) {
        continue;
      }
      inputs.push('-i', png);
      prepared = `p${idx}`;
      // 🔄 forgatás + 🔁 tükrözés a forma PNG-n. A SZÖVEG PNG-jébe a generátor már beégeti
      // (`textTransformCss`), itt még egyszer alkalmazva kétszer forogna; a fill nem forog.
      const placed = layer.kind === 'shape';
      const flip = placed ? `${layer.flipH ? ',hflip' : ''}${layer.flipV ? ',vflip' : ''}` : '';
      const rot = placed ? rotateChain(layer.rotation) : '';
      // 🎨 S13: a forma belső stílusai a forgatás/átlátszóság ELŐTT (a vásznon is a forma saját terében)
      const innerS = placed ? innerEffectsFilters(`[${idx}:v]`, `[ies${idx}]`, layer, canvas.w, canvas.h, `s${idx}`) : [];
      filters.push(...innerS);
      filters.push(
        `${innerS.length > 0 ? `[ies${idx}]` : `[${idx}:v]`}format=rgba${flip}${rot}${maskGradientFilter(layer.maskGradient)},colorchannelmixer=aa=${opacity.toFixed(3)}[${prepared}]`
      );
      idx += 1;
    }

    // elhelyezés: a réteg KÖZÉPPONTJA a `position`, a fill a teljes vászon
    const out = `c${idx}`;
    const posX = layer.kind === 'fill' ? '0' : `${Math.round((layer.position?.x ?? 0.5) * canvas.w)}-overlay_w/2`;
    const posY = layer.kind === 'fill' ? '0' : `${Math.round((layer.position?.y ?? 0.5) * canvas.h)}-overlay_h/2`;

    // ✨ külső ragyogás (pozícionált rétegre): paddelt, színes sziluett → MÖGÉ overlay (középre).
    // A `outerGlow` lehet `true` (alap paraméterek) VAGY objektum ({color?,size?,opacity?}).
    if (layer.outerGlow && layer.kind !== 'fill') {
      const gc = typeof layer.outerGlow === 'object' ? layer.outerGlow : {};
      const gsig = Math.max(2, Math.round(canvas.w * (Number(gc.size) || 0.02)));
      const gm = gsig * 3;
      const gout = `gl${idx}`;
      filters.push(`[${prepared}]split[plg${idx}][psg${idx}]`);
      filters.push(`[psg${idx}]${glowSilhouette(gm, gsig, gc.opacity != null ? gc.opacity : 0.85, gc.color)}[gll${idx}]`);
      filters.push(`${last}[gll${idx}]overlay=${posX}:${posY}:format=auto[${gout}]`);
      last = `[${gout}]`;
      prepared = `plg${idx}`;
    }

    // 🌑 vetett árnyék (pozícionált rétegre): a prepared másolatából sziluett → MÖGÉ overlay eltolva.
    // A `dropShadow` lehet `true` (alap) VAGY objektum ({color?,dx?,dy?,blur?,opacity?} — dx/dy/blur a vászon törtje).
    if (layer.dropShadow && layer.kind !== 'fill') {
      const dc = typeof layer.dropShadow === 'object' ? layer.dropShadow : {};
      const sig = Math.max(1, Math.round(canvas.w * (Number(dc.blur) >= 0 && dc.blur != null ? dc.blur : 0.012)));
      const dx = Math.round(canvas.w * (dc.dx != null ? Number(dc.dx) : 0.02));
      const dy = Math.round(canvas.h * (dc.dy != null ? Number(dc.dy) : 0.02));
      const sout = `sh${idx}`;
      filters.push(`[${prepared}]split[pl${idx}][ps${idx}]`);
      filters.push(`[ps${idx}]${shadowSilhouette(sig, dc.opacity != null ? dc.opacity : 0.5, dc.color)}[shl${idx}]`);
      filters.push(`${last}[shl${idx}]overlay=${posX}+(${dx}):${posY}+(${dy}):format=auto[${sout}]`);
      last = `[${sout}]`;
      prepared = `pl${idx}`; // a réteg a split másik fele (az árnyék-sziluett nem fogyasztja el)
    }

    // 🖊️ kontúr/stroke (pozícionált rétegre): a réteg színezett, N px-rel megnövelt sziluettje
    // MÖGÉ (középre) — a réteghez legközelebb (a glow/árnyék UTÁN). N a vászonszélesség törtje.
    if (layer.stroke && layer.kind !== 'fill' && layer.kind !== 'text') {
      const sw = Math.max(1, Math.round(canvas.w * (Number(layer.stroke.width) || 0)));
      if (sw >= 1 && Number(layer.stroke.width) > 0) {
        const kout = `st${idx}`;
        filters.push(`[${prepared}]split[plk${idx}][psk${idx}]`);
        filters.push(`[psk${idx}]${strokeSilhouette(layer.stroke.color, sw)}[stl${idx}]`);
        filters.push(`${last}[stl${idx}]overlay=${posX}:${posY}:format=auto[${kout}]`);
        last = `[${kout}]`;
        prepared = `plk${idx}`;
      }
    }

    // 🎭 réteg-maszk (szelekció/alak): a réteget átlátszó TELJES vászonra helyezzük, az alfáját a
    // maszk-szürkével szorozzuk (a maszkon kívül átlátszó) → a base fölé. A maszk a blend ELŐTT nyer (v1).
    let placeX = posX;
    let placeY = posY;
    const mask = layer.mask;
    if (mask && mask.shape && layer.kind !== 'fill') {
      const mi = maskSeq;
      maskSeq += 1;
      filters.push(`color=black@0:s=${canvas.w}x${canvas.h},format=rgba[mbg${mi}]`);
      filters.push(`[mbg${mi}][${prepared}]overlay=${posX}:${posY}:format=auto[Lf${mi}]`);
      filters.push(maskGrayChain(mask, canvas.w, canvas.h, `[mimg${mi}]`, workDir));
      filters.push(`[Lf${mi}]split[mf${mi}][mfa${mi}]`);
      filters.push(`[mfa${mi}]alphaextract[mae${mi}]`);
      filters.push(`[mae${mi}][mimg${mi}]blend=all_mode=multiply:shortest=1[mab${mi}]`);
      filters.push(`[mf${mi}][mab${mi}]alphamerge[mk${mi}]`);
      // I16: a maszkolt réteg ezután teljes vásznas — a blend mód ugyanúgy érvényesül rá
      prepared = `mk${mi}`;
      placeX = '0';
      placeY = '0';
    }

    const mode = BLEND_FF[layer.blendMode];
    if (!mode) {
      // normál (source-over)
      filters.push(`${last}[${prepared}]overlay=${placeX}:${placeY}:format=auto[${out}]`);
    } else {
      // 🎨 keverési mód: a réteget teljes átlátszó vászonra helyezzük (Lfull), a base-szel
      // `blend`-eljük a módnak megfelelően, majd a réteg ALFÁJÁVAL maszkolva a base fölé mergeljük
      // (így a blend csak ott hat, ahol a réteg átlátszatlan; az opacity az alfában benne van).
      inputs.push('-f', 'lavfi', '-i', `color=black@0:s=${canvas.w}x${canvas.h},format=rgba`);
      const tIdx = idx;
      idx += 1;
      filters.push(`[${tIdx}:v]format=rgba[t${tIdx}]`);
      filters.push(`[t${tIdx}][${prepared}]overlay=${placeX}:${placeY}:format=auto[Lf${tIdx}]`);
      filters.push(`[Lf${tIdx}]split=3[Lb${tIdx}][Lc${tIdx}][La${tIdx}]`);
      filters.push(`${last}split=3[bb${tIdx}][bc${tIdx}][ba${tIdx}]`);
      // ⚠️ a `blend` RGB-SÍKOKON számoljon (gbrp), különben YUV-ban keverne → színhiba
      filters.push(`[bb${tIdx}]format=gbrp[bbf${tIdx}]`);
      filters.push(`[Lb${tIdx}]format=gbrp[Lbf${tIdx}]`);
      filters.push(`[bbf${tIdx}][Lbf${tIdx}]blend=all_mode=${mode}:shortest=1[bl${tIdx}]`);
      // W3C-kompozit: Cs' = (1−αb)·Cs + αb·B(Cb,Cs) — átlátszó alapon a réteg saját színe
      // látszik; a végső overlay őrzi az alap alfáját (a gbrp-ág egyébként eldobná)
      filters.push(`[ba${tIdx}]alphaextract[baa${tIdx}]`);
      filters.push(`[Lc${tIdx}]format=gbrp[Lcf${tIdx}]`);
      filters.push(`[Lcf${tIdx}][bl${tIdx}][baa${tIdx}]maskedmerge[mix${tIdx}]`);
      filters.push(`[La${tIdx}]alphaextract[am${tIdx}]`);
      filters.push(`[mix${tIdx}][am${tIdx}]alphamerge,format=rgba[mixA${tIdx}]`);
      filters.push(`[bc${tIdx}][mixA${tIdx}]overlay=0:0:format=auto[${out}]`);
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
  // 🤍 I20: a JPG-nek nincs alfája — az átlátszó rész fehérre lapul (nem feketére)
  if (ext === 'jpg') {
    filters.push(`color=white:s=${canvas.w}x${canvas.h}[jbg]`);
    filters.push(`[jbg]${last}overlay=0:0:format=auto:shortest=1[flat]`);
    last = '[flat]';
  }
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

module.exports = { BLEND_FF, renderImageDoc };
