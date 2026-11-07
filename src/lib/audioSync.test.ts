import { gccPhatLag, syncedPlacement, syncTarget, SYNC_MIN_CONFIDENCE } from '@/lib/audioSync';

const SR = 8000;
/** determinisztikus zaj (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}
/** beszéd-szerű jel: szótagszerűen ki-be kapcsolt, színes zaj */
function speechLike(sec: number, seed: number): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(Math.round(sec * SR));
  let lp = 0;
  let env = 0;
  let target = 0;
  for (let i = 0; i < out.length; i++) {
    lp = 0.7 * lp + 0.3 * r();
    // véletlen „szótagok” és szünetek (felvételenként eltérő burkoló)
    if (i % Math.round(SR * 0.05) === 0) target = r() > 0.2 ? Math.abs(r()) : 0;
    env += 0.01 * (target - env);
    out[i] = lp * env;
  }
  return out;
}
/** tört-mintás eltolás lineáris interpolációval */
const shifted = (x: Float32Array, from: number, len: number) =>
  Float32Array.from({ length: Math.round(len * SR) }, (_, i) => {
    const p = from * SR + i;
    const k = Math.floor(p);
    const f = p - k;
    return (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f;
  });

describe('🔗 GCC-PHAT', () => {
  const ref = speechLike(30, 1);
  it('a külső mikrofon (más hangszín, halkabb, zajos) eltolása 0,1 ms-on belül', () => {
    const noise = rng(9);
    let lp = 0;
    const ext = shifted(ref, 7.34567, 8).map((v) => {
      lp = 0.5 * lp + 0.5 * v; // tompább mikrofon
      return 0.3 * lp + 0.02 * noise();
    });
    const r = gccPhatLag(ref, ext, SR);
    expect(Math.abs(r.lag - 7.34567)).toBeLessThan(1e-4);
    expect(r.confidence).toBeGreaterThan(3);
  });
  it('idegen felvételre nincs biztos egyezés (10 különböző felvétel)', () => {
    const all = [77, 78, 79, 80, 81, 82, 83, 84, 85, 86].map((seed) => gccPhatLag(ref, speechLike(8, seed), SR).confidence);
    const r = { confidence: Math.max(...all) };
    expect(r.confidence).toBeLessThan(SYNC_MIN_CONFIDENCE);
  });
  it('negatív eltolás: a külső felvétel korábban indult', () => {
    const ext = new Float32Array(Math.round(10 * SR));
    ext.set(ref.subarray(0, 8 * SR), 2 * SR); // 2 s mással kezdődik
    const r = gccPhatLag(ref, ext, SR, 5);
    expect(Math.abs(r.lag + 2)).toBeLessThan(1e-4);
  });
});

describe('🔗 elhelyezés', () => {
  it('a cél a két klip forrás-ablakából', () => {
    // ref a 10 s-on, a forrása 3 s-tól; a minta-sor a ref forrás 5 s-ától; ext forrás 1 s-tól, sor 1 s-tól
    expect(syncTarget({ start: 10, trimIn: 3 }, 5, { trimIn: 1 }, 1, 4.5)).toBeCloseTo(16.5, 9);
  });
  it('a kezdet a rácsra (felfelé), a maradékot a trimIn veszi át — a hang mintapontos marad', () => {
    const p = syncedPlacement({ start: 0, duration: 10, trimIn: 0.5 }, 16.51, 30)!;
    expect(p.start).toBeCloseTo(16.533333, 6);
    expect(p.trimIn - p.start).toBeCloseTo(0.5 - 16.51, 9); // forrás − idővonal állandó
    expect(p.start + p.duration).toBeCloseTo(16.51 + 10, 9); // a vége nem mozdul a hanghoz képest
  });
  it('0 elé nem kerül: az eleje levágódik', () => {
    const p = syncedPlacement({ start: 5, duration: 10, trimIn: 0 }, -2.25, 30)!;
    expect(p).toEqual({ start: 0, trimIn: 2.25, duration: 7.75 });
  });
});
