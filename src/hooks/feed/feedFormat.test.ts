import { compact, hotspotsOf } from '@/hooks/feed/feedFormat';
import type { FeedPost } from '@/types/social';

/** 🔢 A feed kijelzés-segédei (REFACTOR: a useFeed.ts-ből kiemelve) — a mai viselkedés rögzítve. */

describe('compact — rövid számláló-formátum', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [1049, '1.0k'],
    [1050, '1.1k'],
    [999_999, '1000.0k'],
    [1_000_000, '1.0M'],
    [2_340_000, '2.3M'],
    [-5, '-5'],
    [0.5, '0.5'],
  ])('%p → %p', (n, out) => {
    expect(compact(n)).toBe(out);
  });
});

describe('hotspotsOf — a poszt interaktív klipjei', () => {
  const post = (interactive: unknown) => ({ interactive }) as unknown as FeedPost;
  it('csak az ELSŐ interactive sáv interactive klipjei', () => {
    const tracks = [
      { type: 'video', clips: [{ id: 'v', kind: 'interactive' }] },
      { type: 'interactive', clips: [{ id: 'h1', kind: 'interactive' }, { id: 't', kind: 'text' }] },
      { type: 'interactive', clips: [{ id: 'h2', kind: 'interactive' }] },
    ];
    expect(hotspotsOf(post({ tracks })).map((c) => c.id)).toEqual(['h1']);
  });
  it('nincs interaktív réteg / sáv / klip → üres', () => {
    expect(hotspotsOf(post(undefined))).toEqual([]);
    expect(hotspotsOf(post({ tracks: [] }))).toEqual([]);
    expect(hotspotsOf(post({ tracks: [{ type: 'interactive' }] }))).toEqual([]);
  });
});
