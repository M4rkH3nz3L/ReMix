import { rankForYou } from '@/lib/feed';
import type { FeedPost } from '@/types/social';

const NOW = Date.parse('2026-10-06T12:00:00Z');

const post = (over: Partial<FeedPost> & { id: string; creatorId: string }): FeedPost =>
  ({
    id: over.id,
    creator: { id: over.creatorId, username: over.creatorId, name: over.creatorId, avatar: null } as unknown as FeedPost['creator'],
    title: over.id,
    aspectRatio: '9:16',
    rendered: true,
    remixable: true,
    visibility: 'public',
    moderationStatus: 'ok',
    promoted: over.promoted ?? false,
    createdAt: over.createdAt ?? '2026-10-06T11:00:00Z',
    counts: over.counts ?? { likes: 0, comments: 0, saves: 0, views: 100, remixes: 0 },
    viewerLiked: false,
    viewerSaved: false,
  }) as unknown as FeedPost;

describe('rankForYou — For-You rangsor (audit §4.3 bekötés)', () => {
  it('a promoted posztok elöl maradnak', () => {
    const posts = [
      post({ id: 'a', creatorId: 'c1', counts: { likes: 1, comments: 0, saves: 0, views: 100, remixes: 0 } }),
      post({ id: 'promo', creatorId: 'c2', promoted: true, counts: { likes: 0, comments: 0, saves: 0, views: 100, remixes: 0 } }),
    ];
    expect(rankForYou(posts, NOW)[0].id).toBe('promo');
  });

  it('a magasabb engagement előrébb (azonos frissességnél)', () => {
    const posts = [
      post({ id: 'low', creatorId: 'c1', counts: { likes: 1, comments: 0, saves: 0, views: 100, remixes: 0 } }),
      post({ id: 'high', creatorId: 'c2', counts: { likes: 90, comments: 0, saves: 0, views: 100, remixes: 0 } }),
    ];
    expect(rankForYou(posts, NOW).map((p) => p.id)).toEqual(['high', 'low']);
  });

  it('diverzitás: nem 2-nél több egymás utáni azonos alkotó', () => {
    const hi = { likes: 90, comments: 0, saves: 0, views: 100, remixes: 0 };
    const mid = { likes: 50, comments: 0, saves: 0, views: 100, remixes: 0 };
    const posts = [
      post({ id: 'x1', creatorId: 'X', counts: hi }),
      post({ id: 'x2', creatorId: 'X', counts: hi }),
      post({ id: 'x3', creatorId: 'X', counts: hi }),
      post({ id: 'y1', creatorId: 'Y', counts: mid }),
    ];
    const ids = rankForYou(posts, NOW).map((p) => p.id);
    // a 3. X helyett Y-t húz előre
    expect(ids.slice(0, 3)).toEqual(['x1', 'x2', 'y1']);
    expect(ids[3]).toBe('x3');
  });
});
