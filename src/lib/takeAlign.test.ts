import { alignTake, ALIGN_MIN_RHO } from './takeAlign';

const SR = 8000;
// referencia: 0,1 s-onként ugró frekvencia (egyértelmű eltolás)
const ref = (t: number) => (t < 0 ? 0 : 0.5 * Math.sin(2 * Math.PI * (200 + 37 * (Math.floor(t * 10) % 17)) * t));

describe('alignTake', () => {
  it('megtalálja a valódi eltolást (késés + zaj mellett), mintapontosan', () => {
    const trueStart = 3.0;
    const latency = 0.0625; // 500 minta
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1;
    // a take j. mintája a referencia (trueStart − latency + j/sr) idejét hallja
    const take = Float32Array.from({ length: SR * 2 }, (_, j) => 0.3 * ref(trueStart - latency + j / SR) + noise());
    const r = alignTake(take, SR, ref, trueStart, [0.3, 1.3], 0.3)!;
    expect(r.shift).toBeCloseTo(-latency, 4);
    expect(r.rho).toBeGreaterThan(0.8);
  });
  it('áthallás nélkül (csak zaj) a korreláció gyenge → a hívó nem fogadja el', () => {
    let seed = 3;
    const take = Float32Array.from({ length: SR * 2 }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2);
    expect(alignTake(take, SR, ref, 3, [0.3, 1.3], 0.3)!.rho).toBeLessThan(ALIGN_MIN_RHO);
  });
  it('túl rövid ablak → null', () => {
    expect(alignTake(new Float32Array(100), SR, ref, 0, [0, 0.005], 0.1)).toBeNull();
  });
});
