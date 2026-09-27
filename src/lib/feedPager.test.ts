import { pageFromScroll, remixPages, resolveActiveId, visibleRemixes } from '@/lib/feedPager';
import type { FeedPost } from '@/types/social';

/** Minimális, érvényes FeedPost a pager-logika teszteléséhez (a többi mező irreleváns). */
function mk(id: string, over: Partial<FeedPost> = {}): FeedPost {
  const base: FeedPost = {
    id,
    creator: { id: `u_${id}`, username: id, displayName: id },
    title: id,
    description: '',
    hashtags: [],
    videoUri: `https://x/${id}.mp4`,
    posterUri: null,
    aspectRatio: '9:16',
    durationSec: 5,
    rendered: true,
    remixable: true,
    visibility: 'public',
    moderationStatus: 'ok',
    createdAt: '2026-01-01T00:00:00Z',
    counts: { likes: 0, comments: 0, saves: 0, views: 0, remixes: 0 },
  };
  return { ...base, ...over };
}

describe('remixPages', () => {
  const post = mk('orig');

  it('remix nélkül csak az eredetit adja', () => {
    expect(remixPages(post, undefined)).toEqual([post]);
    expect(remixPages(post, [])).toEqual([post]);
  });

  it('az eredetit teszi elsőnek, aztán a remixeket sorrendben', () => {
    const rx = [mk('r1'), mk('r2')];
    expect(remixPages(post, rx).map((p) => p.id)).toEqual(['orig', 'r1', 'r2']);
  });
});

describe('visibleRemixes', () => {
  it('kiszűri a moderáltan eltávolított remixeket', () => {
    const list = [mk('ok1'), mk('gone', { moderationStatus: 'removed' }), mk('pending', { moderationStatus: 'pending' })];
    expect(visibleRemixes(list).map((p) => p.id)).toEqual(['ok1']);
  });
});

describe('resolveActiveId', () => {
  const remixes = [mk('r1'), mk('r2')];

  it('aktív top nélkül null', () => {
    expect(resolveActiveId(null, {}, remixes)).toBeNull();
  });

  it('0. lap (vagy hiányzó index) = az eredeti top-poszt', () => {
    expect(resolveActiveId('orig', {}, remixes)).toBe('orig');
    expect(resolveActiveId('orig', { orig: 0 }, remixes)).toBe('orig');
  });

  it('1..N. lap = a megfelelő remix', () => {
    expect(resolveActiveId('orig', { orig: 1 }, remixes)).toBe('r1');
    expect(resolveActiveId('orig', { orig: 2 }, remixes)).toBe('r2');
  });

  it('betöltetlen/túlindexelt remixnél biztonságosan az eredetire esik vissza', () => {
    expect(resolveActiveId('orig', { orig: 1 }, undefined)).toBe('orig');
    expect(resolveActiveId('orig', { orig: 9 }, remixes)).toBe('orig');
  });
});

describe('pageFromScroll', () => {
  const W = 400;

  it('pontosan egy lapra beállva a lap-indexet adja', () => {
    expect(pageFromScroll(0, W)).toBe(0);
    expect(pageFromScroll(400, W)).toBe(1);
    expect(pageFromScroll(800, W)).toBe(2);
  });

  it('közel-beállt (küszöbön belül) is elfogad', () => {
    expect(pageFromScroll(402, W)).toBe(1);
    expect(pageFromScroll(398, W)).toBe(1);
  });

  it('mid-swipe (nem beállt) null → nincs videó-váltás félúton', () => {
    expect(pageFromScroll(200, W)).toBeNull();
    expect(pageFromScroll(360, W)).toBeNull();
  });

  it('negatív túlhúzást 0-ra fog', () => {
    expect(pageFromScroll(-2, W)).toBe(0);
  });

  it('0 szélességnél nem oszt nullával', () => {
    expect(pageFromScroll(0, 0)).toBe(0);
  });
});
