import { resamplePeaks } from '@/lib/waveform';

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
