// 🎨 Klip-szintű videó-szűrőláncok: szűrő-tint, képjavítás (adjust), grade, világítás, AI Select,
// mozgás/stabilizálás, arc-elmosás, matte, chroma-él, fade. (A server/render.js-ből kiemelve.)
const fs = require('fs');
const path = require('path');

const { bgRemoveDir } = require('../bgremove');
// 🖼️ kép-paritás: a Kép Stúdió szín-magjai (már /imagedoc-on pixel-bizonyítva) a video-klip grade-jéhez
const { levelsFilter, channelMixFilter, gradientMapFilter, splitToneFilter } = require('../imageFilters');
const { FPS } = require('./constants');

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

/** filterId → drawbox szín/átlátszóság (az app előnézetének megfelelően) */
const FILTERS = {
  warm: { color: 'ff9d4d', opacity: 0.18 },
  cool: { color: '4d9dff', opacity: 0.18 },
  mono: { color: '808080', opacity: 0.45 },
  vivid: { color: 'ff2ea6', opacity: 0.1 },
  fade: { color: 'd8d2c2', opacity: 0.25 },
  night: { color: '101040', opacity: 0.35 },
  retro: { color: 'c9a24b', opacity: 0.22 },
  sunset: { color: 'ff6b4a', opacity: 0.2 },
  forest: { color: '2e8b57', opacity: 0.18 },
};

/**
 * Képjavítás (Creative Canvas): eq + colorbalance + vignette a kész
 * (kompozitált) klip-képre — az app előnézete közelít, itt a végleges.
 */
function adjustChain(clip, enableExpr) {
  const a = clip.adjust;
  if (!a) {
    return '';
  }
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const brightness = clampNum(a.brightness, -0.3, 0.3);
  const contrast = 1 + clampNum(a.contrast, -0.4, 0.4);
  const saturation = 1 + clampNum(a.saturation, -1, 1);
  const temperature = clampNum(a.temperature, -0.3, 0.3);
  const vignette = clampNum(a.vignette, 0, 1);
  // Pro Basic-grade tónusvezérlők
  const exposure = clampNum(a.exposure, -1, 1);
  const highlights = clampNum(a.highlights, -1, 1);
  const shadows = clampNum(a.shadows, -1, 1);
  const whites = clampNum(a.whites, -1, 1);
  const blacks = clampNum(a.blacks, -1, 1);
  const tint = clampNum(a.tint, -0.3, 0.3);
  const vibrance = clampNum(a.vibrance, -1, 1);
  // grade-réteg (adjust-sáv) esetén minden szűrő időablakot kap (enable),
  // hogy csak a klip tartama alatt hasson a teljes kompozitra
  const en = enableExpr ? `:enable='${enableExpr}'` : '';
  const parts = [];
  if (exposure !== 0) {
    // stop-alapú expozíció (a bemenet lineárisan felszorozva)
    parts.push(`exposure=exposure=${exposure.toFixed(3)}${en}`);
  }
  if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
    parts.push(
      `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}${en}`
    );
  }
  if (highlights !== 0 || shadows !== 0 || whites !== 0 || blacks !== 0) {
    // 5-pontos tónusgörbe: feketék(0) · árnyékok(0.25) · közép(0.5) ·
    // csúcsfények(0.75) · fehérek(1) — a klienses előnézet UGYANEZT közelíti.
    const cl = (v) => Math.min(1, Math.max(0, v));
    const pts = [
      [0, cl(blacks * 0.15)],
      [0.25, cl(0.25 + shadows * 0.15)],
      [0.5, 0.5],
      [0.75, cl(0.75 + highlights * 0.15)],
      [1, cl(1 + whites * 0.15)],
    ];
    const spec = pts.map(([x, y]) => `${x.toFixed(3)}/${y.toFixed(3)}`).join(' ');
    parts.push(`curves=all='${spec}'${en}`);
  }
  if (a.curves) {
    // Manuális tónusgörbék (Curves): RGB (all) + csatornánként. A pontokat
    // 0…1-be zárjuk, x szerint rendezzük; az identitás-görbét kihagyjuk.
    const cl = (v) => Math.min(1, Math.max(0, Number(v) || 0));
    const curveSpec = (points) => {
      if (!Array.isArray(points) || points.length < 2) {
        return null;
      }
      if (points.every((p) => Math.abs(cl(p.x) - cl(p.y)) < 1e-3)) {
        return null; // identitás
      }
      return points
        .map((p) => ({ x: cl(p.x), y: cl(p.y) }))
        .sort((p, q) => p.x - q.x)
        .map((p) => `${p.x.toFixed(3)}/${p.y.toFixed(3)}`)
        .join(' ');
    };
    const chan = [];
    const all = curveSpec(a.curves.rgb);
    const r = curveSpec(a.curves.red);
    const g = curveSpec(a.curves.green);
    const b = curveSpec(a.curves.blue);
    if (r) chan.push(`r='${r}'`);
    if (g) chan.push(`g='${g}'`);
    if (b) chan.push(`b='${b}'`);
    if (all) chan.push(`all='${all}'`);
    if (chan.length) {
      parts.push(`curves=${chan.join(':')}${en}`);
    }
  }
  if (temperature !== 0) {
    // valódi színhőmérséklet — a `colorbalance` ebben az ffmpeg-buildben néma,
    // ezért `colortemperature`: 6500K a semleges, meleg(+) → alacsonyabb K,
    // hideg(−) → magasabb K
    const kelvin = Math.round(Math.min(40000, Math.max(1000, 6500 - temperature * 10000)));
    parts.push(`colortemperature=temperature=${kelvin}${en}`);
  }
  if (tint !== 0) {
    // színárnyalat: zöld ↔ magenta a zöld csatorna skálázásával (tint>0 = magenta)
    parts.push(`colorchannelmixer=gg=${(1 - tint).toFixed(3)}${en}`);
  }
  if (vibrance !== 0) {
    // élénkség: a kevésbé telített színeket emeli jobban (intenzitás -2…2)
    parts.push(`vibrance=intensity=${vibrance.toFixed(3)}${en}`);
  }
  // HSL / Hue-Saturation (globális): egyetlen `hue` szűrő h/s/b paramétere
  const hue = clampNum(a.hue, -1, 1);
  const hslSat = clampNum(a.hslSaturation, -1, 1);
  const hslLum = clampNum(a.hslLuminance, -1, 1);
  if (hue !== 0 || hslSat !== 0 || hslLum !== 0) {
    const hp = [];
    if (hue !== 0) hp.push(`h=${(hue * 180).toFixed(2)}`);
    if (hslSat !== 0) hp.push(`s=${(1 + hslSat).toFixed(3)}`);
    if (hslLum !== 0) hp.push(`b=${(hslLum * 3).toFixed(3)}`);
    parts.push(`hue=${hp.join(':')}${en}`);
  }
  // 🎨 3-way color balance (color wheels): árnyék/középtónus/csúcsfény RGB-eltolás.
  // A colorbalance ebben a buildben ÉL (a temperature-hez volt csak gyenge midtone-on).
  if (a.balance) {
    const b = a.balance;
    const terms = [];
    const add = (key, val) => {
      const v = clampNum(val, -1, 1) * 0.6; // ízléses skálázás (a nyers ±1 túlzó)
      if (Math.abs(v) > 0.001) {
        terms.push(`${key}=${v.toFixed(3)}`);
      }
    };
    add('rs', b.sh?.r); add('gs', b.sh?.g); add('bs', b.sh?.b);
    add('rm', b.mid?.r); add('gm', b.mid?.g); add('bm', b.mid?.b);
    add('rh', b.hi?.r); add('gh', b.hi?.g); add('bh', b.hi?.b);
    if (terms.length) {
      parts.push(`colorbalance=${terms.join(':')}${en}`);
    }
  }
  if (a.lut && a.lut.uri) {
    // kreatív 3D LUT (.cube). Az útvonalat egyszeres idézőjelbe zárjuk (a szóköz/
    // kettőspont védve), a benne lévő idézőjelet '\'' szekvenciával escape-eljük.
    // 🛡️ Séma-előtagos érték (http:/file:/…) kimarad — lásd `localPathOnly`.
    const lutPath = localPathOnly(a.lut.uri);
    if (lutPath) {
      const q = lutPath.replace(/'/g, "'\\''");
      parts.push(`lut3d='${q}'${en}`);
    }
  }
  if (vignette > 0.01) {
    parts.push(`vignette=angle=${(vignette * (Math.PI / 4)).toFixed(4)}${en}`);
  }
  let chain = parts.length ? ',' + parts.join(',') : '';
  // 🖼️ kép-paritás (szintek / csatorna-mixer / gradient-map) — a kép magjaival AZONOS filter-stringek.
  // A levels/csatorna-mixer EGY szűrő → grade-rétegen is kaphat `enable`-ablakot; a gradient-map
  // TÖBB szűrő (format+geq+format) → csak a KLIP saját grade-jén (grade-rétegen kimarad).
  const lv = levelsFilter(a.levels);
  if (lv) {
    chain += en ? lv + en : lv;
  }
  const cm = channelMixFilter(a.channelMix);
  if (cm) {
    chain += en ? cm + en : cm;
  }
  if (a.gradientMap) {
    // a geq `enable`-ablakot kap grade-rétegen (a `en` a geq-re injektálódik)
    chain += gradientMapFilter(a.gradientMap.shadow, a.gradientMap.highlight, en);
  }
  if (a.splitTone) {
    chain += splitToneFilter(a.splitTone.shadow, a.splitTone.highlight, a.splitTone.strength ?? 1, en);
  }
  return chain;
}

/**
 * 🎨 Filmes grade-presetek (LUT-szerű look-ok) a grade-rétegre. A térkép a KÖZÖS
 * `server/grades.js`-ben él (a kép-render fotó-rétege is ezt használja); minden
 * preset ffmpeg-szűrők LISTÁJA (split-tone: eq + colorbalance s/m/h + vignette) —
 * a `constants/grades.ts` UGYANEZEKKEL az id-kkal ad előnézeti tint-közelítést.
 * Minden szűrő külön `enable`-ablakot kaphat (a grade-réteg tartama).
 */
const { GRADES } = require('../grades');

/**
 * A grade-réteg teljes lánca: előbb a `grade` preset (ha van), MAJD a kézi
 * `adjust` finomhangolás — mindkettő `enable`-ablakkal a klip tartamára. Vezető
 * vesszős füzért ad (mint az adjustChain), üres, ha se preset, se kézi korrekció.
 */
function gradeChain(clip, enableExpr) {
  const en = enableExpr ? `:enable='${enableExpr}'` : '';
  const parts = [];
  const preset = clip.grade && clip.grade !== 'none' ? GRADES[clip.grade] : null;
  if (preset) {
    for (const f of preset) {
      parts.push(f + en);
    }
  }
  const presetChain = parts.length ? ',' + parts.join(',') : '';
  // a kézi adjust vezető vesszős láncot ad (szintén enable-ablakkal) — RÁrétegződik
  return presetChain + adjustChain(clip, enableExpr);
}

/**
 * 💡 Lighting-presetek (🧊 3D V2): hangulat-világítás split-tone color-grade-
 * ként — az árnyék/középtónus/csúcsfény külön színt kap (colorbalance
 * s/m/h csatornák), eq-val kísérve. A képjavítás (adjust) UTÁN fut.
 */
const LIGHTING = {
  studio: 'eq=brightness=0.04:contrast=1.06:saturation=1.04,colorbalance=rm=0.02:bm=0.02',
  sunset:
    'eq=contrast=1.05:saturation=1.08,' +
    'colorbalance=rm=0.16:gm=0.03:bm=-0.18:rh=0.10:bh=-0.14:rs=0.06:bs=-0.06',
  neon:
    'eq=contrast=1.08:saturation=1.22,' +
    'colorbalance=rm=0.10:bm=0.20:rs=0.12:bs=0.22:gh=-0.05',
  cyberpunk:
    'eq=contrast=1.12:saturation=1.12,' +
    'colorbalance=rs=-0.14:gs=0.02:bs=0.24:rh=0.18:gh=0.02:bh=-0.20',
};

function lightingChain(clip) {
  const preset = LIGHTING[clip.lighting];
  return preset ? `,${preset}` : '';
}

/**
 * 🎯 AI Select (CC V2): a képjavítás CSAK a kijelölésre hat — a korrigált és
 * az eredeti kép a téma-maszkkal keveredik (maskedmerge). A maszk a bgremove
 * cache-ből jön; háttér-célnál a maszk invertálva megy.
 */
function selectiveChain(clip, W, H, labelIn, labelOut, idx, graph, addInput, dur) {
  const sel = clip.selective;
  const adjust = adjustChain(clip);
  if (!sel || !adjust) {
    return false;
  }
  const alphaFile = path.join(bgRemoveDir(sel.id), 'alpha.png');
  if (!fs.existsSync(alphaFile)) {
    return false;
  }
  const aIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', alphaFile]);
  const invert = sel.target === 'background' ? ',lutyuv=y=negval' : '';
  graph.push(`[${labelIn}]split[selA${idx}][selB${idx}]`);
  // a korrekció a MÁSOLATON fut, majd a maszk szerint keveredik vissza
  // (a maskedmerge minden bemenete gbrp — különben gray-re tárgyalna le)
  graph.push(`[selB${idx}]${adjust.slice(1)},format=gbrp[selC${idx}]`);
  graph.push(`[selA${idx}]format=gbrp[selD${idx}]`);
  graph.push(
    `[${aIdx}:v]scale=${W}:${H},format=gray${invert},format=gbrp[selM${idx}]`
  );
  graph.push(
    `[selD${idx}][selC${idx}][selM${idx}]maskedmerge,format=yuv420p[${labelOut}]`
  );
  return true;
}

/**
 * 🙈 Arc-elmosás (adatvédelem): a régió KIVÁGVA elmosódik és visszakerül a
 * helyére — így a szűrő csak a kis területen fut (gyors), és a kép többi
 * része érintetlen marad. A régió statikus (a mintavett arcok uniója+margó),
 * páros pixelekre igazítva; a `pixelate` mozaikot ad lágy blur helyett.
 */
/**
 * 🌀 Mozgás-elmosás / sima lassítás (speed ramp v2) — a `fps=` lépést váltja ki.
 * Gyorsításnál a decimálás ELŐTT keveri a kockákat (tmix), így épp azokat mossa
 * össze, amiket a képkocka-ritkítás eldobna. Lassításnál a minterpolate köztes
 * kockákat számol a lépcsőzés helyett; ez CPU-igényes, ezért rövid darabokra
 * korlátozzuk. Erő nélkül a régi, egyszerű fps-lánc megy.
 */
function motionChain(clip, dur) {
  const strength = Math.max(0, Math.min(1, clip.motionBlur ?? 0));
  const plain = `fps=${FPS},`;
  const fast = clip.speed > 1.05;
  const slow = clip.speed < 0.95;
  const speedupBlend = () => {
    // a sebességgel arányos keverési ablak (2× → ~4 kocka, 6×-nál a 8-as plafon)
    const frames = Math.max(2, Math.min(8, Math.round(1 + Math.max(strength, 0.5) * clip.speed * 1.6)));
    return `tmix=frames=${frames},${plain}`;
  };
  // ⏱️ explicit idő-interpoláció (time remapping) — felülírja a motionBlur-autót
  const interp = clip.timeInterp;
  if (interp && interp !== 'none') {
    if (slow && dur <= 12) {
      return interp === 'flow'
        ? `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,`
        : `minterpolate=fps=${FPS}:mi_mode=blend,`; // képkocka-keverés
    }
    if (fast) {
      return speedupBlend();
    }
    return plain;
  }
  // vissza a motionBlur-alapú viselkedésre (kompatibilitás)
  if (strength <= 0) {
    return plain;
  }
  if (fast) {
    return speedupBlend();
  }
  if (slow && dur <= 8) {
    return `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,`;
  }
  return plain;
}

/**
 * 🎯 Videó-stabilizálás (`deshake`, egymenetes). A `strength` a keresési
 * tartományt (rx/ry, 16 többszöröse), a `smoothness` a blokkméretet, a `crop`
 * a szélek eltüntetéséhez befelé kivágást ad (a downstream fit-scale nagyítja
 * vissza). RS: finomabb blokk + clamp él. Vezető filter-lánc (a nyers kockára,
 * a méretezés ELŐTT); vesszővel zár, hogy a `decode`-hoz fűzhető legyen.
 */
function stabilizeChain(clip) {
  const s = clip.stabilize;
  if (!s || !s.automatic) {
    return '';
  }
  const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)));
  const strength = cl(s.strength ?? 0.5, 0, 1);
  const rx = 16 * Math.min(4, Math.max(1, Math.round(1 + strength * 3))); // 16…64 (16 többszöröse)
  const smoothness = cl(s.smoothness ?? 0.5, 0, 1);
  let blocksize = Math.round(8 + smoothness * 40); // 8…48
  const crop = cl(s.crop ?? 0, 0, 1);
  const edge = s.rollingShutter ? 2 : 3; // rs → clamp; egyébként mirror
  if (s.rollingShutter) {
    blocksize = Math.max(8, Math.round(blocksize * 0.6)); // finomabb becslés
  }
  let chain = `deshake=rx=${rx}:ry=${rx}:edge=${edge}:blocksize=${blocksize}`;
  if (crop > 0.01) {
    // a képet befelé kivágjuk (középre); a szélek bemozduló sávja eltűnik, a
    // downstream méretezés nagyítja vissza a vászonra
    const z = (1 - crop * 0.15).toFixed(3);
    chain += `,crop=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2`;
  }
  return chain + ',';
}

function faceBlurChain(clip, W, H, labelIn, labelOut, idx, graph, skip = 0) {
  const fb = clip.faceBlur;
  if (!fb) {
    return false;
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const bw = even(Math.min(1, Math.max(0.03, fb.w)) * W);
  const bh = even(Math.min(1, Math.max(0.03, fb.h)) * H);
  const strength = Math.min(2, Math.max(0.3, fb.strength ?? 1));
  // mozaik: a régió ~14 blokk szélesre zsugorodik, majd pont-mintásan vissza —
  // a blokkméret így a régió MÉRETÉHEZ igazodik (felismerhetetlen arc), nem
  // fix pixelszámhoz
  const blocks = Math.max(4, Math.round(14 / strength));
  const effect = fb.pixelate
    ? `scale=${Math.max(2, blocks)}:${Math.max(
        2,
        Math.round((blocks * bh) / bw)
      )},scale=${bw}:${bh}:flags=neighbor`
    : `gblur=sigma=${(Math.min(bw, bh) * 0.09 * strength).toFixed(1)}`;

  // 🎯 KÖVETÉS: fix méretű régió, mozgó középpont — a crop/overlay x/y per-frame
  // T-kifejezés (T = szűrő-idő + skip = klip-lokális). Track nélkül statikus.
  const track = Array.isArray(fb.track) && fb.track.length > 0 ? [...fb.track].sort((a, b) => a.t - b.t) : null;
  let bxTok;
  let byTok;
  if (track) {
    const T = `(t+${skip.toFixed(3)})`;
    const px5 = (v) => Number(v).toFixed(5);
    const axisExpr = (axis, fb0) => {
      const fr = track.map((p) => ({ t: p.t, v: p[axis] ?? fb0 }));
      let expr = px5(fr[fr.length - 1].v);
      for (let k = fr.length - 2; k >= 0; k--) {
        const a = fr[k];
        const b = fr[k + 1];
        const span = Math.max(b.t - a.t, 0.001);
        const P = `min(max((${T}-${px5(a.t)})/${px5(span)},0),1)`;
        expr = `if(lt(${T},${px5(b.t)}),(${px5(a.v)}+${px5(b.v - a.v)}*${P}),${expr})`;
      }
      return `if(lt(${T},${px5(fr[0].t)}),${px5(fr[0].v)},${expr})`;
    };
    // középpont → bal-felső sarok, a képkeretre klippelve
    bxTok = `clip((${axisExpr('x', fb.x)})*${W}-${bw / 2},0,${W - bw})`;
    byTok = `clip((${axisExpr('y', fb.y)})*${H}-${bh / 2},0,${H - bh})`;
  } else {
    bxTok = String(even(Math.min(W - bw, Math.max(0, (fb.x - fb.w / 2) * W))));
    byTok = String(even(Math.min(H - bh, Math.max(0, (fb.y - fb.h / 2) * H))));
  }
  graph.push(`[${labelIn}]split[fbA${idx}][fbB${idx}]`);
  graph.push(`[fbB${idx}]crop=w=${bw}:h=${bh}:x='${bxTok}':y='${byTok}',${effect}[fbC${idx}]`);
  graph.push(`[fbA${idx}][fbC${idx}]overlay=x='${bxTok}':y='${byTok}'[${labelOut}]`);
  return true;
}

/**
 * 🎭 Track/luma/alpha matte: egy külső média (kép) fényereje (luma) vagy alfája
 * adja a klip átlátszóságát. A matte WxH-ra skálázva → gray/alphaextract (opc.
 * negate) → a fg-alfával szorozva (alphamerge). Visszaadja az új címkét, vagy a
 * bemenetit, ha nincs matte.
 */
function matteChain(clip, W, H, labelIn, idx, graph, addInput, dur) {
  const m = clip.matte;
  if (!m || !m.uri) {
    return labelIn;
  }
  // 🛡️ csak HELYI fájl mehet az `-i`-re (séma-előtag → a matte kimarad)
  const mattePath = localPathOnly(m.uri);
  if (!mattePath) {
    return labelIn;
  }
  const mIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', mattePath]);
  const inv = m.invert ? ',negate' : '';
  if (m.type === 'alpha') {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=rgba,alphaextract${inv}[mta${idx}]`);
  } else {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=gray${inv}[mta${idx}]`);
  }
  graph.push(`[${labelIn}]split[mtf${idx}][mtfa${idx}]`);
  graph.push(`[mtfa${idx}]alphaextract[mtae${idx}]`);
  graph.push(`[mtae${idx}][mta${idx}]blend=all_mode=multiply:shortest=1[mtab${idx}]`);
  graph.push(`[mtf${idx}][mtab${idx}]alphamerge[mtm${idx}]`);
  return `mtm${idx}`;
}

/**
 * ✂️ Chroma-él igazítás (matte choke/grow): a kulcsolt fg alfáján `erosion`
 * (edge<0 = perem megevése) vagy `dilation` (edge>0 = növelés) |edge|·4 menetben.
 * Visszaadja az új címkét, vagy a bemenetit, ha nincs edge.
 */
function edgeChain(clip, labelIn, idx, graph) {
  const e = clip.chromaKey && clip.chromaKey.edge;
  if (!e) {
    return labelIn;
  }
  const passes = Math.min(4, Math.max(1, Math.round(Math.abs(e) * 4)));
  const op = Array(passes).fill(e < 0 ? 'erosion' : 'dilation').join(',');
  graph.push(`[${labelIn}]split[egf${idx}][egfa${idx}]`);
  graph.push(`[egfa${idx}]alphaextract,${op}[ega${idx}]`);
  graph.push(`[egf${idx}][ega${idx}]alphamerge[egm${idx}]`);
  return `egm${idx}`;
}

function filterDrawbox(clip, W, H) {
  const f = FILTERS[clip.filterId];
  if (!f) {
    return '';
  }
  const op = f.opacity * (clip.filterIntensity ?? 1);
  return `,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x${f.color}@${op.toFixed(3)}:t=fill`;
}

function fadeFilters(clip, visDur) {
  let s = '';
  const fi = clip.fadeInSec ?? 0;
  const fo = clip.fadeOutSec ?? 0;
  if (fi > 0) {
    s += `,fade=t=in:st=0:d=${Math.min(fi, visDur).toFixed(3)}`;
  }
  if (fo > 0) {
    const d = Math.min(fo, visDur);
    s += `,fade=t=out:st=${(visDur - d).toFixed(3)}:d=${d.toFixed(3)}`;
  }
  return s;
}

module.exports = {
  localPathOnly,
  FILTERS,
  adjustChain,
  gradeChain,
  LIGHTING,
  lightingChain,
  selectiveChain,
  motionChain,
  stabilizeChain,
  faceBlurChain,
  matteChain,
  edgeChain,
  filterDrawbox,
  fadeFilters,
};
