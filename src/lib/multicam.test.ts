import {
  multicamSegments,
  normalizeCuts,
  syncByWaveform,
  type AnglePeaks,
  type MulticamCut,
} from '@/lib/multicam';

// 🎬 Multicam (hullámforma-sync + vágás→szegmens) pure regressziós pajzsa.

describe('syncByWaveform — keresztkorrelációs eltolás a referenciához', () => {
  const peaks = (p: number[]): AnglePeaks => ({ peaks: p, peaksPerSecond: 1 });

  it('üres → []; egy szög → [0]', () => {
    expect(syncByWaveform([])).toEqual([]);
    expect(syncByWaveform([peaks([0, 1, 0])])).toEqual([0]);
  });

  it('azonos hullámforma → ~0 eltolás', () => {
    const a = peaks([0, 0, 1, 0, 0, 0, 0, 0]);
    const out = syncByWaveform([a, peaks([0, 0, 1, 0, 0, 0, 0, 0])]);
    expect(out[0]).toBe(0);
    expect(Math.abs(out[1])).toBeLessThan(1);
  });

  it('2 csúccsal később kezdődő szög → ~+2 eltolás', () => {
    const ref = peaks([0, 0, 1, 0, 0, 0, 0, 0]);
    const later = peaks([0, 0, 0, 0, 1, 0, 0, 0]); // a csúcs 2-vel későbbre
    const out = syncByWaveform([ref, later]);
    expect(out[1]).toBeCloseTo(2, 0);
  });
});

describe('normalizeCuts — rendezés + dedup + t=0 biztosítása', () => {
  it('üres → egy t=0 vágás a firstAngle-lel', () => {
    expect(normalizeCuts([], 3)).toEqual([{ t: 0, angle: 3 }]);
  });

  it('a szomszédos azonos szögű vágás kiesik', () => {
    const cuts: MulticamCut[] = [{ t: 0, angle: 0 }, { t: 1, angle: 0 }, { t: 2, angle: 1 }];
    expect(normalizeCuts(cuts)).toEqual([{ t: 0, angle: 0 }, { t: 2, angle: 1 }]);
  });

  it('azonos időpontnál az utóbbi szög nyer', () => {
    const cuts: MulticamCut[] = [{ t: 0, angle: 0 }, { t: 1, angle: 1 }, { t: 1.00005, angle: 2 }];
    // az azonos-időpontú utóbbi vágás TELJESEN felülírja az előzőt (a t-je is)
    expect(normalizeCuts(cuts)).toEqual([{ t: 0, angle: 0 }, { t: 1.00005, angle: 2 }]);
  });

  it('ha nincs t=0, beszúrja az első vágás szögével (a t=2 ezzel azonos szögű → kiesik)', () => {
    // unshift {t:0,angle:1}; a t=2 angle=1 a prev-vel azonos → dedup; marad [0,1] és [4,0]
    expect(normalizeCuts([{ t: 2, angle: 1 }, { t: 4, angle: 0 }])).toEqual([
      { t: 0, angle: 1 },
      { t: 4, angle: 0 },
    ]);
  });
});

describe('multicamSegments — vágás-lista → idővonal-szegmensek', () => {
  it('a szegmensek a vágások közti hézagokat töltik ki, srcIn = start + offset', () => {
    const cuts: MulticamCut[] = [{ t: 0, angle: 0 }, { t: 2, angle: 1 }];
    const segs = multicamSegments(cuts, [0, 0.5], 5, [10, 10]);
    expect(segs).toEqual([
      { angle: 0, start: 0, duration: 2, srcIn: 0 },
      { angle: 1, start: 2, duration: 3, srcIn: 2.5 },
    ]);
  });

  it('a srcIn a szög forráshosszához záródik (nem lóghat túl)', () => {
    const cuts: MulticamCut[] = [{ t: 0, angle: 0 }, { t: 2, angle: 1 }];
    const segs = multicamSegments(cuts, [0, 5], 5, [10, 3]); // 1. szög csak 3 mp
    const seg1 = segs.find((s) => s.angle === 1)!;
    expect(seg1.srcIn).toBeCloseTo(0, 3); // 2+5=7, de dur-duration=3-3=0 → clamp 0
  });
});
