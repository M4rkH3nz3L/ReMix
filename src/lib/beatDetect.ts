import type { BeatGrid } from '@/lib/beats';

/**
 * 🥁 Tempó- és beat-felismerés a telefonon (AP3 / MU7) — a `server/beats.js` algoritmusának pontos
 * TS-párja: energia-fluxus onset-görbe → autokorrelációs BPM-becslés (60–200, 120 felé súlyozva) →
 * fésűvel finomított tört periódus → fázis-illesztett, lokális csúcsra igazított beat-rács +
 * downbeat-fázis + 0,5 s-os energia-blokkok. Pure: a szerződés-teszt a szerverrel bitre egyezteti.
 */

export const BEAT_SR = 11025; // mono, elég a ritmushoz
const WIN = 1024;
const HOP = 512; // ~46,4 ms felbontás
const HOP_SEC = HOP / BEAT_SR;
const BPM_MIN = 60;
const BPM_MAX = 200;

/** RMS-energia hop-onként, majd pozitív különbség (fluxus) + 3-tap simítás */
function onsetEnvelope(pcm: Float32Array): { flux: Float64Array; energy: Float64Array } {
  const frames = Math.max(0, Math.floor((pcm.length - WIN) / HOP) + 1);
  const energy = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const off = i * HOP;
    for (let j = 0; j < WIN; j++) {
      const v = pcm[off + j];
      sum += v * v;
    }
    energy[i] = Math.sqrt(sum / WIN);
  }
  const flux = new Float64Array(frames);
  for (let i = 1; i < frames; i++) {
    flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  }
  const smooth = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    smooth[i] = (flux[Math.max(0, i - 1)] + flux[i] + flux[Math.min(frames - 1, i + 1)]) / 3;
  }
  return { flux: smooth, energy };
}

/** autokorreláció a 60–200 BPM sávban; enyhe súly a 90–150 BPM felé */
function estimateTempo(flux: Float64Array): number | null {
  const minLag = Math.max(2, Math.round(60 / BPM_MAX / HOP_SEC));
  const maxLag = Math.round(60 / BPM_MIN / HOP_SEC);
  let bestLag = 0;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i + lag < flux.length; i++) {
      sum += flux[i] * flux[i + lag];
      n++;
    }
    if (n === 0) {
      continue;
    }
    const bpm = 60 / (lag * HOP_SEC);
    const weight = 1 / (1 + 0.35 * Math.abs(Math.log2(bpm / 120)));
    const score = (sum / n) * weight;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  // csend / ütemtelen zaj: nincs pozitív korreláció → nincs tempó (eddig a legkisebb lagot, ~260 BPM-et adta)
  if (bestLag === 0 || bestScore <= 0) {
    return null;
  }
  // tört periódus finomítása fésű-pásztázással: a legjobb fázisú rács-összeg
  // pontoz (az autokorreláció comb-csúcsa két egész lag közé is eshet)
  const combScore = (period: number): number => {
    const steps = Math.max(1, Math.round(period));
    let best = 0;
    for (let p = 0; p < steps; p++) {
      let sum = 0;
      for (let k = 0; ; k++) {
        const idx = Math.round(p + k * period);
        if (idx >= flux.length) {
          break;
        }
        sum += flux[idx];
      }
      best = Math.max(best, sum);
    }
    return best;
  };
  let refined = bestLag;
  let refinedScore = -1;
  for (let period = bestLag - 1; period <= bestLag + 1; period += 0.05) {
    const score = combScore(period);
    if (score > refinedScore) {
      refinedScore = score;
      refined = period;
    }
  }
  return refined;
}

/** fázis-kereséssel beat-pozíciók, lokális fluxus-csúcsra igazítva */
function beatPositions(flux: Float64Array, periodHops: number): number[] {
  const period = periodHops;
  const steps = Math.max(1, Math.round(period));
  let bestPhase = 0;
  let bestSum = -1;
  for (let p = 0; p < steps; p++) {
    let sum = 0;
    for (let k = 0; ; k++) {
      const idx = Math.round(p + k * period);
      if (idx >= flux.length) {
        break;
      }
      sum += flux[idx];
    }
    if (sum > bestSum) {
      bestSum = sum;
      bestPhase = p;
    }
  }
  const beats: number[] = [];
  for (let k = 0; ; k++) {
    let idx = Math.round(bestPhase + k * period);
    if (idx >= flux.length) {
      break;
    }
    // ±1 hop lokális csúcsra igazítás (nagyobb ablak már hallható jittert ad)
    for (const d of [-1, 1]) {
      const j = idx + d;
      if (j >= 0 && j < flux.length && flux[j] > flux[idx]) {
        idx = j;
      }
    }
    beats.push(idx);
  }
  return beats;
}

/** a 4-es ütem downbeat-fázisa: melyik mod-4 osztályon a legerősebb a fluxus */
function downbeatOffset(flux: Float64Array, beatIdx: number[]): number {
  let best = 0;
  let bestSum = -1;
  for (let d = 0; d < 4; d++) {
    let sum = 0;
    for (let k = d; k < beatIdx.length; k += 4) {
      sum += flux[beatIdx[k]];
    }
    if (sum > bestSum) {
      bestSum = sum;
      best = d;
    }
  }
  return best;
}

/** Pure elemzés PCM-ből (11 025 Hz, mono) — a `server/beats.js` `analyzeBeatsFromPcm` párja. */
export function analyzeBeatsFromPcm(pcm: Float32Array, sampleRate = BEAT_SR): BeatGrid {
  if (sampleRate !== BEAT_SR) {
    throw new Error(`A beat-analízis ${BEAT_SR} Hz-re van hangolva.`);
  }
  const duration = pcm.length / BEAT_SR;
  const { flux, energy } = onsetEnvelope(pcm);
  const periodHops = estimateTempo(flux);
  if (!periodHops || flux.length < 8) {
    return { bpm: 0, beats: [], downbeats: [], energy: [], duration };
  }
  const beatIdx = beatPositions(flux, periodHops);
  // a beat ideje az elemző ablak KÖZEPE (eddig az eleje: a beatek ~fél ablakkal, ~46 ms-mal korábbra estek)
  // + a fluxus-csúcs parabolikus finomítása (a hop-rácsnál pontosabb, ±fél hop)
  const subHop = (i: number): number => {
    if (i <= 0 || i >= flux.length - 1) return 0;
    const den = flux[i - 1] - 2 * flux[i] + flux[i + 1];
    return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (flux[i - 1] - flux[i + 1])) / den)) : 0;
  };
  const beats = beatIdx.map((i) => Math.round(((i + subHop(i)) * HOP_SEC + WIN / 2 / BEAT_SR) * 1000) / 1000);
  const dbOff = downbeatOffset(flux, beatIdx);
  const downbeats = beats.filter((_, k) => k % 4 === dbOff);
  // 0,5 mp-es normalizált energia-blokkok (drop/energia-szint a tervezőknek)
  const blockHops = Math.max(1, Math.round(0.5 / HOP_SEC));
  const blocks: number[] = [];
  let peak = 0;
  for (let i = 0; i < energy.length; i += blockHops) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < Math.min(i + blockHops, energy.length); j++) {
      sum += energy[j];
      n++;
    }
    const v = n > 0 ? sum / n : 0;
    peak = Math.max(peak, v);
    blocks.push(v);
  }
  const energyNorm = blocks.map((v) => (peak > 0 ? Math.round((v / peak) * 100) / 100 : 0));
  return {
    bpm: Math.round((60 / (periodHops * HOP_SEC)) * 10) / 10,
    beats,
    downbeats,
    energy: energyNorm,
    duration: Math.round(duration * 1000) / 1000,
  };
}
