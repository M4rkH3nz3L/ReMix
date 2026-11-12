import { analyzeBeatsFromPcm, BEAT_SR } from '@/lib/beatDetect';

/** 🥁 AP3: a telefonos tempó-felismerés = a szerveré (szerződés), és ismert tempón pontos. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require('../../server/beats.js') as { analyzeBeatsFromPcm: (pcm: Float32Array, sr: number) => unknown; SR: number };

/** klikk-sáv: `bpm`-en rövid lecsengő ütések, minden 4. hangosabb (downbeat) */
function clickTrack(bpm: number, sec: number, seed = 1): Float32Array {
  const x = new Float32Array(Math.round(sec * BEAT_SR));
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const period = (60 / bpm) * BEAT_SR;
  for (let k = 0; k * period < x.length; k++) {
    const at = Math.round(k * period);
    const amp = k % 4 === 0 ? 0.9 : 0.5;
    for (let i = 0; i < 400 && at + i < x.length; i++) x[at + i] += amp * Math.exp(-i / 60) * rnd();
  }
  for (let i = 0; i < x.length; i++) x[i] += 0.01 * rnd(); // zajpadló
  return x;
}

describe('🥁 tempó-felismerés a telefonon', () => {
  it('a mintavétel és az algoritmus a szerverével azonos', () => {
    expect(BEAT_SR).toBe(server.SR);
    for (const [bpm, sec] of [[120, 20], [93, 25], [174, 15], [65, 30]] as const) {
      const pcm = clickTrack(bpm, sec, bpm);
      expect(analyzeBeatsFromPcm(pcm)).toEqual(server.analyzeBeatsFromPcm(pcm, BEAT_SR));
    }
  });
  it.each([120, 93, 128, 100, 140])('%d BPM klikk-sáv → ±1 BPM; a beatek a valódi ütésen (egy hop-on belül; átlag ±25 ms, eddig −45 ms)', (bpm) => {
    const g = analyzeBeatsFromPcm(clickTrack(bpm, 20, 7));
    expect(Math.abs(g.bpm - bpm)).toBeLessThanOrEqual(1);
    const period = 60 / bpm;
    const offs = g.beats.slice(1, -1).map((b) => {
      const o = ((b % period) + period) % period;
      return o > period / 2 ? o - period : o;
    });
    for (const o of offs) expect(Math.abs(o)).toBeLessThanOrEqual(0.052);
    expect(Math.abs(offs.reduce((a, o) => a + o, 0) / offs.length)).toBeLessThanOrEqual(0.025);
    expect(g.downbeats.length).toBeGreaterThan(0);
  });
  it('a 120 felé súlyozás miatt a gyors tempó a felét adhatja (oktáv), de sosem mást', () => {
    const g = analyzeBeatsFromPcm(clickTrack(174, 20, 3));
    expect([87, 174].some((b) => Math.abs(g.bpm - b) <= 1)).toBe(true);
  });
  it('csendre és túl rövid hangra nincs tempó', () => {
    expect(analyzeBeatsFromPcm(new Float32Array(BEAT_SR * 3)).bpm).toBe(0);
    expect(analyzeBeatsFromPcm(new Float32Array(100)).bpm).toBe(0);
  });
});
