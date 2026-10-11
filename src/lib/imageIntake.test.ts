import { INTAKE_MAX_DIM, imageExtOf, intakeOps, isSupportedImage, planImageResize } from './imageIntake';

describe('imageIntake', () => {
  describe('planImageResize', () => {
    test('a határ alatt → null (nem kell kicsinyíteni)', () => {
      expect(planImageResize(1000, 800)).toBeNull();
      expect(planImageResize(INTAKE_MAX_DIM, INTAKE_MAX_DIM)).toBeNull();
    });

    test('nagy fekvő kép → a leghosszabb oldal = maxDim, arány tartva', () => {
      const r = planImageResize(12000, 9000);
      expect(r).not.toBeNull();
      expect(r!.width).toBe(INTAKE_MAX_DIM);
      expect(r!.height).toBe(Math.round((9000 / 12000) * INTAKE_MAX_DIM));
      // arány megtartva (±1 px kerekítés)
      expect(Math.abs(r!.width / r!.height - 12000 / 9000)).toBeLessThan(0.01);
    });

    test('nagy álló kép → a magasság = maxDim', () => {
      const r = planImageResize(3000, 9000);
      expect(r!.height).toBe(INTAKE_MAX_DIM);
      expect(r!.width).toBe(Math.round((3000 / 9000) * INTAKE_MAX_DIM));
    });

    test('egyedi maxDim', () => {
      expect(planImageResize(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    });

    test('érvénytelen méret → null', () => {
      expect(planImageResize(0, 100)).toBeNull();
      expect(planImageResize(NaN, 100)).toBeNull();
      expect(planImageResize(-5, 100)).toBeNull();
    });
  });

  describe('intakeOps', () => {
    test('nagy kép → egy resize-op', () => {
      const ops = intakeOps(8000, 6000);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ type: 'resize', width: INTAKE_MAX_DIM });
    });

    test('kicsi kép → üres (csak re-encode a hívóban)', () => {
      expect(intakeOps(800, 600)).toEqual([]);
    });

    test('ismeretlen méret → üres (csak re-encode)', () => {
      expect(intakeOps(undefined, undefined)).toEqual([]);
      expect(intakeOps(1000, undefined)).toEqual([]);
    });
  });

  describe('imageExtOf / isSupportedImage', () => {
    test('kiterjesztés kiolvasása (query/hash levágva, kisbetűs)', () => {
      expect(imageExtOf('file:///a/b/photo.HEIC')).toBe('heic');
      expect(imageExtOf('https://x/y.png?v=2')).toBe('png');
      expect(imageExtOf('ph://ABC-123')).toBe('');
    });

    test('támogatott formátumok + ismeretlen protokoll engedve', () => {
      expect(isSupportedImage('a.jpg')).toBe(true);
      expect(isSupportedImage('a.heic')).toBe(true);
      expect(isSupportedImage('a.webp')).toBe(true);
      expect(isSupportedImage('ph://ABC')).toBe(true); // a natív réteg dönt
      expect(isSupportedImage('a.psd')).toBe(false);
      expect(isSupportedImage('a.txt')).toBe(false);
    });
  });
});
