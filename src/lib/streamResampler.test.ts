import { StreamResampler } from '@/lib/streamResampler';

/** 🎚️ a folyamatos átmintavételező: pontos hossz, darabolás-független, tiszta szinusz 44,1 → 48 kHz-en. */
function run(input: Float32Array, inRate: number, outRate: number, chunk: number): Float32Array {
  const r = new StreamResampler(inRate, outRate, 1);
  const parts: Float32Array[] = [];
  for (let a = 0; a < input.length; a += chunk) parts.push(r.process([input.subarray(a, Math.min(input.length, a + chunk))])[0]);
  parts.push(r.flush()[0]);
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('🎚️ StreamResampler', () => {
  const inRate = 44100;
  const n = inRate; // 1 s
  const sine = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / inRate));

  it('44,1 → 48 kHz: a hossz pontos, a darabolástól független (bitre)', () => {
    const a = run(sine, 44100, 48000, 4096);
    const b = run(sine, 44100, 48000, 1000);
    const c = run(sine, 44100, 48000, 44100);
    expect(a.length).toBe(48000);
    expect(StreamResampler.outFrames(n, 44100, 48000)).toBe(48000);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(Array.from(c)).toEqual(Array.from(a));
  });

  it('a kimenet a 48 kHz-es ideális szinusz: a hiba −70 dB alatt (a szélektől távol)', () => {
    const out = run(sine, 44100, 48000, 4096);
    let err = 0;
    let sig = 0;
    for (let i = 2000; i < 46000; i++) {
      const ideal = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
      err += (out[i] - ideal) ** 2;
      sig += ideal ** 2;
    }
    expect(10 * Math.log10(err / sig)).toBeLessThan(-70);
  });

  it('lefelé (48 → 44,1) is pontos hossz, és a 22 kHz fölötti hang elnyomva (nincs átlapolódás)', () => {
    const hi = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 23000 * i) / 48000));
    const out = run(hi, 48000, 44100, 4096);
    expect(out.length).toBe(44100);
    let peak = 0;
    for (let i = 2000; i < 42000; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(20 * Math.log10(peak / 0.5)).toBeLessThan(-40);
  });
});
