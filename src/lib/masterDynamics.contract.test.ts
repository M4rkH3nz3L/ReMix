/** 🗜️🔥 R4: a master-kompresszor és -szaturáció a telefonon = a szerveren (valódi ffmpeg-gel) */
/* eslint-disable @typescript-eslint/no-require-imports */
// a kliens tsconfig-jában nincsenek Node-típusok: a Node-modulok require-rel (mint a szerver-modulok)
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

import { buildMasterChain, saturationDrive, Saturator } from './audioDsp';
const worker = require('../../server/voicechain');

const SR = 44100;
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) throw new Error('A CI-ben kötelező az ffmpeg (a hang-paritáshoz).');

const sine = (amp: number, sec = 1, hz = 1000) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array, from = 0) => {
  let e = 0;
  for (let i = from; i < x.length; i++) e += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(e / (x.length - from)));
};

/** a szerver master-gráfja ffmpeg-gel: sztereó float32 be → ki (bal csatorna) */
function serverMaster(master: Record<string, unknown>, input: Float32Array): Float32Array {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mst-'));
  try {
    const inter = new Float32Array(input.length * 2);
    input.forEach((v, i) => {
      inter[2 * i] = v;
      inter[2 * i + 1] = v;
    });
    const src = path.join(dir, 'in.f32');
    fs.writeFileSync(src, new Uint8Array(inter.buffer));
    const graph = (worker.masterGraph(master, 'out') as string).replace('[0:a]', '[0:a]');
    const out: { buffer: ArrayBuffer; byteOffset: number; byteLength: number } = execFileSync('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', src, '-filter_complex', graph, '-map', '[out]', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-'], { maxBuffer: 1 << 26 });
    const f = new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
    return Float32Array.from({ length: f.length / 2 }, (_, i) => f[2 * i]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function clientMaster(master: Parameters<typeof buildMasterChain>[0], input: Float32Array): Float32Array {
  const l = Float32Array.from(input);
  const r = Float32Array.from(input);
  for (const p of buildMasterChain(master, SR)) p.processStereo(l, r, 0);
  return l;
}

describe('master-szaturáció (tiszta mag)', () => {
  it('a 0 dBFS marad 0 dBFS, a halk rész erősödik, 0 mérték = nincs fokozat', () => {
    const s = new Saturator(saturationDrive(0.5)!);
    const l = Float32Array.from([1, -1, 0.1]);
    const r = Float32Array.from(l);
    s.processStereo(l, r);
    expect(l[0]).toBeCloseTo(1, 9);
    expect(l[1]).toBeCloseTo(-1, 9);
    expect(l[2]).toBeGreaterThan(0.1);
    expect(saturationDrive(0)).toBeNull();
  });
});

(hasFfmpeg ? describe : describe.skip)('🤝 telefon = szerver (ffmpeg)', () => {
  it('szaturáció: mintára egyezik (aeval tanh ↔ Saturator)', () => {
    const x = sine(0.5);
    const a = clientMaster({ saturation: 0.5, truePeak: -1 }, x);
    const b = serverMaster({ saturation: 0.5 }, x);
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    expect(d).toBeLessThan(1e-5);
  });
  it('kompresszor (−20 dB, 4:1): a beállt szint a telefonon és a szerveren ± 0,5 dB, és ténylegesen tömörít', () => {
    const x = sine(0.5, 2);
    const a = clientMaster({ compressor: { threshold: -20, ratio: 4 }, truePeak: -1 }, x);
    const b = serverMaster({ compressor: { threshold: -20, ratio: 4 } }, x);
    const from = SR; // a beállás után
    expect(Math.abs(rms(a, from) - rms(b, from))).toBeLessThan(0.5);
    expect(rms(x, from) - rms(a, from)).toBeGreaterThan(6);
  });
});
