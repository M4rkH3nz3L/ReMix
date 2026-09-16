import { pointsToPanKeyframes, smoothTrackPoints, type TrackPoint } from '@/lib/trackPlan';

const pt = (t: number, x: number, y = 0.5, s?: number): TrackPoint => ({
  t,
  x,
  y,
  score: 1,
  ...(s != null ? { s } : {}),
});

describe('trackPlan — követés-simítás', () => {
  describe('smoothTrackPoints', () => {
    it('kisimítja a tüskét, de nem tünteti el a jelet', () => {
      const spiky = Array.from({ length: 9 }, (_, i) => pt(i * 0.1, 0.5));
      spiky[4] = pt(0.4, 0.9);
      const sm = smoothTrackPoints(spiky, 0.5);
      expect(sm[4].x).toBeLessThan(0.75);
      expect(sm[4].x).toBeGreaterThan(0.5);
    });

    it('strength=0 esetén változatlanul hagyja', () => {
      const spiky = [pt(0, 0.5), pt(0.1, 0.9), pt(0.2, 0.5)];
      expect(smoothTrackPoints(spiky, 0).map((p) => p.x)).toEqual([0.5, 0.9, 0.5]);
    });

    it('ZERO-PHASE: egyenletes rámpa közepét nem tolja el (nincs lag)', () => {
      const ramp = Array.from({ length: 11 }, (_, i) => pt(i * 0.1, i / 10));
      const sm = smoothTrackPoints(ramp, 1);
      expect(sm[5].x).toBeCloseTo(0.5, 10);
    });

    it('3-nál kevesebb pontot érintetlenül hagy', () => {
      const two = [pt(0, 0.1), pt(0.1, 0.9)];
      expect(smoothTrackPoints(two, 1)).toEqual(two);
    });

    it('az s (méret) csatornát is simítja, ha van', () => {
      const withS = [pt(0, 0.5, 0.5, 1), pt(0.1, 0.5, 0.5, 2), pt(0.2, 0.5, 0.5, 1)];
      const sm = smoothTrackPoints(withS, 0.5);
      expect(sm[1].s).toBeLessThan(2);
      expect(sm[1].s).toBeGreaterThan(1);
    });

    it('ha nincs s, nem gyárt hozzá', () => {
      const sm = smoothTrackPoints([pt(0, 0.5), pt(0.1, 0.5), pt(0.2, 0.5)], 0.5);
      expect(sm[0].s).toBeUndefined();
    });
  });

  describe('pointsToPanKeyframes', () => {
    const spiky = (() => {
      const a = Array.from({ length: 9 }, (_, i) => pt(i * 0.1, 0.5));
      a[4] = pt(0.4, 0.9);
      return a;
    })();

    it('simítással a tüske delta-ja érdemben kisebb', () => {
      const smoothed = pointsToPanKeyframes(spiky, { x: 0, y: 0 }, 0, 1, 0.05, 0.5);
      const raw = pointsToPanKeyframes(spiky, { x: 0, y: 0 }, 0, 1, 0.05, 0);
      const maxSmoothed = Math.max(...smoothed.x.map((k) => k.value));
      const maxRaw = Math.max(...raw.x.map((k) => k.value));
      expect(maxSmoothed).toBeLessThan(maxRaw);
      expect(maxSmoothed).toBeLessThan(0.35);
    });

    it('a pan-értékek a ±0.75 transform-tartományon belül maradnak', () => {
      const far = [pt(0, 0.0), pt(0.5, 1.0), pt(1, 0.0)];
      const kfs = pointsToPanKeyframes(far, { x: 0, y: 0 }, 0, 1, 0.05, 0);
      for (const k of kfs.x) {
        expect(Math.abs(k.value)).toBeLessThanOrEqual(0.75);
      }
    });
  });
});
