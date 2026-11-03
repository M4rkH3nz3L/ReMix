import { formatPlayClock, toVolumeStep } from '@/lib/feedPlayback';

describe('formatPlayClock', () => {
  it('perc:másodperc, egy óra alatt vezető nulla nélkül', () => {
    expect(formatPlayClock(0)).toBe('0:00');
    expect(formatPlayClock(7.9)).toBe('0:07');
    expect(formatPlayClock(750)).toBe('12:30');
  });

  it('egy óra fölött óra:perc:másodperc', () => {
    expect(formatPlayClock(3725)).toBe('1:02:05');
  });

  it('érvénytelen vagy negatív idő → 0:00', () => {
    expect(formatPlayClock(-3)).toBe('0:00');
    expect(formatPlayClock(Number.NaN)).toBe('0:00');
    expect(formatPlayClock(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('toVolumeStep', () => {
  it('a két vége elérhető: 0 és 100%', () => {
    expect(toVolumeStep(0)).toBe(0);
    expect(toVolumeStep(1)).toBe(1);
  });

  it('a tartományon kívüli húzás a szélére szorul', () => {
    expect(toVolumeStep(-0.2)).toBe(0);
    expect(toVolumeStep(1.3)).toBe(1);
  });

  it('egész százalékra kerekít', () => {
    expect(toVolumeStep(0.734)).toBe(0.73);
    expect(toVolumeStep(0.005)).toBe(0.01);
    expect(toVolumeStep(0.004)).toBe(0);
  });

  it('érvénytelen arány → 0', () => {
    expect(toVolumeStep(Number.NaN)).toBe(0);
  });
});
