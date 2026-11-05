/**
 * ⏩ A gyorsított hangklip (a gyorsított videóklip leválasztott hangja) a valódi szerveres
 * renderben: a forrás `duration·speed` szakasza szól `duration` alatt, a hangmagasság MARAD.
 * Forrás: 2 s 440 Hz, majd 2 s 880 Hz. 2×-es klipnél az idővonalon 1 s 440 Hz + 1 s 880 Hz
 * (hangmagasság-tartás nélkül 880 + 1760 Hz lenne).
 */
type Bytes = { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
const { execFileSync, spawnSync } = jest.requireActual('child_process') as {
  execFileSync: (cmd: string, args: string[], opts?: object) => Bytes;
  spawnSync: (cmd: string, args: string[]) => { status: number | null };
};
const fs = jest.requireActual('fs') as { mkdtempSync: (p: string) => string; rmSync: (p: string, o: object) => void };
const os = jest.requireActual('os') as { tmpdir: () => string };
const path = jest.requireActual('path') as { join: (...p: string[]) => string };

import { edgeFades, offlineMixPlan } from '@/lib/offlineMix';
import { createEmptyProject, cropClip } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
if (process.env.CI && !hasFfmpeg) {
  throw new Error('A CI-ben kötelező az ffmpeg (a hang-minőségkapukhoz).');
}
const SR = 44100;

function decodeMono(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

/** domináns frekvencia nullátmenetekből egy [from, to) mp-es ablakban */
function freqAt(x: Float32Array, from: number, to: number): number {
  const a = Math.round(from * SR);
  const b = Math.round(to * SR);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) {
    if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) crossings++;
  }
  return crossings / 2 / (to - from);
}

const clip = (over: Partial<AudioClip>): AudioClip =>
  ({ kind: 'audio', id: 's', label: 's', uri: 'x', start: 0, duration: 2, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'voiceover', ...over }) as AudioClip;

describe('⏩ gyorsított hangklip — pure részek', () => {
  it('a kettévágott gyorsított klip illesztésén nincs mikro-fade (folytonos forrás)', () => {
    const whole = clip({ id: 'w', start: 1, duration: 4, trimIn: 0.5, sourceDuration: 10, speed: 2 });
    const left = { ...(cropClip(whole, 1, 3) as AudioClip), id: 'l' };
    const right = { ...(cropClip(whole, 3, 5) as AudioClip), id: 'r' };
    const f = edgeFades([left, right]);
    expect(f.get('l')?.out).toBe(0);
    expect(f.get('r')?.in).toBe(0);
  });
  it('a telefonos export a gyorsított hangot kihagyottként jelzi (a Pro szerver szólaltatja meg)', () => {
    const base = createEmptyProject('speed', '1:1', undefined, 'audio');
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip({ speed: 2 })] } : t)) };
    const plan = offlineMixPlan(p);
    expect(plan.unsupported).toContain('videoSpeed');
    expect(plan.clips).toHaveLength(0);
  });
});

(hasFfmpeg ? describe : describe.skip)('⏩ gyorsított hangklip a szerveres renderben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aspeed-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'two-tones.wav');
  beforeAll(() => {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:duration=2', '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-ac', '1', src]);
  });

  const render = async (over: Partial<AudioClip>) => {
    const base = createEmptyProject('speed', '1:1', undefined, 'audio');
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [clip({ uri: src, ...over })] } : t)) };
    const { renderProject } = jest.requireActual('../../server/render');
    const work = fs.mkdtempSync(path.join(dir, 'w-'));
    return decodeMono(await renderProject(p, work, () => {}, { audioFormat: 'wav', audioBitDepth: 24 }));
  };

  it('2×: 4 s forrás 2 s alatt, a hangmagasság marad (440 → 880 Hz)', async () => {
    const out = await render({ start: 0.5, duration: 2, speed: 2 });
    expect(Math.abs(out.length / SR - 2.5)).toBeLessThan(0.01);
    expect(freqAt(out, 0.6, 1.4)).toBeCloseTo(440, -1);
    expect(freqAt(out, 1.6, 2.4)).toBeCloseTo(880, -1);
    // a klip előtt csend (a késleltetés helyes)
    expect(Math.max(...Array.from(out.subarray(0, Math.round(0.45 * SR)), Math.abs))).toBeLessThan(1e-4);
  });

  it('0,5×: a forrás első 1 s-a 2 s alatt, hangmagasság marad (440 Hz végig)', async () => {
    const out = await render({ start: 0, duration: 2, speed: 0.5, trimIn: 0.5 });
    expect(Math.abs(out.length / SR - 2)).toBeLessThan(0.01);
    expect(freqAt(out, 0.1, 1.9)).toBeCloseTo(440, -1);
  });

  it('1,5× trimIn-nel: a forrás 1,25–4 s szakasza (440 Hz → váltás 0,5 s-nál → 880 Hz)', async () => {
    const out = await render({ start: 0, duration: 1.8, speed: 1.5, trimIn: 1.25 });
    // a váltás a forrás 2,0 s-ánál = idővonal (2,0 − 1,25) / 1,5 = 0,5 s
    expect(freqAt(out, 0.05, 0.45)).toBeCloseTo(440, -1);
    expect(freqAt(out, 0.6, 1.7)).toBeCloseTo(880, -1);
  });
});
