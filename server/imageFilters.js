// 🎛️ Kép-struktúra-szűrők (IMGEDD §5): a foto-réteg renderébe fűzött ffmpeg-szűrő-lánc
// (blur/sharpen/zaj/szürke/szépia). A korrekció (adjustChain) UTÁN fut. Pure → tesztelhető.

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// szépia-mátrix (full); az `amount` az identitás felé interpolál (0 = eredeti, 1 = teljes szépia)
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function sepiaMixer(a) {
  const m = SEPIA.map((s, i) => (IDENT[i] * (1 - a) + s * a).toFixed(4));
  // colorchannelmixer: rr:rg:rb:ra : gr:gg:gb:ga : br:bg:bb:ba (ra/ga/ba = 0)
  return `colorchannelmixer=${m[0]}:${m[1]}:${m[2]}:0:${m[3]}:${m[4]}:${m[5]}:0:${m[6]}:${m[7]}:${m[8]}:0`;
}

/** Egy szűrő ffmpeg-lánc-részlete (vagy '' ha hatástalan). */
function oneFilter(f) {
  const a = clamp01(f && f.amount);
  switch (f && f.type) {
    case 'blur':
      return a > 0 ? `gblur=sigma=${(a * 20).toFixed(2)}` : '';
    case 'sharpen':
      return a > 0 ? `unsharp=5:5:${(a * 2).toFixed(2)}:5:5:0` : '';
    case 'noise':
      return a > 0 ? `noise=alls=${Math.round(a * 40)}:allf=t+u` : '';
    case 'grayscale':
      return a > 0 ? `hue=s=${(1 - a).toFixed(3)}` : '';
    case 'sepia':
      return a > 0 ? sepiaMixer(a) : '';
    case 'clarity':
      // lokális (midtone) kontraszt — nagy sugarú unsharp
      return a > 0 ? `unsharp=lx=13:ly=13:la=${(a * 1.5).toFixed(2)}` : '';
    case 'dehaze':
      // párátlanítás — globális kontraszt + telítettség emelés
      return a > 0 ? `eq=contrast=${(1 + a * 0.6).toFixed(3)}:saturation=${(1 + a * 0.4).toFixed(3)}` : '';
    case 'pixelate': {
      // blokkos — méret-tartó (pixelize); nagyobb amount = nagyobb blokk
      const block = 2 + Math.round(a * 22);
      return a > 0 ? `pixelize=w=${block}:h=${block}` : '';
    }
    case 'posterize': {
      // kevés szín-szint (sávosítás) — lutrgb lépcsőzés; nagyobb amount = kevesebb szint
      const step = Math.round(8 + a * 120);
      return a > 0
        ? `lutrgb=r='trunc(val/${step})*${step}':g='trunc(val/${step})*${step}':b='trunc(val/${step})*${step}'`
        : '';
    }
    case 'duotone': {
      // kétszínű leképezés (árnyék→indigo, csúcsfény→pink); amount az eredeti szürke felé keveri
      if (a <= 0) {
        return '';
      }
      const c1 = [43, 45, 122]; // #2b2d7a indigo (árnyék)
      const c2 = [255, 143, 171]; // #ff8fab pink (csúcsfény)
      const ch = (lo, hi) => `val*${(1 - a).toFixed(3)}+(${lo}+${hi - lo}*val/255)*${a.toFixed(3)}`;
      return `hue=s=0,lutrgb=r='${ch(c1[0], c2[0])}':g='${ch(c1[1], c2[1])}':b='${ch(c1[2], c2[2])}'`;
    }
    default:
      return '';
  }
}

/**
 * A szűrő-verem ffmpeg-lánca (vezető vesszővel, hogy a meglévő láncba fűzhető). Üres, ha nincs
 * érdemi szűrő. @param filters `ImageFilter[]`
 */
function filterChain(filters) {
  if (!Array.isArray(filters)) {
    return '';
  }
  const parts = filters.map(oneFilter).filter((s) => s.length > 0);
  return parts.length ? ',' + parts.join(',') : '';
}

// 🎭 lineáris gradient-maszk: a réteg alfáját X/Y mentén rámpázza (geq). Vezető vesszővel, hogy
// a prepared-láncba fűzhető (a flip/rotate UTÁN, az opacity-colorchannelmixer ELŐTT). '' ha nincs.
const MASK_EXPR = {
  right: '(1-X/W)', // bal átlátszatlan → jobb átlátszó
  left: '(X/W)',
  down: '(1-Y/H)',
  up: '(Y/H)',
};
function maskGradientFilter(dir) {
  const e = MASK_EXPR[dir];
  return e ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${e}'` : '';
}

// 🌑 vetett árnyék sziluett-lánca: a réteg másolatát feketére lutrgb-zi, elmossa, félig átlátszóvá
// teszi (colorchannelmixer aa). A hívó a réteg MÖGÉ overlay-eli eltolva. (pure → tesztelhető)
function shadowSilhouette(sigma, opacity) {
  const s = Math.max(0.5, Number(sigma) || 4);
  const o = Math.max(0, Math.min(1, Number(opacity) || 0.5));
  return `lutrgb=r=0:g=0:b=0,gblur=sigma=${s.toFixed(1)},colorchannelmixer=aa=${o.toFixed(3)}`;
}

// ✨ külső ragyogás sziluett: a réteg másolatát PADDELI (hogy a blur túlterjedjen), glow-színre
// lutrgb-zi, elmossa, félig átlátszóvá teszi. A hívó a réteg MÖGÉ overlay-eli (középre, posX/posY).
function glowSilhouette(margin, sigma, opacity) {
  const m = Math.max(1, Math.round(margin));
  const s = Math.max(0.5, Number(sigma) || 6);
  const o = Math.max(0, Math.min(1, Number(opacity) || 0.85));
  // accent-lila glow (#7c5cff → 124,92,255)
  return (
    `pad=iw+${2 * m}:ih+${2 * m}:${m}:${m}:color=black@0,` +
    `lutrgb=r=124:g=92:b=255,gblur=sigma=${s.toFixed(1)},colorchannelmixer=aa=${o.toFixed(3)}`
  );
}

// #rrggbb → {r,g,b} egész (0–255); hibás bemenet → fehér (biztonságos alap)
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) {
    return { r: 255, g: 255, b: 255 };
  }
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// 🖊️ kontúr/körvonal sziluett: a réteg másolatának ALFÁJÁT a stroke-színnel kitölti, és
// minden irányban N px-rel megnöveli (nearest-neighbor → éles keret). A hívó a réteg MÖGÉ
// overlay-eli (középre) → a megnövelt rész N px-es keretként jelenik meg. (pure → tesztelhető)
function strokeSilhouette(hex, widthPx) {
  const { r, g, b } = hexToRgb(hex);
  const n = Math.max(1, Math.round(widthPx));
  return `format=rgba,lutrgb=r=${r}:g=${g}:b=${b},scale=iw+${2 * n}:ih+${2 * n}:flags=neighbor`;
}

// 📐 perspektíva / 3D-dőlés: a fotó egyik éle "hátradől" (recede). px/py ∈ [-1,1]
// (px>0 → jobb él dől, px<0 → bal; py>0 → alsó él, py<0 → felső). A fotót előbb
// ÁTLÁTSZÓ kerettel paddoljuk, hogy a `perspective` él-replikációja az átlátszót
// vigye az out-of-quad területre → ott a háttér látszik (nem él-maszat). Vezető-vesszős
// fragment a box-méretű (boxW×boxH) fotóra; üres, ha nincs dőlés. (pure → tesztelhető)
function perspectiveFilter(px, py, boxW, boxH) {
  const hx = Math.max(-1, Math.min(1, Number(px) || 0)) * 0.25;
  const vy = Math.max(-1, Math.min(1, Number(py) || 0)) * 0.25;
  if (hx === 0 && vy === 0) {
    return '';
  }
  const m = Math.max(2, Math.round(Math.min(boxW, boxH) * 0.02));
  const PW = boxW + 2 * m;
  const PH = boxH + 2 * m;
  // sarkok a paddelt térben: TL, TR, BL, BR
  const c = { tlx: 0, tly: 0, trx: PW, tryy: 0, blx: 0, bly: PH, brx: PW, bry: PH };
  if (hx > 0) {
    c.tryy += PH * hx; // jobb él rövidül (recede)
    c.bry -= PH * hx;
  } else if (hx < 0) {
    c.tly += PH * -hx; // bal él rövidül
    c.bly -= PH * -hx;
  }
  if (vy > 0) {
    c.blx += PW * vy; // alsó él rövidül
    c.brx -= PW * vy;
  } else if (vy < 0) {
    c.tlx += PW * -vy; // felső él rövidül
    c.trx -= PW * -vy;
  }
  const r = (n) => Math.round(n);
  return (
    `,pad=iw+${2 * m}:ih+${2 * m}:${m}:${m}:color=black@0,` +
    `perspective=${r(c.tlx)}:${r(c.tly)}:${r(c.trx)}:${r(c.tryy)}:` +
    `${r(c.blx)}:${r(c.bly)}:${r(c.brx)}:${r(c.bry)}:sense=destination:interpolation=linear`
  );
}

// 🎨 gradient-map / egyedi-színű duotone: a luminanciát a `shadow`→`highlight` szín közötti
// lineáris átmenetre képezi (sötét → shadow, világos → highlight). Vezető-vesszős geq-fragment
// (BT.601 luma); üres, ha nincs megadva. (pure → tesztelhető)
function gradientMapFilter(shadowHex, highlightHex) {
  if (!shadowHex || !highlightHex) {
    return '';
  }
  const s = hexToRgb(shadowHex);
  const h = hexToRgb(highlightHex);
  const L = '(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y))/255';
  // gbrap (alfás planáris RGB) → a geq megőrzi az alfát (a='alpha(X,Y)'); utána vissza rgba-ra
  return (
    `,format=gbrap,geq=` +
    `r='${s.r}*(1-${L})+${h.r}*(${L})':` +
    `g='${s.g}*(1-${L})+${h.g}*(${L})':` +
    `b='${s.b}*(1-${L})+${h.b}*(${L})':` +
    `a='alpha(X,Y)',format=rgba`
  );
}

// 🩹 folt-javítás / objektum-eltávolítás: doboz-lokális (0–1) téglalapok → ffmpeg `delogo`
// (a régiót a környezetéből interpolálja). A delogo 1px belső keretet kíván (x/y≥1, x+w≤W-1),
// ezért a téglalapokat a képbe CLAMPeljük. Vezető-vesszős lánc; üres, ha nincs régió. (pure)
function healChain(regions, W, H) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return '';
  }
  const parts = [];
  for (const r of regions) {
    let x = Math.round((Number(r.x) || 0) * W);
    let y = Math.round((Number(r.y) || 0) * H);
    let w = Math.round((Number(r.w) || 0) * W);
    let h = Math.round((Number(r.h) || 0) * H);
    x = Math.max(1, Math.min(x, W - 3));
    y = Math.max(1, Math.min(y, H - 3));
    w = Math.max(1, Math.min(w, W - x - 2));
    h = Math.max(1, Math.min(h, H - y - 2));
    if (w >= 1 && h >= 1) {
      parts.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
    }
  }
  return parts.length ? ',' + parts.join(',') : '';
}

module.exports = {
  filterChain,
  oneFilter,
  sepiaMixer,
  maskGradientFilter,
  shadowSilhouette,
  glowSilhouette,
  hexToRgb,
  strokeSilhouette,
  perspectiveFilter,
  gradientMapFilter,
  healChain,
};
