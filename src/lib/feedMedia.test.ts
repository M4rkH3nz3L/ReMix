import { needsPoster, posterFrameTime } from '@/lib/feedMedia';
import type { RenderedVersion } from '@/types/project';

describe('posterFrameTime', () => {
  it('~10%, de min 0.5 mp, és nem a legvégén', () => {
    expect(posterFrameTime(0)).toBe(0);
    expect(posterFrameTime(10)).toBe(1); // 10% = 1
    expect(posterFrameTime(100)).toBe(10);
    expect(posterFrameTime(3)).toBe(0.5); // max(0.5, 0.3)
    expect(posterFrameTime(0.3)).toBeCloseTo(0.2, 10); // min(0.5, 0.3-0.1)
    expect(posterFrameTime(NaN)).toBe(0);
    expect(posterFrameTime(-5)).toBe(0);
  });
});

describe('needsPoster', () => {
  const base: RenderedVersion = { uri: 'file:///x.mp4', renderedAt: 'now', durationSec: 10 };
  it('akkor igaz, ha van feltöltött videó, de nincs poster', () => {
    expect(needsPoster(undefined)).toBe(false);
    expect(needsPoster(base)).toBe(false); // nincs url (még nincs feltöltve)
    expect(needsPoster({ ...base, url: 'https://cdn/x.mp4' })).toBe(true);
    expect(needsPoster({ ...base, url: 'https://cdn/x.mp4', posterUrl: 'https://cdn/x.jpg' })).toBe(false);
  });
});
