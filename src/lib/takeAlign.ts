/**
 * 🎯 Take-illesztés — tiszta mag (expo-mentes). A felvett take és egy ismert referencia (a
 * count-in kattanás-sávja, vagy a punch alatt szóló klip) normalizált keresztkorrelációja: a take
 * j. mintája ↔ a referencia `guess + j/sr + shift` idejében. A hangszórón át áthallott referencia így
 * a valódi oda-vissza késést méri (a lejátszó puffere + kimenet + mikrofon) — amit az órák nem
 * látnak (mérve: iPaden ~50–80 ms a lejátszótól függően).
 *
 * Durva keresés 4-es lépéssel, utána mintapontos finomítás; elfogadás csak elég erős korrelációnál
 * (különben nincs áthallás — fejhallgató, halk lejátszás — és a hívó a tárolt kalibrációt használja).
 */

export interface AlignResult {
  /** mp: a valódi hely − a becsült (pozitív = a take a becsültnél később ül) */
  shift: number;
  /** normalizált korreláció a legjobb eltolásnál (0–1) */
  rho: number;
}

/** az elfogadás küszöbe (ennél gyengébb egyezés = nincs megbízható áthallás) */
export const ALIGN_MIN_RHO = 0.3;

export function alignTake(
  take: Float32Array,
  sr: number,
  refAt: (sec: number) => number,
  guess: number,
  window: [number, number],
  maxShift: number
): AlignResult | null {
  const a = Math.max(0, Math.round(window[0] * sr));
  const b = Math.min(take.length, Math.round(window[1] * sr));
  const n = b - a;
  const max = Math.round(maxShift * sr);
  if (n < sr * 0.1) return null;
  const corr = (lag: number, step: number) => {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let j = a; j < b; j += step) {
      const x = take[j];
      const r = refAt(guess + (j + lag) / sr);
      xy += x * r;
      xx += x * x;
      yy += r * r;
    }
    return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  };
  let best = 0;
  let bestV = -Infinity;
  for (let lag = -max; lag <= max; lag += 4) {
    const v = corr(lag, 4);
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  let fine = best;
  let fineV = -Infinity;
  for (let lag = best - 4; lag <= best + 4; lag++) {
    const v = corr(lag, 1);
    if (v > fineV) {
      fineV = v;
      fine = lag;
    }
  }
  return { shift: fine / sr, rho: fineV };
}
