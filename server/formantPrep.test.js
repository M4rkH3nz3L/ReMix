const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareFormantClip, writeWavF32, readStereo, needsFormantPrep } = require('./formantPrep');
const { pitchFilters } = require('./voicechain');

/** 🗣️ V7.3: a szerveres formáns-előkészítés valódi ffmpeg-gel — a tolt magánhangzó hangszíne visszaáll. */
const SR = 44100;
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) {
  throw new Error('A CI-ben kötelező az ffmpeg (a hang-minőségkapukhoz).');
}

function vowel(f0, formants, n) {
  const src = new Float64Array(n);
  for (let t = 0; t < n; t += SR / f0) src[Math.round(t)] = 1;
  let x = src;
  for (const f of formants) {
    const r = Math.exp((-Math.PI * 80) / SR);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + a1 * (y[i - 1] || 0) - r * r * (y[i - 2] || 0);
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return Float32Array.from(x, (v) => (0.5 * v) / peak);
}

function centroid(x) {
  const n = 4096;
  const off = (x.length - n) >> 1;
  let num = 0;
  let den = 0;
  for (let k = Math.round((250 * n) / SR); k <= Math.round((3000 * n) / SR); k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      re += x[off + i] * w * Math.cos((2 * Math.PI * k * i) / n);
      im -= x[off + i] * w * Math.sin((2 * Math.PI * k * i) / n);
    }
    num += (re * re + im * im) * ((k * SR) / n);
    den += re * re + im * im;
  }
  return num / den;
}

describe('needsFormantPrep', () => {
  it('csak bekapcsolt formánsnál, nem nulla eltolásnál, nem loop-klipen', () => {
    expect(needsFormantPrep({ audioFx: { formant: true } }, 5)).toBe(true);
    expect(needsFormantPrep({ audioFx: { formant: true } }, 0)).toBe(false);
    expect(needsFormantPrep({ audioFx: { formant: false } }, 5)).toBe(false);
    expect(needsFormantPrep({ audioFx: { formant: true }, loopLength: 2 }, 5)).toBe(false);
  });
});

(hasFfmpeg ? describe : describe.skip)('prepareFormantClip (ffmpeg)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formant-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('+5 félhang: a naiv ffmpeg-tolás a formánsokat is viszi, az előkészített fájlban az eredeti helyükön; a hossz pontos', async () => {
    const v = vowel(150, [700, 1200], SR * 2);
    const src = path.join(dir, 'v.wav');
    writeWavF32(src, v, v);
    const win = 'atrim=start=0.250:end=1.750,asetpts=PTS-STARTPTS,';
    const out = await prepareFormantClip({ uri: src, windowFilter: win, semitones: 5, duration: 1.5, workDir: dir, key: 'c1' });
    // a kimeneti WAV adat-része f32le sztereó (44 bájtos fejléc után)
    const raw = path.join(dir, 'out.raw');
    fs.writeFileSync(raw, fs.readFileSync(out).subarray(44));
    const [l] = readStereo(raw);
    expect(l.length).toBe(Math.round(1.5 * SR));
    const naive = path.join(dir, 'naive.raw');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', `${win}${pitchFilters(5).join(',')}`, '-ac', '2', '-ar', String(SR), '-f', 'f32le', naive]);
    const [nl] = readStereo(naive);
    const c0 = centroid(v.subarray(Math.round(0.25 * SR), Math.round(1.75 * SR)));
    const c1 = centroid(nl);
    const c2 = centroid(l);
    expect(c1 / c0).toBeGreaterThan(1.2);
    expect(Math.abs(c2 / c0 - 1)).toBeLessThan(0.1);
  }, 60000);
});
