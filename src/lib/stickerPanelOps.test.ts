import { palette } from '@/constants/editor';
import {
  brushWidthStep,
  faceStickerLayout,
  imageAspect,
  logoHeight,
  particlesFor,
  shapeDefaults,
  sticker3dPreviewUrl,
} from '@/lib/stickerPanelOps';
import type { VideoClip } from '@/types/project';

const video = { kind: 'video', id: 'v', uri: 'file:///v.mp4', start: 2, duration: 10, trimIn: 0, speed: 1 } as VideoClip;

describe('stickerPanelOps — formák', () => {
  it('minden forma a saját kezdő-geometriáját kapja', () => {
    expect(shapeDefaults('rectangle')).toEqual({ w: 0.42, h: 0.2, fill: palette.accent, cornerRadius: 0.15 });
    expect(shapeDefaults('ellipse')).toEqual({ w: 0.42, h: 0.24, fill: palette.accent, cornerRadius: 0 });
    expect(shapeDefaults('line')).toEqual({ w: 0.6, h: 0.006, fill: '#ffffff', cornerRadius: 0 });
    expect(shapeDefaults('arrow')).toEqual({ w: 0.42, h: 0.12, fill: palette.accent, cornerRadius: 0 });
    expect(shapeDefaults('star')).toEqual({ w: 0.3, h: 0.17, fill: '#ffd166', cornerRadius: 0 });
  });
});

describe('stickerPanelOps — arc-matrica', () => {
  it('az arc fölé kerül, az arc méretéhez igazított betűmérettel, max 4 mp', () => {
    expect(faceStickerLayout({ x: 0.3, y: 0.35, w: 0.1, h: 0.12, score: 1 }, video, 3)).toEqual({
      duration: 4,
      fontSize: 11,
      position: { x: 0.3, y: 0.35 - 0.12 * 0.75 },
    });
  });

  it('a betűméret 8 és 30 közé szorul, a magasság legalább 0,05', () => {
    expect(faceStickerLayout({ x: 0.1, y: 0.02, w: 0.02, h: 0.03, score: 1 }, video, 3).fontSize).toBe(8);
    expect(faceStickerLayout({ x: 0.1, y: 0.02, w: 0.02, h: 0.03, score: 1 }, video, 3).position.y).toBe(0.05);
    expect(faceStickerLayout({ x: 0.5, y: 0.5, w: 0.6, h: 0.7, score: 1 }, video, 3).fontSize).toBe(30);
  });

  it('a videó vége előtt rövidül, de legalább 1 mp (a videón túl is)', () => {
    const face = { x: 0.5, y: 0.5, w: 0.1, h: 0.1, score: 1 };
    expect(faceStickerLayout(face, video, 10).duration).toBe(2);
    expect(faceStickerLayout(face, video, 11.5).duration).toBe(1);
    expect(faceStickerLayout(face, video, 30).duration).toBe(1);
  });
});

describe('stickerPanelOps — logó, ecset, részecske, 3D', () => {
  it('a kép-arány érvénytelen méretnél 1, a logó-magasság 0,6-nál megáll', () => {
    expect(imageAspect(1600, 900)).toBeCloseTo(16 / 9);
    expect(imageAspect(0, 100)).toBe(1);
    expect(imageAspect(100, 0)).toBe(1);
    expect(imageAspect(-5, 10)).toBe(1);
    expect(logoHeight(0.3, 1)).toBeCloseTo(0.16875);
    expect(logoHeight(0.3, 0.1)).toBe(0.6);
  });

  it('az ecset-vastagság 0,2-es lépésben, 0,2 és 6 közé szorítva, egy tizedesre kerekítve', () => {
    expect(brushWidthStep(0.9, 1)).toBe(1.1);
    expect(brushWidthStep(0.9, -1)).toBe(0.7);
    expect(brushWidthStep(0.2, -1)).toBe(0.2);
    expect(brushWidthStep(0.3, -1)).toBe(0.2);
    expect(brushWidthStep(6, 1)).toBe(6);
    expect(brushWidthStep(5.95, 1)).toBe(6);
    expect(brushWidthStep(5.7, 1)).toBe(5.9);
  });

  it('a részecske-preset a beat-syncet és az intenzitást megtartja, hiányában true / 1', () => {
    expect(particlesFor('snow', undefined)).toEqual({ preset: 'snow', beatSync: true, intensity: 1 });
    expect(particlesFor('embers', { preset: 'confetti', beatSync: false, intensity: 1.4 })).toEqual({
      preset: 'embers',
      beatSync: false,
      intensity: 1.4,
    });
    expect(particlesFor('sparkle', { preset: 'snow', beatSync: false })).toEqual({ preset: 'sparkle', beatSync: false, intensity: 1 });
  });

  it('a 3D-előnézet URL-je a worker-címből, méretből, anyagból és környezetből áll', () => {
    expect(sticker3dPreviewUrl('http://w:8787', '/stickers3d/cube.glb', 'gold', 'night')).toBe(
      'http://w:8787/stickers3d/cube.glb?size=160&material=gold&env=night'
    );
  });
});
