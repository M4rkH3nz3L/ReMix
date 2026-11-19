import { denoiseStereo, fft } from './denoise';

const mulberry = (a: number) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
};
const SR = 44100;
const rmsDb = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return 10 * Math.log10(s / x.length + 1e-30);
};

describe('fft', () => {
  it('oda-vissza transzformálva az eredetit adja', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.3) + 0.2 * Math.cos(i * 1.7));
    const orig = Float64Array.from(re);
    const im = new Float64Array(64);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i] / 64).toBeCloseTo(orig[i], 9);
  });
});

describe('denoiseStereo', () => {
  // valódi fehér zaj (mulberry32) — a túlcsorduló LCG bizonyos magoknál rövid ciklusba ragad,
  // és hangszerű „zajt” ad (azt egy zajszűrő joggal nem tekinti zajnak)
  const rnd = mulberry(9);
  const n = 6 * SR;
  // beszédszerű: 0,5 s hang / 0,5 s szünet; a zaj végig — a telefonos mérés aránya (1 : 10)
  const clean = Float32Array.from({ length: n }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0));
  const noisyL = Float32Array.from(clean, (v) => v + 0.005 * rnd());
  const noisyR = Float32Array.from(clean, (v) => v + 0.005 * rnd());
  const seg = (x: Float32Array, a: number, b: number) => x.subarray(Math.round(a * SR), Math.round(b * SR));

  it('a szünetekben a zajt legalább 9 dB-lel csökkenti, a hangot alig érinti, gyorsan', async () => {
    const t0 = Date.now();
    const [yl, yr] = await denoiseStereo(noisyL, noisyR);
    console.log(`zajszűrés: ${((Date.now() - t0) / 6).toFixed(0)} ms / sztereó hang-mp (Node)`);
    expect(yl.length).toBe(n);
    expect(rmsDb(seg(yl, 3.6, 3.9)) - rmsDb(seg(noisyL, 3.6, 3.9))).toBeLessThan(-9);
    expect(rmsDb(seg(yr, 3.6, 3.9)) - rmsDb(seg(noisyR, 3.6, 3.9))).toBeLessThan(-9);
    expect(Math.abs(rmsDb(seg(yl, 3.1, 3.4)) - rmsDb(seg(clean, 3.1, 3.4)))).toBeLessThan(1);
  });
  it('zaj nélküli jel: gyakorlatilag változatlan (tökéletes visszaállítás)', async () => {
    const [yl] = await denoiseStereo(clean, clean);
    const diff = Float32Array.from(yl, (v, i) => v - clean[i]);
    expect(rmsDb(diff) - rmsDb(clean)).toBeLessThan(-20);
  });
});

describe('⚡ S20: a keretenkénti mag átszervezése bitre a régi kimenet', () => {
  it('arany ujjlenyomat (FNV-1a a kimeneti mintákon) — a natív mag ugyanezt kell adja (eszközön: denoisenative)', async () => {
    const run = denoiseStereo;
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const n = 44100 * 3;
    const l = Float32Array.from({ length: n }, (_, i) => 0.05 * rnd() + (i > 44100 && i < 88200 ? 0.4 * Math.sin(i / 7) : 0));
    const r = Float32Array.from({ length: n }, (_, i) => 0.05 * rnd() + (i > 44100 && i < 88200 ? 0.3 * Math.sin(i / 9) : 0));
    const [a, b] = await run(l, r);
    let h = 2166136261;
    for (const x of [a, b]) {
      const u = new Uint32Array(x.buffer);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
    }
    expect(h.toString(16)).toBe('80181d20');
  });
});
