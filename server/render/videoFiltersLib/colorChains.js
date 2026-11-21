// 🎨 Szín-láncok: szűrő-tint (drawbox), képjavítás (adjust), grade-preset, világítás (a videoFilters.js-ből).
// 🖼️ kép-paritás: a Kép Stúdió szín-magjai (már /imagedoc-on pixel-bizonyítva) a video-klip grade-jéhez
const { levelsFilter, channelMixFilter, gradientMapFilter, splitToneFilter } = require('../../imageFilters');
const { localPathOnly } = require('./localPath');

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
const { GRADES } = require('../../grades');

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

function filterDrawbox(clip, W, H) {
  const f = FILTERS[clip.filterId];
  if (!f) {
    return '';
  }
  const op = f.opacity * (clip.filterIntensity ?? 1);
  return `,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x${f.color}@${op.toFixed(3)}:t=fill`;
}

module.exports = { FILTERS, adjustChain, gradeChain, LIGHTING, lightingChain, filterDrawbox };
