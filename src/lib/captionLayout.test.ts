import { assignSpeakers, captionBand, captionY, speakerColor, SPEAKER_COLORS, type SpeakerInput } from '@/lib/captionLayout';
import type { FaceBoxLike } from '@/lib/faceRegion';

// 🗣️ Caption Studio v2 (beszélő-hozzárendelés + arcot-kerülő felirat-pozíció) pure pajzsa.

describe('assignSpeakers', () => {
  it('egy forrás, szűk arc-szórás → egyetlen beszélő', () => {
    const lines: SpeakerInput[] = [
      { id: 'a', sourceKey: 'cam1', faceX: 0.5 },
      { id: 'b', sourceKey: 'cam1', faceX: 0.52 },
    ];
    const m = assignSpeakers(lines);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(0);
  });

  it('külön forrás → külön beszélő-index', () => {
    const m = assignSpeakers([
      { id: 'a', sourceKey: 'cam1' },
      { id: 'b', sourceKey: 'cam2' },
    ]);
    expect(m.get('a')).toBe(0);
    expect(m.get('b')).toBe(1);
  });

  it('egy forrás, nagy bal/jobb arc-szórás → két beszélő a felezővonal szerint', () => {
    const m = assignSpeakers([
      { id: 'l', sourceKey: 'cam1', faceX: 0.2 },
      { id: 'r', sourceKey: 'cam1', faceX: 0.8 },
    ]);
    expect(m.get('l')).not.toBe(m.get('r'));
  });
});

describe('speakerColor', () => {
  it('a színek körbefordulnak', () => {
    expect(speakerColor(0)).toBe(SPEAKER_COLORS[0]);
    expect(speakerColor(SPEAKER_COLORS.length)).toBe(SPEAKER_COLORS[0]);
  });
});

describe('captionY — arcot kerülő felirat-pozíció', () => {
  it('arc nélkül a preferált (biztonságos sávba zárva)', () => {
    expect(captionY(null, 0.78)).toBeCloseTo(0.78, 3);
  });

  it('ha az arc takarná az alsó-harmad feliratot, elmozdul (nem fedi az arcot)', () => {
    const face: FaceBoxLike = { x: 0.5, y: 0.78, w: 0.3, h: 0.3 };
    const y = captionY(face, 0.78, 0.14);
    // nem eshet egybe az arc középpontjával
    expect(Math.abs(y - 0.78)).toBeGreaterThan(0.01);
  });

  it('mindig a biztonságos sávon belül marad', () => {
    const face: FaceBoxLike = { x: 0.5, y: 0.5, w: 0.9, h: 0.9 };
    const y = captionY(face, 0.78, 0.14, 0.12, 0.9);
    expect(y).toBeGreaterThanOrEqual(0.12 + 0.14 / 2 - 1e-6);
    expect(y).toBeLessThanOrEqual(0.9 - 0.14 / 2 + 1e-6);
  });
});

describe('captionBand — a felirat sávmagassága', () => {
  it('hosszabb szöveg → több sor → nagyobb sáv, 0.5-re sapkázva', () => {
    const short = captionBand('Hi', 7);
    const long = captionBand('x'.repeat(400), 7);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(0.5);
  });
});
