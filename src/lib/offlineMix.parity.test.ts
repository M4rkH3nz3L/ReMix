/**
 * 🎧📱 A26 paritás: a telefonos keverő UGYANAZT adja, mint a szerveres render. A szerver a
 * valódi `renderProject`-tel (ffmpeg) renderel 24 bites WAV-ba; a telefonos keverő a
 * forrásokat ugyanúgy, 44,1 kHz-en dekódolva keveri. A kettő különbsége a mérés.
 */
// a Node-modulok a jest futtatókörnyezetéből (a kliens tsconfig nem ismeri a Node-típusokat)
type Bytes = { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
const { execFileSync, spawnSync } = jest.requireActual('child_process') as {
  execFileSync: (cmd: string, args: string[], opts?: object) => Bytes;
  spawnSync: (cmd: string, args: string[]) => { status: number | null };
};
const fs = jest.requireActual('fs') as { mkdtempSync: (p: string) => string; rmSync: (p: string, o: object) => void };
const os = jest.requireActual('os') as { tmpdir: () => string };
const path = jest.requireActual('path') as { join: (...p: string[]) => string };

import { mixRange, OFFLINE_SAMPLE_RATE, offlineMixPlan } from '@/lib/offlineMix';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip, Project } from '@/types/project';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// CI-ben kötelező: egy csendben átugrott minőségkapu nem kapu
if (process.env.CI && !hasFfmpeg) {
  throw new Error('A CI-ben kötelező az ffmpeg (a hang-minőségkapukhoz).');
}
const SR = OFFLINE_SAMPLE_RATE;

function decode(file: string, channels: number): Float32Array[] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: all.length / channels }, (_, i) => all[i * channels + c]));
}
const rmsDb = (xs: Float32Array) => 10 * Math.log10(xs.reduce((s, v) => s + v * v, 0) / Math.max(1, xs.length) + 1e-30);

(hasFfmpeg ? describe : describe.skip)('offlineMix ↔ szerveres render (A26)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offmix-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stereo = path.join(dir, 'noise.flac');
  const mono = path.join(dir, 'tone.wav');
  beforeAll(() => {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:duration=4:seed=5', '-ar', '44100', '-ac', '2', stereo]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=3', '-ac', '1', mono]);
  });

  const clip = (over: Partial<AudioClip>): AudioClip =>
    ({ kind: 'audio', label: 'c', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
  const base = createEmptyProject('parity', '1:1', undefined, 'audio');
  const lin = (pts: [number, number][]) => pts.map(([time, value]) => ({ time, value, easing: 'linear' as const }));
  const project: Project = {
    ...base,
    trackMix: { music: { gain: 0.9 }, sfx: { gain: 0.6 } },
    tracks: base.tracks.map((t) =>
      t.type === 'music'
        ? { ...t, clips: [clip({ id: 'n', uri: stereo, start: 0.5, trimIn: 0.7, duration: 2.5, sourceDuration: 4, volume: 0.7, fadeIn: 0.4, fadeOut: 0.6, pan: -0.4, keyframes: { volume: lin([[0, 0.3], [1.5, 0.9], [2.5, 0.5]]) } as AudioClip['keyframes'] })] }
        : t.type === 'sfx'
          ? { ...t, clips: [clip({ id: 't', uri: mono, start: 1, duration: 2, sourceDuration: 3, volume: 0.8, keyframes: { pan: lin([[0, -1], [2, 1]]) } as AudioClip['keyframes'] })] }
          : t
    ),
  };

  it('videóklipek hangja (átfedéssel, automációval, monó videóval): telefon = szerver', async () => {
    const vid = path.join(dir, 'v.mp4');
    const vidMono = path.join(dir, 'vm.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30:duration=4', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:duration=4:seed=9', '-ac', '2', '-ar', '44100', '-c:v', 'libx264', '-c:a', 'flac', '-shortest', vid]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=44100:duration=4', '-ac', '1', '-c:v', 'libx264', '-c:a', 'flac', '-shortest', vidMono]);
    const v = (over: Record<string, unknown>) => ({ kind: 'video', speed: 1, volume: 1, filterId: 'none', trimIn: 0, sourceDuration: 4, ...over });
    const lin2 = (pts: [number, number][]) => pts.map(([time, value]) => ({ time, value, easing: 'linear' as const }));
    const vp: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'video'
          ? {
              ...t,
              clips: [
                // az első klip végét a második (később kezdődő) takarja
                v({ id: 'v1', uri: vid, start: 0, duration: 3, trimIn: 0.5, volume: 0.7, keyframes: { volume: lin2([[0, 0.2], [3, 1]]) } }),
                v({ id: 'v2', uri: vidMono, start: 2, duration: 2, trimIn: 1, volume: 0.6 }),
              ],
            }
          : t
      ),
    } as unknown as Project;
    const { renderProject } = jest.requireActual('../../server/render');
    const work = fs.mkdtempSync(path.join(dir, 'wv-'));
    const out: string = await renderProject(vp, work, () => {}, { audioFormat: 'wav', audioBitDepth: 24 });
    const server = decode(out, 2);
    const plan = offlineMixPlan(vp);
    expect(plan.unsupported).toEqual([]);
    const n = server[0].length;
    const mine: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    mixRange(plan, new Map([[vid, { channels: decode(vid, 2), sampleRate: SR }], [vidMono, { channels: decode(vidMono, 1), sampleRate: SR }]]), mine, 0, n);
    for (const c of [0, 1]) {
      const diff = server[c].map((x, i) => x - mine[c][i]);
      // eslint-disable-next-line no-console
      console.log(`videó csatorna ${c}: jel ${rmsDb(server[c]).toFixed(1)} dB, különbség ${rmsDb(diff).toFixed(1)} dB`);
      expect(rmsDb(server[c]) - rmsDb(diff)).toBeGreaterThan(90);
    }
  }, 120000);

  it('a különbség a jel alatt legalább 90 dB-lel', async () => {
    const { renderProject } = jest.requireActual('../../server/render');
    const work = fs.mkdtempSync(path.join(dir, 'w-'));
    const out: string = await renderProject(project, work, () => {}, { audioFormat: 'wav', audioBitDepth: 24 });
    const server = decode(out, 2);

    const plan = offlineMixPlan(project);
    const n = server[0].length;
    const mine: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    const sources = new Map([
      [stereo, { channels: decode(stereo, 2), sampleRate: SR }],
      [mono, { channels: decode(mono, 1), sampleRate: SR }],
    ]);
    mixRange(plan, sources, mine, 0, n);

    for (const c of [0, 1]) {
      const diff = server[c].map((v, i) => v - mine[c][i]);
      const signal = rmsDb(server[c]);
      const residual = rmsDb(diff);
      // eslint-disable-next-line no-console
      console.log(`csatorna ${c}: jel ${signal.toFixed(1)} dB, különbség ${residual.toFixed(1)} dB`);
      expect(signal - residual).toBeGreaterThan(90);
    }
  }, 60000);
});
