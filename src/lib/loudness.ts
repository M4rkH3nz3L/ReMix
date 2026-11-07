import { Biquad } from '@/lib/audioDsp';

/**
 * 📏 Integrált hangosság (LUFS) az ITU-R BS.1770-4 szerint: K-súlyozás (magas-polc + RLB
 * felüláteresztő), 400 ms-os blokkok 75% átfedéssel, abszolút (−70 LUFS) és relatív (−10 LU)
 * kapuzás. A normalizálás (klip és master) ezzel mér — a referencia az ffmpeg `ebur128`-a.
 */

/** a K-súlyozás két szakasza tetszőleges mintavételre (a szabvány analóg paramétereiből, RBJ) */
function kWeighting(sr: number): Biquad[] {
  // 1. magas-polc: f0 ≈ 1682 Hz, +4 dB, Q ≈ 0,7072
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf = new Biquad({
    b0: Vh + (Vb * K) / Q + K * K,
    b1: 2 * (K * K - Vh),
    b2: Vh - (Vb * K) / Q + K * K,
    a0,
    a1: 2 * (K * K - 1),
    a2: 1 - K / Q + K * K,
  });
  // 2. RLB felüláteresztő: f0 ≈ 38,1 Hz, Q ≈ 0,5003
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const hp = new Biquad({
    b0: 1,
    b1: -2,
    b2: 1,
    a0: 1 + K1 / Q1 + K1 * K1,
    a1: 2 * (K1 * K1 - 1),
    a2: 1 - K1 / Q1 + K1 * K1,
  });
  // a második szakasz számlálója a szabványban 1, −2, 1 — az a0-val normálva
  return [shelf, hp];
}

/** integrált hangosság LUFS-ben (sztereó; a csend −Infinity) */
export function integratedLoudness(l: Float32Array, r: Float32Array, sr: number): number {
  const kl = Float32Array.from(l);
  const kr = Float32Array.from(r);
  for (const f of kWeighting(sr)) {
    f.processStereo(kl, kr);
  }
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const powers: number[] = [];
  for (let start = 0; start + block <= kl.length; start += step) {
    let sl = 0;
    let sr2 = 0;
    for (let i = start; i < start + block; i++) {
      sl += kl[i] * kl[i];
      sr2 += kr[i] * kr[i];
    }
    powers.push((sl + sr2) / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (abs.length === 0) {
    return -Infinity;
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const relGate = lufs(mean(abs)) - 10;
  const rel = abs.filter((p) => lufs(p) > relGate);
  return rel.length > 0 ? lufs(mean(rel)) : -Infinity;
}
