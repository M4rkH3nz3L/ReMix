/**
 * 🎨 Filmes grade-presetek (LUT-szerű look-ok) — KÖZÖS forrás a worker-oldalon.
 *
 * Minden preset ffmpeg-szűrők LISTÁJA (split-tone: eq + colorbalance s/m/h +
 * esetleg vignette). A videó-render (`render.js` grade-réteg) UGYANEZT a térképet
 * használja, per-filter `enable`-ablakkal; a kép-render (`imagedoc.js` fotó-réteg)
 * a `gradeFilterChain()` vezető-vesszős füzérét teszi a prepared-láncba.
 *
 * A kliens `src/constants/grades.ts` UGYANEZEKKEL az id-kkal ad előnézeti
 * tint-közelítést + chip-metát — a három együtt módosítandó (előnézet = export).
 */
const GRADES = {
  'teal-orange': [
    'eq=contrast=1.10:saturation=1.08',
    'colorbalance=rs=-0.12:gs=0.02:bs=0.16:rh=0.16:gh=0.03:bh=-0.14',
  ],
  moody: [
    'eq=brightness=-0.04:contrast=1.12:saturation=0.82',
    'colorbalance=rs=-0.04:bs=0.12:rm=-0.03:bm=0.06',
    'vignette=angle=0.9',
  ],
  vintage: [
    'eq=brightness=0.03:contrast=0.9:saturation=0.85:gamma=1.06',
    'colorbalance=rs=0.10:gs=0.05:bs=-0.08:rh=0.10:bh=-0.12',
  ],
  noir: ['eq=brightness=-0.02:contrast=1.25:saturation=0', 'vignette=angle=0.8'],
  'warm-film': [
    'eq=contrast=1.06:saturation=1.05',
    'colorbalance=rm=0.10:gm=0.03:bm=-0.12:rh=0.08:bh=-0.10',
  ],
  cold: [
    'eq=contrast=1.06',
    'colorbalance=rm=-0.10:bm=0.12:rs=-0.06:bs=0.12:rh=-0.04:bh=0.06',
  ],
  vibrant: ['eq=contrast=1.12:saturation=1.35:gamma=0.98'],
  dreamy: [
    'eq=brightness=0.05:contrast=0.9:saturation=1.08:gamma=1.05',
    'colorbalance=rm=0.06:bm=0.06:rh=0.08:bh=0.04',
  ],
};

/**
 * id → vezető-vesszős ffmpeg-füzér (pl. ',eq=...,colorbalance=...'). Ablak/enable
 * NÉLKÜL (a kép-render egyetlen állóképet éget). Ismeretlen / 'none' / üres → ''.
 */
function gradeFilterChain(id) {
  const preset = id && id !== 'none' ? GRADES[id] : null;
  if (!preset || !preset.length) {
    return '';
  }
  return ',' + preset.join(',');
}

module.exports = { GRADES, gradeFilterChain };
