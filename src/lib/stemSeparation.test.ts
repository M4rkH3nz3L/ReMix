import { separateTwoStems, STEM_F, STEM_T } from '@/lib/stemSeparation';

const SR = 44100;
const sig = (n: number, f: number, ph = 0) => Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * f * i) / SR + ph));
// a széleken (a hirtelen indulás szélessávú, a 11 kHz feletti része levágódik) kis eltérés természetes
const maxErr = (a: Float32Array, b: Float32Array, from = 4096, to = a.length - 4096) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

describe('stemSeparation — V5 a telefonon (a jelút a modell nélkül)', () => {
  test('„minden ének” modell: az ének = a bemenet (11 kHz alatt), a kíséret ≈ 0; sztereó csatornák külön', async () => {
    const n = SR * 2;
    const l = sig(n, 440);
    const r = sig(n, 1000, 1);
    let calls = 0;
    const res = await separateTwoStems(l, r, async (mag) => {
      calls++;
      expect(mag.length).toBe(2 * STEM_T * STEM_F);
      return [mag, new Float32Array(mag.length)];
    });
    expect(calls).toBe(1);
    expect(maxErr(res.vocals[0], l)).toBeLessThan(1e-4);
    expect(maxErr(res.vocals[1], r)).toBeLessThan(1e-4);
    expect(Math.max(maxErr(res.accompaniment[0], new Float32Array(n)), maxErr(res.accompaniment[1], new Float32Array(n)))).toBeLessThan(1e-4);
  });

  test('fele-fele modell: mindkét stem a bemenet fele; több blokk (> 512 keret) is folytonos', async () => {
    const n = SR * 14; // ~603 keret → 2 blokk
    const l = sig(n, 220);
    const r = sig(n, 330);
    let calls = 0;
    const res = await separateTwoStems(l, r, async (mag) => {
      calls++;
      return [mag, mag];
    });
    expect(calls).toBe(2);
    const halfL = l.map((v) => v / 2);
    expect(maxErr(res.vocals[0], halfL)).toBeLessThan(1e-4);
    expect(maxErr(res.accompaniment[0], halfL)).toBeLessThan(1e-4);
  });

  test('a 11 kHz feletti tartalom kimarad (mask_extension: zeros)', async () => {
    const n = SR;
    const hi = sig(n, 15000);
    const res = await separateTwoStems(hi, hi, async (mag) => [mag, new Float32Array(mag.length)]);
    expect(maxErr(res.vocals[0], new Float32Array(n), 4096, n - 4096)).toBeLessThan(1e-3);
  });
});
