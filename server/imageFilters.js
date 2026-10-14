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

module.exports = { filterChain, oneFilter, sepiaMixer, maskGradientFilter };
