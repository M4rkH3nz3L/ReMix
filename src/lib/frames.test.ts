import {
  DEFAULT_FPS,
  FPS_OPTIONS,
  formatTimecode,
  frameDuration,
  frameToSec,
  projectFps,
  secToFrame,
  snapToFrame,
} from '@/lib/frames';

describe('frames — frame-kvantált idő-modell', () => {
  describe('projectFps', () => {
    it('hiányzó/érvénytelen fps esetén a 30-as alapértékre esik', () => {
      expect(projectFps(null)).toBe(DEFAULT_FPS);
      expect(projectFps(undefined)).toBe(DEFAULT_FPS);
      expect(projectFps({ fps: 0 })).toBe(DEFAULT_FPS);
    });
    it('a projekt saját fps-ét adja vissza', () => {
      expect(projectFps({ fps: 24 })).toBe(24);
      expect(projectFps({ fps: 60 })).toBe(60);
    });
  });

  it('frameDuration egy kocka hossza másodpercben', () => {
    expect(frameDuration(30)).toBeCloseTo(1 / 30, 10);
    expect(frameDuration(25)).toBeCloseTo(0.04, 10);
  });

  it('secToFrame / frameToSec oda-vissza konzisztens a rácson lévő értékre', () => {
    expect(secToFrame(1, 30)).toBe(30);
    expect(secToFrame(0.5, 24)).toBe(12);
    expect(frameToSec(30, 30)).toBe(1);
    // 2.4 s @ 25 fps = pontosan a 60. kocka → hibamentes oda-vissza
    expect(frameToSec(secToFrame(2.4, 25), 25)).toBeCloseTo(2.4, 10);
  });

  it('a PONT félkockára eső idő felfelé kerekül (dokumentált viselkedés)', () => {
    // 2.5 s @ 25 fps = 62.5 kocka → 63 → 2.52 s. Ez szándékos: a kerekítés
    // determinisztikus, és a rácsra ültetés után minden hívó ugyanazt kapja.
    expect(secToFrame(2.5, 25)).toBe(63);
    expect(snapToFrame(2.5, 25)).toBeCloseTo(2.52, 10);
  });

  describe('snapToFrame', () => {
    it('a legközelebbi kockára kerekít', () => {
      // 1.017 * 30 = 30.51 → 31 kocka
      expect(snapToFrame(1.017, 30)).toBeCloseTo(31 / 30, 6);
      // 1.01 * 30 = 30.3 → 30 kocka
      expect(snapToFrame(1.01, 30)).toBeCloseTo(1, 9);
    });
    it('a rácson lévő értéket nem mozdítja', () => {
      expect(snapToFrame(2, 30)).toBeCloseTo(2, 10);
    });
  });

  describe('formatTimecode (HH:MM:SS:FF, non-drop)', () => {
    it.each([
      [0, 30, '00:00:00:00'],
      [1.5, 30, '00:00:01:15'],
      [61.1, 30, '00:01:01:03'],
      [3661.0, 25, '01:01:01:00'],
      [23 / 24, 24, '00:00:00:23'],
    ])('%ss @ %s fps → %s', (sec, fps, expected) => {
      expect(formatTimecode(sec, fps)).toBe(expected);
    });

    it('a kocka-mező SOHA nem csordul túl (0.999s @30 → a következő másodperc)', () => {
      // 0.999 * 30 = 29.97 → 30 kocka → 1 mp : 00 kocka (nem 00:00:00:30)
      expect(formatTimecode(0.999, 30)).toBe('00:00:01:00');
    });

    it('negatív időt 0-ként kezel', () => {
      expect(formatTimecode(-5, 30)).toBe('00:00:00:00');
    });
  });

  it('a választható frame-ráták a szabványos készlet', () => {
    expect([...FPS_OPTIONS]).toEqual([24, 25, 30, 50, 60]);
  });
});
