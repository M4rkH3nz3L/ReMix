'use strict';

/**
 * 🗣️ AUDIO-PROD V7.3 — a kliens `src/lib/formant.ts` SORRÓL SORRA tükre (szerződés-teszt:
 * src/lib/formant.contract.test.ts — bitre azonos kimenet). Ne módosítsd az egyiket a másik nélkül.
 *
 * Egy egyszerű hangmagasság-tolás (a telefon natív nyújtója, a szerver asetrate+atempo) a hangszín
 * burkológörbéjét (a formánsokat) is eltolja → „mókus" / „óriás" hang. Itt a tolás UTÁN keretenként
 * (STFT, 2048 minta, 75 % átfedés, gyök-Hann) a tolt jel spektrumát a burkológörbék arányával
 * szorozzuk: az eredeti (időben illesztett, tolatlan) jel burkolója / a tolt jel burkolója. A burkoló
 * kepsztrális simítás (a kepsztrum az első ~1,2 ms-ig, az alaphang periódusa alatt) — így a
 * harmonikusok (az új hangmagasság) maradnak, a formánsok visszakerülnek a helyükre.
 */

const FORMANT_N = 2048;
const HOP = FORMANT_N / 4;
/** a burkoló simítása: a kepsztrum ennyi mp-ig marad (az 800 Hz alatti alaphangok periódusa alatt) */
const LIFTER_SEC = 0.0012;
/** a korrekció ±18 dB-re szorítva (zajos / néma kereteken ne robbanjon) */
const MAX_GAIN = 8;
const MIN_GAIN = 1 / 8;
/** ennél halkabb keret érintetlen marad (a csend burkolója zaj) */
const SILENT_POWER = 1e-10;

const tables = new Map();
function tablesFor(n) {
  let t = tables.get(n);
  if (!t) {
    const bits = Math.round(Math.log2(n));
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    t = { rev, cos, sin };
    tables.set(n, t);
  }
  return t;
}

/** helyben számolt radix-2 FFT (`inverse`: skálázás nélkül) */
function fft(re, im, inverse) {
  const n = re.length;
  const { rev, cos, sin } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const p = i + k;
        const q = p + half;
        const ar = re[q] * wr - im[q] * wi;
        const ai = re[q] * wi + im[q] * wr;
        re[q] = re[p] - ar;
        im[q] = im[p] - ai;
        re[p] += ar;
        im[p] += ai;
      }
    }
  }
}

const WIN = new Float64Array(FORMANT_N);
for (let i = 0; i < FORMANT_N; i++) WIN[i] = Math.sin((Math.PI * (i + 0.5)) / FORMANT_N);
/** gyök-Hann elemzés × szintézis 75 %-on: Σ sin² = 2 → a kimenet fele */
const OLA_NORM = 0.5;

/** a keret log-amplitúdó burkolója (kepsztrális simítás) a `re/im` spektrumból → `env` (lineáris) */
function envelope(re, im, lifter, env, cr, ci) {
  const n = re.length;
  for (let k = 0; k < n; k++) {
    cr[k] = Math.log(Math.sqrt(re[k] * re[k] + im[k] * im[k]) + 1e-9);
    ci[k] = 0;
  }
  fft(cr, ci, true); // valós, páros log-spektrum → valós kepsztrum (n-szeres)
  for (let q = 0; q < n; q++) {
    const keep = q <= lifter || q >= n - lifter;
    cr[q] = keep ? cr[q] / n : 0;
    ci[q] = 0;
  }
  fft(cr, ci, false);
  for (let k = 0; k < n; k++) env[k] = Math.exp(cr[k]);
}

/**
 * A tolt jel (`shifted`) formánsai az időben illesztett eredeti (`ref`) burkolójára. A kimenet hossza
 * a `shifted`-é; a `ref` ugyanazon az idővonalon (ugyanolyan sebességgel nyújtva, de tolatlanul).
 */
function formantCorrect(ref, shifted, sampleRate) {
  const n = FORMANT_N;
  const len = shifted.length;
  const out = new Float64Array(len + n);
  const lifter = Math.max(4, Math.round(LIFTER_SEC * sampleRate));
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  const envA = new Float64Array(n);
  const envB = new Float64Array(n);
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  // a keretek a jel előtt is indulnak (−n + HOP), hogy az eleje is teljes átfedést kapjon
  for (let start = -n + HOP; start < len; start += HOP) {
    let powA = 0;
    let powB = 0;
    for (let i = 0; i < n; i++) {
      const at = start + i;
      const a = at >= 0 && at < ref.length ? ref[at] : 0;
      const b = at >= 0 && at < len ? shifted[at] : 0;
      ar[i] = a * WIN[i];
      ai[i] = 0;
      br[i] = b * WIN[i];
      bi[i] = 0;
      powA += ar[i] * ar[i];
      powB += br[i] * br[i];
    }
    fft(br, bi, false);
    if (powA / n > SILENT_POWER && powB / n > SILENT_POWER) {
      fft(ar, ai, false);
      envelope(ar, ai, lifter, envA, cr, ci);
      envelope(br, bi, lifter, envB, cr, ci);
      for (let k = 0; k < n; k++) {
        const g = Math.min(MAX_GAIN, Math.max(MIN_GAIN, envA[k] / envB[k]));
        br[k] *= g;
        bi[k] *= g;
      }
    }
    fft(br, bi, true);
    for (let i = 0; i < n; i++) {
      const at = start + i;
      if (at >= 0) out[at] += (br[i] / n) * WIN[i] * OLA_NORM;
    }
  }
  return Float32Array.from(out.subarray(0, len));
}

module.exports = { FORMANT_N, formantCorrect };
