import { COMMENT_COLUMNS, toComment, type CommentRow } from '@/lib/feedCore/comments';
import { POST_COLUMNS, toPost, type PostRow } from '@/lib/feedCore/postRows';
import { orFilterValue } from '@/lib/feedCore/search';
import * as feed from '@/lib/feed';

/** 🧱 A feed expo-mentes magja (REFACTOR: a src/lib/feed.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const row = (over: Partial<PostRow> & Record<string, unknown> = {}): PostRow =>
  ({
    id: 'p1',
    creator_id: 'c1234567890',
    project_id: null,
    title: 'Cím',
    description: null,
    hashtags: null,
    video_url: null,
    poster_url: null,
    aspect_ratio: '16:9',
    duration_sec: 3,
    project_snapshot: null,
    visibility: 'public',
    moderation_status: 'ok',
    promoted: false,
    remixable: true,
    remix_of_post_id: null,
    remix_of_creator: null,
    music: null,
    creator_username: null,
    creator_name: null,
    creator_avatar: null,
    likes: 1,
    comments: 2,
    saves: 3,
    views: 4,
    remixes: 5,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  }) as PostRow;

describe('POST_COLUMNS / COMMENT_COLUMNS — a lekért oszlopok (RLS-érzékeny select) pontosan', () => {
  it('a poszt-oszlopok listája és sorrendje változatlan', () => {
    expect(POST_COLUMNS).toBe(
      'id, creator_id, project_id, title, description, hashtags, video_url, poster_url, aspect_ratio, duration_sec, project_snapshot, visibility, moderation_status, promoted, remixable, remix_of_post_id, remix_of_creator, music, creator_username, creator_name, creator_avatar, likes, comments, saves, views, remixes, created_at'
    );
  });
  it('a komment-oszlopok listája változatlan', () => {
    expect(COMMENT_COLUMNS).toBe('id, post_id, author_id, body, author_username, author_name, author_avatar, created_at');
  });
});

describe('toPost — sor → FeedPost', () => {
  it('hiányzó mezőknél a fallbackok: username = id első 8 jele, név = „Creator”, üres leírás/hashtag', () => {
    const p = toPost(row(), new Set(), new Set());
    expect(p.creator).toEqual({ id: 'c1234567890', username: 'c1234567', displayName: 'Creator', avatarUri: undefined });
    expect([p.description, p.hashtags, p.videoUri, p.posterUri, p.rendered]).toEqual(['', [], null, null, false]);
    expect([p.projectId, p.remixOfPostId, p.remixOfCreator, p.music, p.interactive, p.images]).toEqual([
      undefined, undefined, undefined, undefined, undefined, undefined,
    ]);
    expect(p.counts).toEqual({ likes: 1, comments: 2, saves: 3, views: 4, remixes: 5 });
    expect('sourceKind' in p).toBe(false);
  });
  it('a megjelenített név a username-re esik vissza, ha nincs név', () => {
    expect(toPost(row({ creator_username: 'anna' }), new Set(), new Set()).creator.displayName).toBe('anna');
  });
  it('a néző like/save halmaza id szerint', () => {
    const p = toPost(row(), new Set(['p1']), new Set(['x']));
    expect([p.viewerLiked, p.viewerSaved]).toEqual([true, false]);
  });
  it('null képarány → 9:16', () => {
    expect(toPost(row({ aspect_ratio: null as unknown as string }), new Set(), new Set()).aspectRatio).toBe('9:16');
  });
  it('a carousel üres elemei kiesnek; üres carousel → nincs images', () => {
    const p = toPost(row({ project_snapshot: { carousel: ['https://a/1.png', '', 'https://a/2.png'] } }), new Set(), new Set());
    expect(p.images).toEqual(['https://a/1.png', 'https://a/2.png']);
    expect(toPost(row({ project_snapshot: { carousel: [] } }), new Set(), new Set()).images).toBeUndefined();
  });
  it('a hotspot-sáv az interactive-ba kerül', () => {
    const tracks = [{ id: 't', type: 'interactive', clips: [] }] as never;
    expect(toPost(row({ project_snapshot: { tracks } }), new Set(), new Set()).interactive).toEqual({ tracks });
  });
  it('hang-poszt: sourceKind; a sáv-leírás CSAK remixelhető posztnál és csak érvényesen kerül át', () => {
    const snap = { sourceKind: 'audio', remixTracks: { bogus: true } } as never;
    const p = toPost(row({ project_snapshot: snap }), new Set(), new Set());
    expect(p.sourceKind).toBe('audio');
    expect(p.remixTracks).toBeUndefined();
    const q = toPost(row({ project_snapshot: snap, remixable: false }), new Set(), new Set());
    expect('remixTracks' in q).toBe(false);
  });
});

describe('toComment — komment-sor → PostComment', () => {
  it('a szerző fallbackjai mint a posztnál', () => {
    const r: CommentRow = {
      id: 'k', post_id: 'p', author_id: 'a123456789', body: 'b',
      author_username: null, author_name: null, author_avatar: null, created_at: 'c',
    };
    expect(toComment(r)).toEqual({
      id: 'k', postId: 'p', authorId: 'a123456789',
      author: { id: 'a123456789', username: 'a1234567', displayName: 'Creator', avatarUri: undefined },
      body: 'b', createdAt: 'c',
    });
    expect(toComment({ ...r, author_username: 'u' }).author.displayName).toBe('u');
  });
});

describe('orFilterValue — PostgREST .or()-érték idézve', () => {
  it('idézőjel és backslash escape-elve, a vessző/zárójel érintetlen', () => {
    expect(orFilterValue('a"b\\c,(d)')).toBe('"a\\"b\\\\c,(d)"');
    expect(orFilterValue('')).toBe('""');
  });
});

describe('a feed.ts barrel — a régi publikus felület', () => {
  it('minden korábbi futásidejű export elérhető (függvényként)', () => {
    expect(Object.keys(feed).sort()).toEqual([
      'addComment', 'currentUserId', 'deleteComment', 'deletePost', 'deletePostsForProject', 'fetchViewEvents',
      'getChannel', 'listComments', 'listFeed', 'listPostsByHashtag', 'listPostsByIds', 'listRemixesOf',
      'moderateRemix', 'orFilterValue', 'publishImageProject', 'publishLiveVod', 'publishPost',
      'publishRenderedProject', 'rankForYou', 'rankTrendingFeed', 'recordView', 'recordViewEvent',
      'remixFromPost', 'searchFeed', 'subscribeComments', 'toggleFollow', 'toggleLike', 'toggleSave',
    ]);
    for (const v of Object.values(feed)) expect(typeof v).toBe('function');
  });
});
