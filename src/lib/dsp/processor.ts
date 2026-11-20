/**
 * 🎛️ A közös hang-DSP alapjai: a feldolgozó-lépés szerződése, a közös segédek (dB → lineáris,
 * simítási együttható, automáció-rács), az állandó erősítés és a lánc futtatása.
 */

/** egy sztereó feldolgozó lépés (helyben dolgozik; az állapota a darabok között megmarad) */
export interface Processor {
  /** `pos`: az `l[0]` minta helye a klipen belül — a blokkos frissítés rácsa ehhez igazodik,
   * így a darabolás (előnézet 125 ms, export 250 ms) nem hagy nyomot */
  processStereo(l: Float32Array, r: Float32Array, pos: number): void;
}

/** az automáció rácsa (minta): a klip saját idejéhez igazítva — a darabolás nem hagy nyomot */
export const AUTO_BLOCK = 64;

export const dbToLin = (db: number) => Math.pow(10, db / 20);
/** egypólusú simítás együtthatója `ms` időállandóra */
export const coeff = (ms: number, sr: number) => 1 - Math.exp(-1 / ((ms / 1000) * sr));

/** állandó erősítés (a normalizálás előre mért erősítése) */
export class Gain implements Processor {
  constructor(private readonly g: number) {}
  processStereo(l: Float32Array, r: Float32Array): void {
    for (let i = 0; i < l.length; i++) {
      l[i] *= this.g;
      r[i] *= this.g;
    }
  }
}

/** helyben feldolgoz egy sztereó szakaszt a láncon */
export function runChain(chain: Processor[], l: Float32Array, r: Float32Array, pos = 0): void {
  for (const p of chain) {
    p.processStereo(l, r, pos);
  }
}
