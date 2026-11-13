/** 📏 A19: a telefonos keverés-mérés (LUFS, true-peak, LRA) = az ffmpeg `ebur128`-a (valódi ffmpeg-gel) */
/* eslint-disable @typescript-eslint/no-require-imports */
// a kliens tsconfig-jában nincsenek Node-típusok: a Node-modulok require-rel
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */
import { LiveLoudness } from '@/lib/liveLoudness';
import { encodeWav16 } from '@/lib/offlineMix';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) throw new Error('A CI-ben kötelező az ffmpeg (a hang-paritáshoz).');
const SR = 44100;

/** 20 s: 1 kHz-es szinusz, hangossága 5 s-onként lépcsőzve (−30 / −20 / −12 / −24 dBFS) — ismert LRA */
function stepped(): [Float32Array, Float32Array] {
  const levels = [-30, -20, -12, -24];
  const x = Float32Array.from({ length: 20 * SR }, (_, i) => Math.pow(10, levels[Math.floor(i / (5 * SR))] / 20) * Math.sin((2 * Math.PI * 1000 * i) / SR));
  return [x, Float32Array.from(x, (v) => v * 0.7)];
}

(hasFfmpeg ? describe : describe.skip)('📏 telefonos mérés = ffmpeg ebur128', () => {
  it('integrált LUFS ±0,3 LU, true-peak ±0,3 dB, LRA ±1 LU', () => {
    const [l, r] = stepped();
    const meter = new LiveLoudness(SR);
    const CH = Math.round(0.125 * SR);
    for (let a = 0; a < l.length; a += CH) meter.push(a, l.subarray(a, a + CH), r.subarray(a, a + CH));
    const phone = { ...meter.readAt(l.length), lra: meter.loudnessRange() };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lra-'));
    const file = path.join(dir, 'x.wav');
    fs.writeFileSync(file, encodeWav16([l, r], SR, () => 0.5));
    const err = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr as string;
    const summary = err.slice(err.lastIndexOf('Summary:'));
    const num = (re: RegExp) => Number(re.exec(summary)?.[1]);
    const ff = { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
    fs.rmSync(dir, { recursive: true, force: true });
    expect(Math.abs(phone.integrated - ff.lufs)).toBeLessThan(0.3);
    expect(Math.abs(phone.truePeakMax - ff.tp)).toBeLessThan(0.3);
    expect(Math.abs(phone.lra - ff.lra)).toBeLessThan(1);
    expect(ff.lra).toBeGreaterThan(5); // a jel valóban dinamikus
  });
  it('csendre 0 LRA, −∞ LUFS', () => {
    const meter = new LiveLoudness(SR);
    const z = new Float32Array(5 * SR);
    meter.push(0, z, z);
    expect(meter.loudnessRange()).toBe(0);
    expect(meter.readAt(z.length).integrated).toBe(-Infinity);
  });
});
