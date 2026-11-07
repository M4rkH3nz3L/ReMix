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

  it('🎛️ szűrők és EQ (közös DSP): telefon = szerver, szeletenként és ugrással is', async () => {
    const fx = { highpass: 200, lowpass: 6000, eq: { low: 4, mid: -3, high: 5 } };
    const fp: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'music' ? { ...t, clips: [clip({ id: 'f', uri: stereo, start: 0.25, trimIn: 0.2, duration: 3, sourceDuration: 4, volume: 0.8, fadeIn: 0.2, fadeOut: 0.3, pan: 0.3, audioFx: fx })] } : t
      ),
    };
    const { renderProject } = jest.requireActual('../../server/render');
    const work = fs.mkdtempSync(path.join(dir, 'wf-'));
    const server = decode(await renderProject(fp, work, () => {}, { audioFormat: 'wav', audioBitDepth: 24 }), 2);
    const plan = offlineMixPlan(fp);
    expect(plan.unsupported).toEqual([]);
    expect(plan.clips[0].fx).toEqual(fx);
    const n = server[0].length;
    const sources = new Map([[stereo, { channels: decode(stereo, 2), sampleRate: SR }]]);
    // darabosan, ahogy az export és az előnézet fut (folytonos szűrő-állapottal)
    const chunked: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    const state = new Map();
    for (let from = 0; from < n; from += 5512) {
      const to = Math.min(n, from + 5512);
      const part: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
      mixRange(plan, sources, part, from, to, 1, state);
      chunked[0].set(part[0], from);
      chunked[1].set(part[1], from);
    }
    for (const c of [0, 1]) {
      const diff = server[c].map((v, i) => v - chunked[c][i]);
      // eslint-disable-next-line no-console
      console.log(`FX csatorna ${c}: jel ${rmsDb(server[c]).toFixed(1)} dB, különbség ${rmsDb(diff).toFixed(1)} dB`);
      expect(rmsDb(server[c]) - rmsDb(diff)).toBeGreaterThan(80);
    }
    // egyben keverve ugyanaz (a szeletelés nem hagy nyomot)
    const whole: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    mixRange(plan, sources, whole, 0, n, 1, new Map());
    expect(rmsDb(whole[0].map((v, i) => v - chunked[0][i]))).toBeLessThan(-140);
    // ugrás a klip közepére: a bejáratott lánc a folytonossal egyezik
    const at = Math.round(1.7 * SR);
    const jumped: [Float32Array, Float32Array] = [new Float32Array(n - at), new Float32Array(n - at)];
    mixRange(plan, sources, jumped, at, n, 1, new Map());
    expect(rmsDb(jumped[0].map((v, i) => v - whole[0][at + i])) - rmsDb(whole[0].subarray(at))).toBeLessThan(-100);
  }, 60000);

  it('🦆 automatikus halkítás: a beszéd alatt a zene halkul, előtte/utána nem; mélysége a szerverével összevethető', async () => {
    const speech = path.join(dir, 'speech.wav');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100:duration=1.5', '-ac', '1', speech]);
    const dp: Project = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.type === 'music'
          ? { ...t, clips: [clip({ id: 'm', uri: stereo, start: 0, duration: 4, sourceDuration: 4, volume: 0.8, autoDuck: true })] }
          : t.type === 'voiceover'
            ? { ...t, clips: [clip({ id: 'v', uri: speech, start: 1.5, duration: 1.5, sourceDuration: 1.5, volume: 0.6, source: 'voiceover' })] }
            : t
      ),
    };
    const plan = offlineMixPlan(dp);
    expect(plan.ducking).toBe(true);
    expect(plan.unsupported).toEqual([]);
    const n = Math.round(4 * SR);
    const sources = new Map([[stereo, { channels: decode(stereo, 2), sampleRate: SR }], [speech, { channels: decode(speech, 1), sampleRate: SR }]]);
    // csak a zene szintje: a beszéd nélküli tervvel összevetve (a halkítás aránya)
    const render = (p: typeof plan, chunk: number) => {
      const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
      const st = new Map();
      for (let a = 0; a < n; a += chunk) {
        const b = Math.min(n, a + chunk);
        const part: [Float32Array, Float32Array] = [new Float32Array(b - a), new Float32Array(b - a)];
        mixRange(p, sources, part, a, b, 1, st);
        out[0].set(part[0], a);
        out[1].set(part[1], a);
      }
      return out;
    };
    const musicOnly = { ...plan, clips: plan.clips.map((c) => (c.role === 'key' ? { ...c, volume: 0 } : c)) };
    // a kulcs NÉMA lejátszás nélkül is kell: a beszéd hangját kivonva mérünk
    const full = render(plan, 5512);
    const keyOnly = render({ ...plan, ducking: false, clips: plan.clips.filter((c) => c.role === 'key') }, 5512);
    const music = full[0].map((v, i) => v - keyOnly[0][i]);
    const dry = render({ ...musicOnly, ducking: false }, 5512)[0];
    const seg = (x: Float32Array, a: number, b: number) => rmsDb(x.subarray(Math.round(a * SR), Math.round(b * SR)));
    const before = seg(music, 0.5, 1.4) - seg(dry, 0.5, 1.4);
    const during = seg(music, 2.0, 2.9) - seg(dry, 2.0, 2.9);
    const after = seg(music, 3.6, 3.95) - seg(dry, 3.6, 3.95);
    // eslint-disable-next-line no-console
    console.log(`halkítás: előtte ${before.toFixed(1)} dB, közben ${during.toFixed(1)} dB, utána ${after.toFixed(1)} dB`);
    expect(Math.abs(before)).toBeLessThan(0.1);
    expect(during).toBeLessThan(-6);
    expect(after).toBeGreaterThan(during + 3);
    // szeletelés-független
    const whole = render(plan, n);
    let maxDiff = 0;
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(full[0][i] - whole[0][i]));
    expect(maxDiff).toBeLessThan(1e-6);
    // a szerver halkításának mélysége (ugyanígy kivonva) — saját DSP, ezért csak összevethető
    const { renderProject } = jest.requireActual('../../server/render');
    const sFull = decode(await renderProject(dp, fs.mkdtempSync(path.join(dir, 'wd-')), () => {}, { audioFormat: 'wav', audioBitDepth: 24 }), 2)[0];
    const sKey = decode(await renderProject({ ...dp, tracks: dp.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [] } : t)) }, fs.mkdtempSync(path.join(dir, 'wk-')), () => {}, { audioFormat: 'wav', audioBitDepth: 24 }), 2)[0];
    const sMusic = sFull.map((v, i) => v - (sKey[i] ?? 0));
    const sDuring = seg(sMusic, 2.0, 2.9) - seg(dry, 2.0, 2.9);
    // eslint-disable-next-line no-console
    console.log(`szerver halkítás közben ${sDuring.toFixed(1)} dB`);
    expect(Math.abs(during - sDuring)).toBeLessThan(4);
  }, 120000);
});

