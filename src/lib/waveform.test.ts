import { barHeights, clipWindowPeaks, peaksFromChannels, resamplePeaks, waveformCacheKey } from '@/lib/waveform';

// 〰️ A hullámforma újramintázás (a klip-waveform kirajzolás magja) pure
// regressziós pajzsa: oszloponkénti MAXIMUM (a csúcsok ne tűnjenek el ritkításkor).

describe('resamplePeaks', () => {
  it('ritkítás: oszloponként a maximumot tartja', () => {
    expect(resamplePeaks([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([2, 4, 6, 8]);
    expect(resamplePeaks([0, 9, 0, 0], 2)).toEqual([9, 0]); // a csúcs nem vész el
  });

  it('sűrítés (upsample): minden oszlop a lefedő forrás-mintát kapja', () => {
    expect(resamplePeaks([1, 5], 4)).toEqual([1, 1, 5, 5]);
  });

  it('üres bemenet / nem-pozitív oszlop → []', () => {
    expect(resamplePeaks([], 4)).toEqual([]);
    expect(resamplePeaks([1, 2, 3], 0)).toEqual([]);
    expect(resamplePeaks([1, 2, 3], -2)).toEqual([]);
  });
});

describe('clipWindowPeaks (A22)', () => {
  const wave = { duration: 10, peaksPerSecond: 2, peaks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] };

  it('a bal-vágott klip a forrás vágott szakaszát mutatja, nem az elejét', () => {
    expect(clipWindowPeaks(wave, 3, 2)).toEqual([6, 7, 8, 9]);
  });

  it('a forrás végén túl nem talál ki csúcsot', () => {
    expect(clipWindowPeaks(wave, 9, 5)).toEqual([18, 19]);
  });

  it('hiányzó trimIn = a forrás eleje', () => {
    expect(clipWindowPeaks(wave, undefined, 1)).toEqual([0, 1]);
  });
});

describe('barHeights (A22)', () => {
  it('az abszolút szintet mutatja: a halk rész halk marad, nem nyúlik teljes magasságra', () => {
    const [quiet, loud] = barHeights([0.05, 0.9]);
    expect(quiet).toBeLessThan(0.35);
    expect(loud).toBeGreaterThan(0.9);
  });

  it('egyenletesen halk jel nem lesz teljes magasságú', () => {
    expect(Math.max(...barHeights([0.1, 0.1, 0.1]))).toBeLessThan(0.5);
  });

  it('a csend is látható minimum, és sosem lóg ki', () => {
    const h = barHeights([0, 1.4]);
    expect(h[0]).toBeGreaterThan(0);
    expect(h[1]).toBeLessThanOrEqual(1);
  });
});

describe('peaksFromChannels (A24)', () => {
  it('minden mintát néz: a ritkítás közé eső csúcs sem vész el', () => {
    const ch = new Float32Array(100);
    ch[3] = 0.8; // a régi 4-es lépés kihagyta volna
    expect(peaksFromChannels([ch], 100, 1, 1)?.peaks).toEqual([0.8]);
  });

  it('a jobb csatorna csúcsa is számít', () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    right[50] = -0.6;
    expect(peaksFromChannels([left, right], 100, 1, 1)?.peaks).toEqual([0.6]);
  });
});

describe('waveformCacheKey (A24)', () => {
  it('azonos nevű és méretű, de más fájl nem ütközik', () => {
    expect(waveformCacheKey('file:///a/song.m4a', 100, 1)).not.toBe(waveformCacheKey('file:///b/song.m4a', 100, 1));
    expect(waveformCacheKey('file:///a/song.m4a', 100, 1)).not.toBe(waveformCacheKey('file:///a/song.m4a', 100, 2));
  });
});

