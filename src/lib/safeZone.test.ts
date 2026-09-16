import { captionInSafeZone, fitCaptionY, safeZone } from '@/lib/safeZone';

describe('safeZone — felirat-elhelyezés ellenőrzése', () => {
  it('9:16-nál a platform-UI sávjait is figyelembe veszi', () => {
    const z = safeZone('9:16');
    expect(z.top).toBeCloseTo(0.06, 10); // felső státusz-sáv
    expect(z.bottom).toBeCloseTo(0.8, 10); // alsó név/felirat/zene sáv
    expect(z.right).toBeCloseTo(0.86, 10); // jobb akció-gombok
  });

  it('16:9-nél nincsenek platform-sávok, csak az 5%-os inset', () => {
    const z = safeZone('16:9');
    expect(z.bottom).toBeCloseTo(0.95, 10);
    expect(z.top).toBeCloseTo(0.05, 10);
  });

  describe('captionInSafeZone', () => {
    const z = safeZone('9:16');
    it('az alsó sávba lógó felirat NEM biztonságos', () => {
      expect(captionInSafeZone({ x: 0.5, y: 0.9, band: 0.14 }, z)).toBe(false);
    });
    it('a sávon belüli felirat biztonságos', () => {
      expect(captionInSafeZone({ x: 0.5, y: 0.7, band: 0.14 }, z)).toBe(true);
    });
    it('a pontosan a határon lévő még belefér (tűrés)', () => {
      expect(captionInSafeZone({ x: 0.5, y: z.bottom - 0.07, band: 0.14 }, z)).toBe(true);
    });
  });

  describe('fitCaptionY', () => {
    const z = safeZone('9:16');
    it('a kilógó feliratot a sávba húzza', () => {
      const y = fitCaptionY({ x: 0.5, y: 0.95, band: 0.14 }, z);
      expect(captionInSafeZone({ x: 0.5, y, band: 0.14 }, z)).toBe(true);
    });
    it('a már jó pozíciót nem mozdítja', () => {
      expect(fitCaptionY({ x: 0.5, y: 0.7, band: 0.14 }, z)).toBeCloseTo(0.7, 10);
    });
    it('ha a sáv magasabb, mint a biztonságos terület, a tetejéhez igazít', () => {
      const y = fitCaptionY({ x: 0.5, y: 0.5, band: 0.95 }, z);
      expect(y).toBeCloseTo(z.top + 0.475, 6);
    });
  });
});
