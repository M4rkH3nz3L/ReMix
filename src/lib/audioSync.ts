import { fft } from '@/lib/denoise';
import type { AudioClip } from '@/types/project';

/**
 * 🔗 Külső hang szinkronja — tiszta mag. Két felvétel (pl. a kamera hangja és egy külön mikrofon)
 * időbeli eltolása GCC-PHAT keresztkorrelációval: a spektrum csak a fázisát tartja meg (a két
 * mikrofon eltérő hangszíne, hangereje és zaja így alig számít), 100 Hz–4 kHz-re szűrve (a
 * beszéd sávja), majd a csúcs parabolával mintán belül pontosítva. A megbízhatóság a csúcs
 * kiemelkedése a korreláció szórásához képest.
 */

export interface SyncResult {
  /** ext(τ) ≈ ref(τ + lag) — mp, a két minta-sor elejéhez képest */
  lag: number;
  /**
   * a csúcs kiemelkedése a tiszta zaj várható legnagyobb csúcsához képest (z / √(2·ln n), n = a
   * vizsgált eltolások száma): ~1 = csak zaj; ≥ `SYNC_MIN_CONFIDENCE` = egyezés
   */
  confidence: number;
}

/**
 * ennél kisebb megbízhatóság: nincs biztos egyezés. Mérve: 10 idegen szintetikus felvétel
 * 1,26–1,58, egy idegen valódi beszéd (iPad) 1,95; a valódi egyezés zajos, tompább mikrofonnal
 * ~29 (teszt) és 88 (eszköz) — a 4 bőven a kettő között.
 */
export const SYNC_MIN_CONFIDENCE = 4;

const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Az eltolás GCC-PHAT-tal. `maxLag` (mp): a keresés ±tartománya (a `ref` hosszán belül).
 * Hermes-en ~1 M pontos FFT másodpercek alatt fut — a hívó ~10 s-os `ext`-et és ≤ 80 s-os
 * `ref`-et ad, 8–16 kHz-en.
 */
export function gccPhatLag(ref: Float32Array, ext: Float32Array, sr: number, maxLag = Infinity): SyncResult {
  const N = nextPow2(ref.length + ext.length);
  const ar = new Float64Array(N);
  const ai = new Float64Array(N);
  const br = new Float64Array(N);
  const bi = new Float64Array(N);
  ar.set(ref);
  br.set(ext);
  fft(ar, ai);
  fft(br, bi);
  const lo = Math.floor((100 * N) / sr);
  const hi = Math.ceil((4000 * N) / sr);
  for (let k = 0; k < N; k++) {
    const f = Math.min(k, N - k);
    // X · conj(Y), csak a fázis (PHAT), a beszéd sávjában
    const re = ar[k] * br[k] + ai[k] * bi[k];
    const im = ai[k] * br[k] - ar[k] * bi[k];
    const mag = Math.hypot(re, im);
    const keep = f >= lo && f <= hi && mag > 1e-20;
    ar[k] = keep ? re / mag : 0;
    ai[k] = keep ? im / mag : 0;
  }
  fft(ar, ai, true);
  const lagMax = Math.min(Math.floor(maxLag * sr), N / 2 - 1);
  let best = -Infinity;
  let bestK = 0;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let k = -lagMax; k <= lagMax; k++) {
    const v = ar[(k + N) % N];
    sum += v;
    sum2 += v * v;
    n++;
    if (v > best) {
      best = v;
      bestK = k;
    }
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(1e-30, sum2 / n - mean * mean));
  // parabolikus finomítás a csúcs két szomszédjával
  const y0 = ar[(bestK - 1 + N) % N];
  const y1 = best;
  const y2 = ar[(bestK + 1 + N) % N];
  const den = y0 - 2 * y1 + y2;
  const frac = Math.abs(den) > 1e-30 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
  return { lag: (bestK + frac) / sr, confidence: (best - mean) / sd / Math.sqrt(2 * Math.log(Math.max(3, n))) };
}

/**
 * A szinkronizált klip új helye. A talált eltolás a klip kezdetét adja; a kezdet a frame-rácsra
 * kerül (felfelé), a rácson túli maradékot a `trimIn` veszi át — így a hang mintapontosan a
 * helyén szól, a klip széle mégis a rácson van. 0 elé nem kerülhet (akkor az eleje levágódik).
 * `null`, ha a klipből nem maradna semmi.
 */
export function syncedPlacement(
  ext: Pick<AudioClip, 'start' | 'duration' | 'trimIn'>,
  target: number,
  fps: number
): { start: number; trimIn: number; duration: number } | null {
  const start = Math.max(0, Math.ceil(target * fps - 1e-6) / fps);
  const skip = start - target; // ≥ 0: ennyivel később indul → ennyivel később a forrásban is
  const trimIn = Math.round(((ext.trimIn ?? 0) + skip) * 1e6) / 1e6;
  const duration = Math.round((ext.duration - skip) * 1e6) / 1e6;
  if (duration <= 0.05) return null;
  return { start: Math.round(start * 1e6) / 1e6, trimIn, duration };
}

/**
 * A szinkron célja az idővonalon: a `ref` minta-sor a ref-klip forrásának `refFrom` pontjától, az
 * `ext` sor az ext-klip forrásának `extFrom` pontjától indul; a `lag` a `gccPhatLag` eredménye.
 */
export function syncTarget(
  ref: Pick<AudioClip, 'start' | 'trimIn'>,
  refFrom: number,
  ext: Pick<AudioClip, 'trimIn'>,
  extFrom: number,
  lag: number
): number {
  return ref.start + (refFrom - (ref.trimIn ?? 0)) + lag - (extFrom - (ext.trimIn ?? 0));
}
