/**
 * 📏 A saját BS.1770 mérő az ffmpeg `ebur128`-ával szemben (valódi ffmpeg, rózsaszín zaj és
 * szinusz, különböző szinteken). CI-ben az ffmpeg kötelező.
 */
type Bytes = { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
const { execFileSync, spawnSync } = jest.requireActual('child_process') as {
  execFileSync: (cmd: string, args: string[], opts?: object) => Bytes;
  spawnSync: (cmd: string, args: string[], opts?: object) => { status: number | null; stderr: { toString: () => string } };
};
const fs = jest.requireActual('fs') as { mkdtempSync: (p: string) => string; rmSync: (p: string, o: object) => void };
const os = jest.requireActual('os') as { tmpdir: () => string };
const path = jest.requireActual('path') as { join: (...p: string[]) => string };

import { integratedLoudness } from '@/lib/loudness';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) {
  throw new Error('A CI-ben kötelező az ffmpeg (a hang-minőségkapukhoz).');
}
const SR = 44100;

describe('integratedLoudness — tiszta esetek', () => {
  it('csend: −Infinity', () => {
    expect(integratedLoudness(new Float32Array(SR), new Float32Array(SR), SR)).toBe(-Infinity);
  });
  it('a 0 dBFS-es 1 kHz-es szinusz mindkét csatornán ≈ 0 LUFS (a szabvány kalibrációja: egy csatornán −3,01)', () => {
    const s = Float32Array.from({ length: 3 * SR }, (_, i) => Math.sin((2 * Math.PI * 997 * i) / SR));
    expect(integratedLoudness(s, s, SR)).toBeCloseTo(0, 0);
    expect(integratedLoudness(s, new Float32Array(s.length), SR)).toBeCloseTo(-3.01, 0);
  });
});

(hasFfmpeg ? describe : describe.skip)('integratedLoudness = ffmpeg ebur128', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lufs-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases: [string, string][] = [
    ['rózsaszín zaj −20 dB', 'anoisesrc=color=pink:amplitude=0.1:duration=6:seed=3'],
    ['fehér zaj halk', 'anoisesrc=color=white:amplitude=0.02:duration=6:seed=4'],
    ['100 Hz-es szinusz', 'sine=frequency=100:sample_rate=44100:duration=6'],
  ];
  for (const [name, src] of cases) {
    it(name, () => {
      const file = path.join(dir, `${name.replace(/\W+/g, '_')}.wav`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', src, '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_f32le', file]);
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
      const l = Float32Array.from({ length: all.length / 2 }, (_, i) => all[2 * i]);
      const r = Float32Array.from({ length: all.length / 2 }, (_, i) => all[2 * i + 1]);
      const res = spawnSync('ffmpeg', ['-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
      const m = /I:\s+(-?[\d.]+) LUFS/g;
      let ref = Number.NaN;
      for (let hit = m.exec(String(res.stderr)); hit; hit = m.exec(String(res.stderr))) ref = Number(hit[1]);
      const mine = integratedLoudness(l, r, SR);
      // eslint-disable-next-line no-console
      console.log(`${name}: ffmpeg ${ref} LUFS, saját ${mine.toFixed(2)} LUFS`);
      expect(Math.abs(mine - ref)).toBeLessThan(0.15);
    });
  }
});
