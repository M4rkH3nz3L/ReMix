import { brandLogoWatermark } from '@/lib/brandKit';
import { addBrandLogo, brandLogoLayer, EMPTY_BRAND, MAX_BRAND_LOGOS, removeBrandLogo } from '@/lib/imageBrand';
import type { PhotoLayer } from '@/types/project';

describe('🏷️ S11: márka-logó a képen és a videón', () => {
  it('a márka legfeljebb 4 logót tart, az új elöl, törölhető', () => {
    let s = EMPTY_BRAND;
    for (let i = 0; i < 6; i++) s = addBrandLogo(s, `file:///brand/l${i}.png`);
    expect(s.logos).toHaveLength(MAX_BRAND_LOGOS);
    expect(s.logos![0]).toBe('file:///brand/l5.png');
    expect(removeBrandLogo(s, 'file:///brand/l5.png').logos).not.toContain('file:///brand/l5.png');
  });

  it.each([
    ['fekvő 16:9', 1920, 1080],
    ['álló 9:16', 1080, 1920],
    ['négyzet', 1080, 1080],
  ])('%s: a kép-réteg és a videó-vízjel ugyanakkora négyzet, ugyanott (jobb alsó sarok)', (_n, W, H) => {
    const layer = brandLogoLayer('u', 'l', { width: W, height: H }) as PhotoLayer;
    const wm = brandLogoWatermark('u', W / H);
    // pixelben négyzet, a rövidebb oldal 18%-a
    expect(layer.w * W).toBeCloseTo(0.18 * Math.min(W, H), 3);
    expect(layer.h * H).toBeCloseTo(0.18 * Math.min(W, H), 3);
    expect(wm.w).toBeCloseTo(layer.w, 6);
    expect(wm.h).toBeCloseTo(layer.h, 6);
    expect(wm.position.x).toBeCloseTo(layer.position.x, 6);
    expect(wm.position.y).toBeCloseTo(layer.position.y, 6);
    expect(layer.position.x + layer.w / 2).toBeLessThan(1);
    expect(layer.position.y + layer.h / 2).toBeLessThan(1);
    expect(layer.fit).toBe('contain');
  });
});
