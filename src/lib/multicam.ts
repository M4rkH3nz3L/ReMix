/**
 * 🎬 Multicam — több kameraszög egy eseményről, hang alapján szinkronizálva.
 *
 * Pure réteg (nincs UI/IO): a hullámforma-csúcsokból KERESZTKORRELÁCIÓVAL
 * kiszámolja a szögök egymáshoz képesti eltolását (audio/waveform sync), és a
 * vágás-listát (melyik szög mikor aktív) idővonal-SZEGMENSEKRE bontja. A UI a
 * szegmensekből néma videóklipeket + egy folytonos master-audio klipet épít
 * (a `master` szög hangja szól végig) — így a meglévő render/preview mind ingyen
 * működik rajta.
 */

export interface AnglePeaks {
  /** hullámforma-burkológörbe (0…1 csúcsok) */
  peaks: number[];
  /** csúcs / másodperc (a peaks felbontása) */
  peaksPerSecond: number;
}

/** Vágás: a `t` multicam-időtől a `angle` szög aktív. */
export interface MulticamCut {
  t: number;
  angle: number;
}

/** Egy kész idővonal-szegmens (a flatten eredménye). */
export interface MulticamSegment {
  angle: number;
  /** multicam-idő (mp) */
  start: number;
  duration: number;
  /** a forrásfájlon belüli kezdőpont az adott szögnél (mp) */
  srcIn: number;
}

function resamplePeaks(peaks: number[], fromPps: number, toPps: number): number[] {
  if (fromPps === toPps || peaks.length === 0) {
    return peaks;
  }
  const outLen = Math.max(1, Math.round((peaks.length / fromPps) * toPps));
  const out = new Array<number>(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = peaks[Math.min(peaks.length - 1, Math.floor((i / toPps) * fromPps))] ?? 0;
  }
  return out;
}

/**
 * A `other` szög eltolása a `ref`-hez képest (mp). Pozitív érték = a `other`
 * forrás KÉSŐBB kezdődik az eseményhez képest, azaz `srcOther = multicamT +
 * offset`. Normalizált keresztkorreláció a csúcs-burkológörbéken.
 */
function correlateOffset(ref: AnglePeaks, other: AnglePeaks, maxLagSec = 60): number {
  const pps = ref.peaksPerSecond;
  const A = ref.peaks;
  const B = resamplePeaks(other.peaks, other.peaksPerSecond, pps);
  if (A.length < 2 || B.length < 2) {
    return 0;
  }
  const maxLag = Math.min(Math.round(maxLagSec * pps), Math.max(A.length, B.length) - 1);
  let bestLag = 0;
  let bestScore = -Infinity;
  // lag > 0 → B-t jobbra csúsztatjuk (B[k] ~ A[k+lag]); lag < 0 → balra
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    let n = 0;
    const kStart = Math.max(0, -lag);
    const kEnd = Math.min(A.length, B.length - lag);
    for (let k = kStart; k < kEnd; k++) {
      const a = A[k];
      const b = B[k + lag];
      dot += a * b;
      na += a * a;
      nb += b * b;
      n++;
    }
    if (n < 4 || na === 0 || nb === 0) {
      continue;
    }
    // normalizált korreláció, enyhén büntetve a rövid átfedést
    const score = (dot / Math.sqrt(na * nb)) * Math.min(1, n / (pps * 2));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // B[k] ~ A[k+lag]: a `other` esemény `lag` csúccsal KÉSŐBB van a fájljában,
  // mint a ref-ben → srcOther = multicamT + lag/pps
  return bestLag / pps;
}

/**
 * A szögök eltolása a REFERENCIÁHOZ (0-ás index) képest, mp-ben. `offset[0]=0`;
 * `srcTime_i(multicamT) = multicamT + offset[i]`.
 */
export function syncByWaveform(angles: AnglePeaks[]): number[] {
  if (angles.length === 0) {
    return [];
  }
  const ref = angles[0];
  return angles.map((a, i) => (i === 0 ? 0 : correlateOffset(ref, a)));
}

/** Egymás melletti AZONOS szögű vágások összevonása + rendezés + t=0 biztosítása. */
export function normalizeCuts(cuts: MulticamCut[], firstAngle = 0): MulticamCut[] {
  const sorted = [...cuts].filter((c) => c.t >= 0).sort((a, b) => a.t - b.t);
  if (sorted.length === 0 || sorted[0].t > 0.0001) {
    sorted.unshift({ t: 0, angle: sorted[0]?.angle ?? firstAngle });
  }
  const out: MulticamCut[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.angle === c.angle) {
      continue; // ugyanaz a szög — nincs új vágás
    }
    if (prev && c.t - prev.t < 0.0001) {
      out[out.length - 1] = c; // azonos időpont → az utóbbi nyer
    } else {
      out.push(c);
    }
  }
  return out;
}

/**
 * A vágás-lista idővonal-szegmensekre bontása. `offsets` a `syncByWaveform`-ból;
 * `masterDuration` a multicam-idővonal hossza; `angleDurations` a szögök
 * forráshossza (a srcIn-t ehhez zárjuk).
 */
export function multicamSegments(
  cuts: MulticamCut[],
  offsets: number[],
  masterDuration: number,
  angleDurations: number[]
): MulticamSegment[] {
  const norm = normalizeCuts(cuts);
  const segs: MulticamSegment[] = [];
  for (let i = 0; i < norm.length; i++) {
    const start = Math.max(0, norm[i].t);
    const end = i + 1 < norm.length ? norm[i + 1].t : masterDuration;
    const duration = Math.round((end - start) * 1000) / 1000;
    if (duration <= 0.001) {
      continue;
    }
    const angle = norm[i].angle;
    const dur = angleDurations[angle] ?? masterDuration;
    const srcIn = Math.min(Math.max(0, start + (offsets[angle] ?? 0)), Math.max(0, dur - duration));
    segs.push({ angle, start, duration, srcIn: Math.round(srcIn * 1000) / 1000 });
  }
  return segs;
}
