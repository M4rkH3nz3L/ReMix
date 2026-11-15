/**
 * 🎚️ V5 (AUDIO-PROD, prototípus) — stem-szétválasztás a telefonon (expo-mentes, tiszta mag).
 *
 * Döntés 2026-11-15: Spleeter 2stems (deezer/spleeter — MIT kód és modellek; az élesítés előtt jogi megerősítés),
 * Core ML-re alakítva; a modell egy `[1, 2, 512, 1024]` magnitúdó-blokkból (csatorna × keret × frekvencia-sáv)
 * az ének és a kíséret maszkolt magnitúdóját adja. Itt a Spleeterrel azonos jelút: STFT (4096 / 1024, periodikus
 * Hann), arány-maszk 2-es kitevővel, a 11 kHz feletti sávok nullázva (`mask_extension: zeros`), inverz STFT pontos
 * ablak-összeggel. A bal és a jobb csatorna egy komplex FFT-ben (re = L, im = R). A modell-hívás injektált.
 */
import { fft } from '@/lib/denoise';

export const STEM_N = 4096;
export const STEM_HOP = 1024;
export const STEM_T = 512;
export const STEM_F = 1024;
const EPS = 1e-10;

export type StemPredict = (mag: Float32Array) => Promise<[Float32Array, Float32Array]>;

const win = (() => {
  const w = new Float64Array(STEM_N);
  for (let i = 0; i < STEM_N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / STEM_N); // periodikus Hann
  return w;
})();

export function stemFrames(length: number): number {
  return 1 + Math.floor(length / STEM_HOP);
}

/**
 * A blokk-kernelek (a natív `RemixRender.stemForward` / `stemInverse` ugyanezt számolja vDSP-vel):
 * - `forward`: a `frameStart`-tól `nb` keret → `re` / `im` ([2 csatorna][T][F]) és a modell-bemenet `mag` ([2][T][F])
 * - `inverse`: arány-maszk (`v`, `a` a modell kimenete), inverz FFT, átlapolt összeadás az `out`-ba (4 × hossz:
 *   ének L, ének R, kíséret L, kíséret R) és az ablak-összeg a `wsum`-ba
 */
export interface StemKernels {
  forward(l: Float32Array, r: Float32Array, frameStart: number, nb: number, re: Float32Array, im: Float32Array, mag: Float32Array): void;
  inverse(re: Float32Array, im: Float32Array, v: Float32Array, a: Float32Array, frameStart: number, nb: number, out: Float32Array, wsum: Float32Array, length: number): void;
}

const PLANE = STEM_T * STEM_F;
const zr = new Float64Array(STEM_N);
const zi = new Float64Array(STEM_N);

export const jsStemKernels: StemKernels = {
  forward(l, r, frameStart, nb, re, im, mag) {
    const L = l.length;
    const N = STEM_N;
    mag.fill(0);
    for (let t = 0; t < nb; t++) {
      const s0 = (frameStart + t) * STEM_HOP - N / 2;
      for (let i = 0; i < N; i++) {
        const p = s0 + i;
        const inside = p >= 0 && p < L;
        zr[i] = inside ? l[p] * win[i] : 0;
        zi[i] = inside ? r[p] * win[i] : 0;
      }
      fft(zr, zi, false);
      for (let k = 0; k < STEM_F; k++) {
        const nk = (N - k) % N;
        const lr = (zr[k] + zr[nk]) * 0.5;
        const li = (zi[k] - zi[nk]) * 0.5;
        const rr = (zi[k] + zi[nk]) * 0.5;
        const ri = (zr[nk] - zr[k]) * 0.5;
        const o = t * STEM_F + k;
        re[o] = lr;
        im[o] = li;
        re[PLANE + o] = rr;
        im[PLANE + o] = ri;
        mag[o] = Math.hypot(lr, li);
        mag[PLANE + o] = Math.hypot(rr, ri);
      }
    }
  },
  inverse(re, im, v, a, frameStart, nb, out, wsum, L) {
    const N = STEM_N;
    for (let stem = 0; stem < 2; stem++) {
      const oL = stem * 2 * L;
      const oR = (stem * 2 + 1) * L;
      for (let t = 0; t < nb; t++) {
        zr.fill(0);
        zi.fill(0);
        for (let k = 0; k < STEM_F; k++) {
          const o = t * STEM_F + k;
          const vl = v[o] * v[o];
          const al = a[o] * a[o];
          const vr = v[PLANE + o] * v[PLANE + o];
          const ar = a[PLANE + o] * a[PLANE + o];
          const ml = ((stem === 0 ? vl : al) + EPS / 2) / (vl + al + EPS);
          const mr = ((stem === 0 ? vr : ar) + EPS / 2) / (vr + ar + EPS);
          const xlr = re[o] * ml;
          const xli = im[o] * ml;
          const xrr = re[PLANE + o] * mr;
          const xri = im[PLANE + o] * mr;
          // Z[k] = XL[k] + i·XR[k];  Z[N−k] = conj(XL[k]) + i·conj(XR[k])
          zr[k] = xlr - xri;
          zi[k] = xli + xrr;
          if (k > 0) {
            zr[N - k] = xlr + xri;
            zi[N - k] = -xli + xrr;
          }
        }
        fft(zr, zi, true);
        const s0 = (frameStart + t) * STEM_HOP - N / 2;
        for (let i = 0; i < N; i++) {
          const p = s0 + i;
          if (p < 0 || p >= L) continue;
          out[oL + p] += (zr[i] / N) * win[i];
          out[oR + p] += (zi[i] / N) * win[i];
          if (stem === 0) wsum[p] += win[i] * win[i];
        }
      }
    }
  },
};

/**
 * Két stem (ének, kíséret) sztereó bemenetből. `predict` a modell (blokkonként egy hívás), `kernels` a jelút
 * (alapból JS; a telefonon natív), `onRatio` a haladás.
 */
export async function separateTwoStems(
  l: Float32Array,
  r: Float32Array,
  predict: StemPredict,
  onRatio?: (ratio: number) => void,
  kernels: StemKernels = jsStemKernels
): Promise<{ vocals: [Float32Array, Float32Array]; accompaniment: [Float32Array, Float32Array] }> {
  const L = l.length;
  const frames = stemFrames(L);
  const out = new Float32Array(4 * L);
  const wsum = new Float32Array(L);
  const re = new Float32Array(2 * PLANE);
  const im = new Float32Array(2 * PLANE);
  const mag = new Float32Array(2 * PLANE);
  for (let fb = 0; fb < frames; fb += STEM_T) {
    const nb = Math.min(STEM_T, frames - fb);
    kernels.forward(l, r, fb, nb, re, im, mag);
    const [v, a] = await predict(mag);
    kernels.inverse(re, im, v, a, fb, nb, out, wsum, L);
    onRatio?.(Math.min(1, (fb + nb) / frames));
    // a felület lélegezhet a blokkok között
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (let p = 0; p < L; p++) {
    const w = wsum[p] > 1e-8 ? 1 / wsum[p] : 0;
    out[p] *= w;
    out[L + p] *= w;
    out[2 * L + p] *= w;
    out[3 * L + p] *= w;
  }
  return { vocals: [out.subarray(0, L), out.subarray(L, 2 * L)], accompaniment: [out.subarray(2 * L, 3 * L), out.subarray(3 * L, 4 * L)] };
}
