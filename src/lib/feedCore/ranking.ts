import { applyDiversity, rankBy, rankTrending, type PostSignals } from '@/lib/feedRanking';
import type { FeedPost } from '@/types/social';

/** FeedPost → ranking-jelek az ELÉRHETŐ adatokból (engagement + frissesség). A
 *  watch-time/affinitás jelek a server-oldali ranking bekötésekor jönnek majd. */
function postSignals(post: FeedPost, nowMs: number): PostSignals {
  const c = post.counts;
  return {
    likes: c.likes,
    comments: c.comments,
    saves: c.saves,
    remixes: c.remixes,
    views: c.views,
    ageHours: Math.max(0, (nowMs - Date.parse(post.createdAt)) / 3_600_000),
  };
}

/**
 * 🎯 A For-You feed rangsorolása a kliensen (audit §4.3 bekötés): engagement +
 * frissesség-pontszám ([feedRanking.ts](./feedRanking.ts)) + diverzitás (ne klaszterezzen
 * egy alkotó). A **promoted** (megfizetett) posztok elöl maradnak. Így a „For You" már
 * nem tisztán kronológikus. (A `latest`/`following` mód változatlanul időrendi.)
 */
export function rankForYou(posts: FeedPost[], nowMs = Date.now()): FeedPost[] {
  const promoted = posts.filter((p) => p.promoted);
  const rest = posts.filter((p) => !p.promoted);
  const ranked = rankBy(rest, (p) => postSignals(p, nowMs));
  const diverse = applyDiversity(ranked, (p) => p.creator.id);
  return [...promoted, ...diverse];
}

/**
 * 🔥 Trending feed (audit §4.3): a GLOBÁLISAN felkapott posztok — engagement-SEBESSÉG
 * ([feedRanking.ts](./feedRanking.ts) `rankTrending`: nyers engagement / kor^gravity),
 * nem személyre szabott. A promoted elöl, a többi trending-sorrendben + diverzitás.
 */
export function rankTrendingFeed(posts: FeedPost[], nowMs = Date.now()): FeedPost[] {
  const promoted = posts.filter((p) => p.promoted);
  const rest = posts.filter((p) => !p.promoted);
  const ranked = rankTrending(rest, (p) => postSignals(p, nowMs));
  const diverse = applyDiversity(ranked, (p) => p.creator.id);
  return [...promoted, ...diverse];
}
