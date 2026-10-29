import { sourcePlatformOf } from '@/lib/sourceWatermark';

describe('sourcePlatformOf', () => {
  it('felismeri a letöltő-appok és platformok fájlneveit', () => {
    expect(sourcePlatformOf('file:///x/SnapTik_7212345.mp4')).toBe('tiktok');
    expect(sourcePlatformOf('ssstik.io_1700000000.mp4')).toBe('tiktok');
    expect(sourcePlatformOf('TikTok%20video%20by%20panda.mp4')).toBe('tiktok');
    expect(sourcePlatformOf('Instagram Reel 2026.mp4')).toBe('instagram');
    expect(sourcePlatformOf('y2mate.com - funny cat.mp4')).toBe('youtube');
    expect(sourcePlatformOf('CapCut_export.mp4')).toBe('capcut');
  });

  it('a saját felvétel / semleges név → null', () => {
    expect(sourcePlatformOf('file:///x/IMG_4021.MOV')).toBeNull();
    expect(sourcePlatformOf('rec_2026-10-29.mp4')).toBeNull();
    expect(sourcePlatformOf('')).toBeNull();
    expect(sourcePlatformOf(undefined)).toBeNull();
  });
});
