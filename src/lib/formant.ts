/**
 * 🗣️ AUDIO-PROD V7.3 — formáns-korrekció a hangmagasság-eltolás után. Pure, expo-mentes; a szerver
 * `server/lib/formant.js` SORRÓL SORRA a tükre (szerződés-teszt: bitre azonos kimenet).
 *
 * Egy egyszerű hangmagasság-tolás (a telefon natív nyújtója, a szerver asetrate+atempo) a hangszín
 * burkológörbéjét (a formánsokat) is eltolja → „mókus" / „óriás" hang. Itt a tolás UTÁN keretenként
 * (STFT, 2048 minta, 50 % átfedés, gyök-Hann; a két jel és a két burkoló egy-egy közös komplex FFT-ben) a tolt jel spektrumát a burkológörbék arányával
 * szorozzuk: az eredeti (időben illesztett, tolatlan) jel burkolója / a tolt jel burkolója. A burkoló
 * kepsztrális simítás (a kepsztrum az első ~1,2 ms-ig, az alaphang periódusa alatt) — így a
 * harmonikusok (az új hangmagasság) maradnak, a formánsok visszakerülnek a helyükre.
 */

export const FORMANT_N = 2048;
// 2026-11-14: 50 % átfedés (gyök-Hann × gyök-Hann = sin², félkeretenként összegezve 1) — a 75 %-os felét adja
const HOP = FORMANT_N / 2;
/** a burkoló simítása: a kepsztrum ennyi mp-ig marad (az 800 Hz alatti alaphangok periódusa alatt) */
const LIFTER_SEC = 0.0012;
/** a korrekció ±18 dB-re szorítva (zajos / néma kereteken ne robbanjon) */
const MAX_GAIN = 8;
const MIN_GAIN = 1 / 8;
/** ennél halkabb keret érintetlen marad (a csend burkolója zaj) */
const SILENT_POWER = 1e-10;

const tables = new Map<number, { rev: Uint32Array; cos: Float64Array; sin: Float64Array }>();
function tablesFor(n: number) {
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
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
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
/** gyök-Hann elemzés × szintézis 50 %-on: Σ sin² = 1 */
const OLA_NORM = 1;

/**
 * A tolt jel (`shifted`) formánsai az időben illesztett eredeti (`ref`) burkolójára. A kimenet hossza
 * a `shifted`-é; a `ref` ugyanazon az idővonalon (ugyanolyan sebességgel nyújtva, de tolatlanul).
 *
 * Keretenként 4 FFT: (1) a ref és a tolt jel EGY komplex FFT-ben (valós + képzetes rész), szétválasztva a
 * hermitikus szimmetriával; (2) a két log-amplitúdó egy inverz FFT-ben → a két kepsztrum; (3) a simított
 * kepsztrumok egy FFT-ben → a két burkoló; (4) a módosított spektrum inverze.
 */
export function formantCorrect(ref: Float32Array, shifted: Float32Array, sampleRate: number): Float32Array {
  const n = FORMANT_N;
  const len = shifted.length;
  const out = new Float64Array(len + n);
  const lifter = Math.max(4, Math.round(LIFTER_SEC * sampleRate));
  const xr = new Float64Array(n);
  const xi = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  const cr = new Float64Array(n);
  const ci = new Float64Array(n);
  for (let start = -n + HOP; start < len; start += HOP) {
    let powA = 0;
    let powB = 0;
    for (let i = 0; i < n; i++) {
      const at = start + i;
      const a = at >= 0 && at < ref.length ? ref[at] * WIN[i] : 0;
      const b = at >= 0 && at < len ? shifted[at] * WIN[i] : 0;
      xr[i] = a;
      xi[i] = b;
      powA += a * a;
      powB += b * b;
    }
    if (powB / n <= SILENT_POWER) continue; // a néma keret 0 marad
    fft(xr, xi, false);
    // szétválasztás: A = (X[k] + conj X[n−k]) / 2 (a ref), B = (X[k] − conj X[n−k]) / 2i (a tolt jel)
    for (let k = 0; k < n; k++) {
      const m = (n - k) % n;
      br[k] = (xi[k] + xi[m]) / 2;
      bi[k] = (xr[m] - xr[k]) / 2;
      if (powA / n > SILENT_POWER) {
        const ar = (xr[k] + xr[m]) / 2;
        const ai = (xi[k] - xi[m]) / 2;
        cr[k] = Math.log(Math.sqrt(ar * ar + ai * ai) + 1e-9);
        ci[k] = Math.log(Math.sqrt(br[k] * br[k] + bi[k] * bi[k]) + 1e-9);
      }
    }
    if (powA / n > SILENT_POWER) {
      fft(cr, ci, true); // a két (valós, páros) log-spektrum → két valós kepsztrum (n-szeres)
      for (let q = 0; q < n; q++) {
        const keep = q <= lifter || q >= n - lifter;
        cr[q] = keep ? cr[q] / n : 0;
        ci[q] = keep ? ci[q] / n : 0;
      }
      fft(cr, ci, false); // → a két simított log-burkoló (valós rész: ref, képzetes: tolt)
      for (let k = 0; k < n; k++) {
        const g = Math.min(MAX_GAIN, Math.max(MIN_GAIN, Math.exp(cr[k] - ci[k])));
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
