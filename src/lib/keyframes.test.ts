import { bezierEase, easeValue, sampleChannel } from '@/lib/keyframes';
import type { Keyframe } from '@/types/project';

const kf = (time: number, value: number, easing: Keyframe['easing']): Keyframe => ({
  time,
  value,
  easing,
});

describe('keyframes — interpoláció', () => {
  describe('easeValue', () => {
    it('linear: a progressz önmaga', () => {
      expect(easeValue(kf(0, 0, 'linear'), 0.5)).toBeCloseTo(0.5, 10);
    });

    it('hold (step): a progressz VÉGIG 0 — az érték áll a következő kulcskockáig', () => {
      expect(easeValue(kf(0, 0, 'hold'), 0)).toBe(0);
      expect(easeValue(kf(0, 0, 'hold'), 0.5)).toBe(0);
      expect(easeValue(kf(0, 0, 'hold'), 0.99)).toBe(0);
    });

    it('easeIn/easeOut a megfelelő irányba görbül', () => {
      expect(easeValue(kf(0, 0, 'easeIn'), 0.5)).toBeLessThan(0.5);
      expect(easeValue(kf(0, 0, 'easeOut'), 0.5)).toBeGreaterThan(0.5);
    });
  });

  describe('sampleChannel + hold', () => {
    const kfs = [kf(0, 10, 'hold'), kf(2, 50, 'linear')];

    it.each([
      [0, 10],
      [0.5, 10],
      [1.99, 10],
      [2, 50], // a következő kulcskockán UGRIK
    ])('hold: t=%s → %s', (t, expected) => {
      expect(sampleChannel(kfs, t, 0)).toBe(expected);
    });

    it('linear kontroll: ugyanez lineárisan a felezőponton 30', () => {
      const lin = [kf(0, 10, 'linear'), kf(2, 50, 'linear')];
      expect(sampleChannel(lin, 1, 0)).toBe(30);
    });
  });

  describe('sampleChannel — szélek', () => {
    const kfs = [kf(1, 5, 'linear'), kf(3, 9, 'linear')];
    it('az első kulcskocka előtt az első értéket tartja', () => {
      expect(sampleChannel(kfs, 0, 0)).toBe(5);
    });
    it('az utolsó után az utolsót tartja', () => {
      expect(sampleChannel(kfs, 10, 0)).toBe(9);
    });
    it('üres listánál a fallback jön', () => {
      expect(sampleChannel([], 1, 42)).toBe(42);
    });
  });

  describe('bezierEase', () => {
    it('a végpontokban pontos', () => {
      expect(bezierEase([0.42, 0, 0.58, 1], 0)).toBe(0);
      expect(bezierEase([0.42, 0, 0.58, 1], 1)).toBe(1);
    });
    it('monoton növekvő egy szokásos ease-görbén', () => {
      const cp: [number, number, number, number] = [0.42, 0, 0.58, 1];
      const a = bezierEase(cp, 0.25);
      const b = bezierEase(cp, 0.5);
      const c = bezierEase(cp, 0.75);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    });
    it('a lineáris vezérlőpontok ~identitást adnak', () => {
      expect(bezierEase([0, 0, 1, 1], 0.5)).toBeCloseTo(0.5, 2);
    });
  });
});
