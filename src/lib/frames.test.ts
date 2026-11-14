import {
  AUDIO_EDIT_RATE,
  DEFAULT_FPS,
  editGridRate,
  FPS_OPTIONS,
  formatTimecode,
  frameDuration,
  frameToSec,
  projectFps,
  secToFrame,
  snapToEditGrid,
  snapToFrame,
} from '@/lib/frames';
import { OFFLINE_SAMPLE_RATE } from '@/lib/offlineMix';

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

  it('🎧 V6: hang/zene-projektben a rács a minta (= az offline keverés mintavétele), videóban a képkocka', () => {
    expect(AUDIO_EDIT_RATE).toBe(OFFLINE_SAMPLE_RATE);
    expect(editGridRate({ kind: 'audio', fps: 30 })).toBe(44100);
    expect(editGridRate({ kind: 'music', fps: 25 })).toBe(44100);
    expect(editGridRate({ kind: 'video', fps: 25 })).toBe(25);
    expect(editGridRate({ fps: undefined })).toBe(DEFAULT_FPS);
    expect(snapToEditGrid(1.00001, { kind: 'audio' })).toBe(Math.round(1.00001 * 44100) / 44100);
    expect(snapToEditGrid(1.03, { kind: 'video', fps: 25 })).toBeCloseTo(1.04, 12);
    // a frame-határ (30 fps) a minta-rácson is pontos: 1470 minta
    expect(snapToEditGrid(1 / 30, { kind: 'audio' }) * 44100).toBeCloseTo(1470, 9);
  });
});

