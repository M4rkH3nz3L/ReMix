/**
 * 🎧 Kattogásmentes vágás (PRO-AUDIO 17/12): a klip széle a hullámforma közepén nem ugrik
 * hirtelen (mikro-fade), a kettévágott klip illesztése viszont folytonos marad. A szerveres
 * renderen (ffmpeg) mérve; a telefonos keverő ugyanezt a szabályt követi (paritás-teszt).
 */
type Bytes = { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
const { execFileSync, spawnSync } = jest.requireActual('child_process') as {
  execFileSync: (cmd: string, args: string[], opts?: object) => Bytes;
  spawnSync: (cmd: string, args: string[]) => { status: number | null };
};
const fs = jest.requireActual('fs') as { mkdtempSync: (p: string) => string; rmSync: (p: string, o: object) => void };
const os = jest.requireActual('os') as { tmpdir: () => string };
const path = jest.requireActual('path') as { join: (...p: string[]) => string };

import { createEmptyProject } from '@/lib/projectUtils';
import { EDGE_FADE_SEC, offlineMixPlan } from '@/lib/offlineMix';
import type { AudioClip, Project } from '@/types/project';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const SR = 44100;
const decode = (file: string): Float32Array => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 26 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
};
const clip = (over: Partial<AudioClip>): AudioClip =>
  ({ kind: 'audio', label: 'c', uri: 'u', start: 0, duration: 1, trimIn: 0, sourceDuration: 3, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
const project = (clips: AudioClip[]): Project => {
  const p = createEmptyProject('k', '1:1', undefined, 'audio');
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips } : t)) };
};

describe('mikro-fade terv (telefonos keverő)', () => {
  it('a magányos klip két széle mikro-fade-et kap, ha nincs felhasználói fade', () => {
    const [c] = offlineMixPlan(project([clip({ id: 'a' })])).clips;
    expect(c.fadeIn).toBe(EDGE_FADE_SEC);
    expect(c.fadeOut).toBe(EDGE_FADE_SEC);
  });

  it('a felhasználói fade marad, ha hosszabb', () => {
    const [c] = offlineMixPlan(project([clip({ id: 'a', fadeIn: 0.5 })])).clips;
    expect(c.fadeIn).toBe(0.5);
  });

  it('a kettévágott klip illesztésénél nincs fade (folytonos), a külső széleken van', () => {
    const plan = offlineMixPlan(project([clip({ id: 'l', start: 1, duration: 1, trimIn: 0.3 }), clip({ id: 'r', start: 2, duration: 1, trimIn: 1.3 })]));
    const [l, r] = plan.clips;
    expect([l.fadeIn, l.fadeOut, r.fadeIn, r.fadeOut]).toEqual([EDGE_FADE_SEC, 0, 0, EDGE_FADE_SEC]);
  });
});

(hasFfmpeg ? describe : describe.skip)('kattogásmentes vágás a szerveres renderben', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'click-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'sine.wav');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=3', '-ac', '2', src]);
  const render = async (p: Project) => {
    const { renderProject } = jest.requireActual('../../server/render');
    const work = fs.mkdtempSync(path.join(dir, 'w-'));
    return decode(await renderProject(p, work, () => {}, { audioFormat: 'wav', audioBitDepth: 24 }));
  };
  const jumpAt = (x: Float32Array, i: number) => Math.max(...[-2, -1, 0, 1].map((d) => Math.abs((x[i + d + 1] ?? 0) - (x[i + d] ?? 0))));

  it('a hullámforma közepén vágott klip széle nem ugrik (csúcs-ugrás < 0,02)', async () => {
    // a 440 Hz-es szinusz 0,0123 s-nál nem nulla-átmenet: vágás nélkül ~0,6-os ugrás lenne
    const x = await render(project([clip({ id: 'a', uri: src, start: 0.5, duration: 1, trimIn: 0.0123 })]));
    expect(jumpAt(x, Math.round(0.5 * SR))).toBeLessThan(0.02);
    expect(jumpAt(x, Math.round(1.5 * SR))).toBeLessThan(0.02);
  }, 60000);

  it('a kettévágott klip ugyanazt adja, mint a vágatlan (nincs beesés az illesztésnél)', async () => {
    const whole = await render(project([clip({ id: 'w', uri: src, start: 0.5, duration: 2, trimIn: 0.0123 })]));
    const split = await render(
      project([clip({ id: 'l', uri: src, start: 0.5, duration: 1, trimIn: 0.0123 }), clip({ id: 'r', uri: src, start: 1.5, duration: 1, trimIn: 1.0123 })])
    );
    const mid = Math.round(1.5 * SR);
    let maxDiff = 0;
    for (let i = mid - 2000; i < mid + 2000; i++) maxDiff = Math.max(maxDiff, Math.abs(whole[i] - split[i]));
    expect(maxDiff).toBeLessThan(1e-3);
  }, 60000);
});
