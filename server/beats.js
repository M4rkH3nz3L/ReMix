// Beat-analízis (P0-2 Beat Sync): ffmpeg-gel dekódolt mono PCM-ből
// energia-fluxus onset-görbe → autokorrelációs BPM-becslés → fázis-illesztett,
// lokális csúcsra igazított beat-rács + downbeat-fázis + energia-görbe.
// Szándékosan függőség-mentes (nincs aubio/librosa) — a pontosság rövid,
// ütemes zenéknél (short-form use case) bőven elég, és mindenhol fut.
const { spawn } = require('child_process');

const SR = 11025; // mono, elég a ritmushoz
const WIN = 1024;
const HOP = 512; // ~46,4 ms felbontás
const HOP_SEC = HOP / SR;
const BPM_MIN = 60;
const BPM_MAX = 200;

/** ffmpeg → mono f32 PCM (a teljes fájl memóriában — rövid zenékre méretezve) */
function decodePcm(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1'],
      { timeout: 5 * 60 * 1000 }
    );
    const chunks = [];
    let total = 0;
    let stderrTail = '';
    child.stdout.on('data', (c) => {
      chunks.push(c);
      total += c.length;
      if (total > 512 * 1024 * 1024) {
        child.kill('SIGKILL');
        reject(new Error('A hangfájl túl hosszú a beat-analízishez.'));
      }
    });
    child.stderr.on('data', (c) => {
      stderrTail = (stderrTail + c.toString()).slice(-500);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg dekódolás hiba: ${stderrTail}`));
        return;
      }
      const buf = Buffer.concat(chunks, total);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

/** RMS-energia hop-onként, majd pozitív különbség (fluxus) + 3-tap simítás */
function onsetEnvelope(pcm) {
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
function estimateTempo(flux) {
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
  if (bestLag === 0) {
    return null;
  }
  // tört periódus finomítása fésű-pásztázással: a legjobb fázisú rács-összeg
  // pontoz (az autokorreláció comb-csúcsa két egész lag közé is eshet)
  const combScore = (period) => {
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
function beatPositions(flux, periodHops) {
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
  const beats = [];
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
function downbeatOffset(flux, beatIdx) {
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

/** Pure elemzés PCM-ből — tesztelhető ffmpeg nélkül. */
function analyzeBeatsFromPcm(pcm, sampleRate = SR) {
  if (sampleRate !== SR) {
    throw new Error(`A beat-analízis ${SR} Hz-re van hangolva.`);
  }
  const duration = pcm.length / SR;
  const { flux, energy } = onsetEnvelope(pcm);
  const periodHops = estimateTempo(flux);
  if (!periodHops || flux.length < 8) {
    return { bpm: 0, beats: [], downbeats: [], energy: [], duration };
  }
  const beatIdx = beatPositions(flux, periodHops);
  const beats = beatIdx.map((i) => Math.round(i * HOP_SEC * 1000) / 1000);
  const dbOff = downbeatOffset(flux, beatIdx);
  const downbeats = beats.filter((_, k) => k % 4 === dbOff);
  // 0,5 mp-es normalizált energia-blokkok (drop/energia-szint a tervezőknek)
  const blockHops = Math.max(1, Math.round(0.5 / HOP_SEC));
  const blocks = [];
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

/** Fájl → beat-rács (ffmpeg-dekódolással). */
async function analyzeBeats(file) {
  const pcm = await decodePcm(file);
  return analyzeBeatsFromPcm(pcm, SR);
}

module.exports = { analyzeBeats, analyzeBeatsFromPcm, SR };
