import { reachableMediaUrl } from '@/lib/mediaUrl';
import { requireSupabase, supabase } from '@/lib/supabase';
import type { Creator, FeedMode, FeedPost } from '@/types/social';
import { POST_COLUMNS, toPost, type PostRow } from '@/lib/feedCore/postRows';
import { rankForYou, rankTrendingFeed } from '@/lib/feedCore/ranking';
import { orFilterValue, type SearchResults } from '@/lib/feedCore/search';
import { currentUserId, viewerEngagement } from '@/lib/feedClient/session';

/** A feed (foryou = rangsorolt; latest = legújabb publikus; following = a követettjeim). */
export async function listFeed(mode: FeedMode = 'foryou', limit = 50): Promise<FeedPost[]> {
  const sb = requireSupabase();
  let creatorIds: string[] | null = null;
  if (mode === 'following') {
    const uid = currentUserId();
    if (!uid) {
      return [];
    }
    const { data: f } = await sb.from('follows').select('following_id').eq('follower_id', uid);
    creatorIds = (f ?? []).map((r: { following_id: string }) => r.following_id);
    if (creatorIds.length === 0) {
      return [];
    }
  }
  let q = sb
    .from('posts')
    .select(POST_COLUMNS)
    .eq('moderation_status', 'ok')
    // kiemelt (megfizetett) posztok előre, aztán legújabb
    .order('promoted', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (creatorIds) {
    // a követett csatornák NYILVÁNOS + KÖVETŐK-only posztjai (az RLS is ezt engedi)
    q = q.in('creator_id', creatorIds).in('visibility', ['public', 'followers']);
  } else {
    q = q.eq('visibility', 'public');
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  const posts = rows.map((r) => toPost(r, liked, saved));
  // 🎯 §4.3: a For-You-t engagement+frissesség+diverzitással, a trending-et
  // engagement-SEBESSÉGgel rangsoroljuk a kliensen; a latest/following időrendi marad.
  if (mode === 'foryou') {
    return rankForYou(posts);
  }
  if (mode === 'trending') {
    return rankTrendingFeed(posts);
  }
  return posts;
}

/**
 * 🔎 Keresés a nyilvános feedben: cím / alkotó-username / megjelenített név
 * (ilike), plusz hashtag-egyezés (a `#tag` és a sima szó is). A posztok mellett
 * KÖZVETLENÜL a USEREKET is keresi a `profiles`-ban (username / megjelenített
 * név) — így az is megjelenik az „Alkotók" szekcióban, akinek nincs a keresésre
 * illő posztja (vagy posztja egyáltalán). Csak publikus + moderált (`ok`) posztok
 * — az RLS is ezt engedi kijelentkezve is.
 */
export async function searchFeed(query: string, limit = 40): Promise<SearchResults> {
  const q = query.trim();
  if (!q) {
    return { posts: [], creators: [] };
  }
  const sb = requireSupabase();
  // ilike-biztos minta: a `%`, `_`, `\` speciális karaktereket kiöljük
  const safe = q.replace(/[%_\\]/g, ' ').trim();
  const like = orFilterValue(`%${safe}%`);
  const tag = safe.replace(/^#+/, '').toLowerCase();

  const base = () =>
    sb.from('posts').select(POST_COLUMNS).eq('moderation_status', 'ok').eq('visibility', 'public');

  // szöveges találat: cím / egyedi username / megjelenített név
  const textReq = base()
    .or(`title.ilike.${like},creator_username.ilike.${like},creator_name.ilike.${like}`)
    .order('promoted', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  // hashtag-találat (best-effort: pontos tömb-elem egyezés) — a `#tag`-et is elkapja
  const tagReq = tag
    ? base().contains('hashtags', [tag]).order('created_at', { ascending: false }).limit(limit)
    : Promise.resolve({ data: [] as PostRow[], error: null });
  // 👤 KÖZVETLEN user-keresés a profiles-ból (username / megjelenített név) — így az
  //    is kereshető, akinek nincs a keresésre illő posztja (vagy posztja egyáltalán)
  const userReq = sb
    .from('profiles')
    .select('id, username, full_name, avatar_url')
    .or(`username.ilike.${like},full_name.ilike.${like}`)
    .limit(limit);

  const [textRes, tagRes, userRes] = await Promise.all([textReq, tagReq, userReq]);
  if (textRes.error) {
    throw new Error(textRes.error.message);
  }
  // a hashtag-ág hibája NEM végzetes (a szöveges találat így is megjön)
  const merged = new Map<string, PostRow>();
  ((textRes.data ?? []) as PostRow[]).forEach((r) => merged.set(r.id, r));
  ((tagRes.data ?? []) as PostRow[]).forEach((r) => {
    if (!merged.has(r.id)) {
      merged.set(r.id, r);
    }
  });
  const rows = [...merged.values()];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  const posts = rows.map((r) => toPost(r, liked, saved));

  // egyedi alkotók: ELŐSZÖR a közvetlen user-találatok (profiles — akkor is, ha
  // nincs posztjuk), UTÁNA a találati posztok szerzői (első előfordulás sorrendjében).
  // A profiles-ág hibája NEM végzetes (a poszt-találatok így is megjönnek).
  const creatorMap = new Map<string, Creator>();
  if (!userRes.error) {
    (
      (userRes.data ?? []) as Array<{
        id: string;
        username: string | null;
        full_name: string | null;
        avatar_url: string | null;
      }>
    ).forEach((r) => {
      if (r.id && !creatorMap.has(r.id)) {
        creatorMap.set(r.id, {
          id: r.id,
          username: r.username ?? r.id.slice(0, 8),
          displayName: r.full_name ?? r.username ?? 'Creator',
          avatarUri: reachableMediaUrl(r.avatar_url ?? null) ?? undefined,
        });
      }
    });
  }
  posts.forEach((p) => {
    if (!creatorMap.has(p.creator.id)) {
      creatorMap.set(p.creator.id, p.creator);
    }
  });
  return { posts, creators: [...creatorMap.values()] };
}

/**
 * #️⃣ Egy hashtag posztjai (a hashtag-oldalhoz) — publikus + moderált, legújabb elöl.
 * A `tag` vezető `#`-je + kis/nagybetűje nem számít (a tárolt tagek normalizáltak).
 */
export async function listPostsByHashtag(tag: string, limit = 50): Promise<FeedPost[]> {
  if (!supabase) {
    return [];
  }
  const norm = (tag ?? '').replace(/^#+/, '').trim().toLowerCase();
  if (!norm) {
    return [];
  }
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('moderation_status', 'ok')
    .eq('visibility', 'public')
    .contains('hashtags', [norm])
    .order('promoted', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  return rows.map((r) => toPost(r, liked, saved));
}

/**
 * Posztok id-halmaz alapján (a kollekció-oldalhoz), a BEMENETI sorrendet megőrizve.
 * Az RLS a láthatóságot érvényesíti; a moderált-ki posztok kiesnek.
 */
export async function listPostsByIds(ids: string[]): Promise<FeedPost[]> {
  if (!supabase || ids.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .in('id', ids)
    .eq('moderation_status', 'ok');
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, toPost(r, liked, saved)]));
  return ids.map((id) => byId.get(id)).filter((p): p is FeedPost => !!p);
}
