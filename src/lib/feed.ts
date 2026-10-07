import { Platform } from 'react-native';

import { applyDiversity, rankBy, rankTrending, type PostSignals } from '@/lib/feedRanking';
import { makeId } from '@/lib/id';
import { finiteNum, mapValid, str } from '@/lib/parseGuards';
import type { ViewEvent } from '@/lib/viewSignals';
import { isLoopbackUrl, reachableMediaUrl } from '@/lib/mediaUrl';
import type { ProgressUpdate } from '@/lib/progress';
import { needsPoster, posterFrameTime } from '@/lib/feedMedia';
import { createEmptyProject, projectDuration } from '@/lib/projectUtils';
import { renderAndUploadWeb, renderProjectVersion, uploadMedia } from '@/lib/render';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { saveProject } from '@/lib/storage';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { Asset, AspectRatio, Project, Track, VideoClip } from '@/types/project';
import type { Creator, FeedMode, FeedPost, PostVisibility } from '@/types/social';

/**
 * 📱 Feed / csatorna kliens-réteg. A poszt a Project egy NÉZETE — a
 * `projectSnapshot` teszi a feed bármely videóját REMIXELHETŐVÉ a Studióban (ez
 * a „studio az alap" kapcsolat). Szerver-backend (Supabase), így a userek látják
 * egymás tartalmát. Az engagement szerver-hiteles (számlálók triggerrel).
 */

interface PostRow {
  id: string;
  creator_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  hashtags: string[] | null;
  video_url: string | null;
  poster_url: string | null;
  aspect_ratio: string;
  duration_sec: number;
  /** CSAK az interaktív (hotspot) réteg a feed-overlayhez — NEM a szerkeszthető projekt */
  project_snapshot: { tracks: Track[] } | null;
  visibility: string;
  moderation_status: string;
  promoted: boolean;
  remixable: boolean;
  remix_of_post_id: string | null;
  remix_of_creator: string | null;
  music: string | null;
  creator_username: string | null;
  creator_name: string | null;
  creator_avatar: string | null;
  likes: number;
  comments: number;
  saves: number;
  views: number;
  remixes: number;
  created_at: string;
}

// FONTOS: a `project_snapshot` CSAK az interaktív (hotspot) réteget hordozza a
// feed-overlayhez — NEM a teljes szerkeszthető projektet. A remix a renderelt
// videót importálja, az eredeti réteg-projektet a remixelő nem érheti el.
const POST_COLUMNS =
  'id, creator_id, project_id, title, description, hashtags, video_url, poster_url, aspect_ratio, duration_sec, project_snapshot, visibility, moderation_status, promoted, remixable, remix_of_post_id, remix_of_creator, music, creator_username, creator_name, creator_avatar, likes, comments, saves, views, remixes, created_at';

function toCreator(r: PostRow): Creator {
  return {
    id: r.creator_id,
    username: r.creator_username ?? r.creator_id.slice(0, 8),
    displayName: r.creator_name ?? r.creator_username ?? 'Creator',
    avatarUri: reachableMediaUrl(r.creator_avatar) ?? undefined,
  };
}

function toPost(r: PostRow, liked: Set<string>, saved: Set<string>): FeedPost {
  return {
    id: r.id,
    creator: toCreator(r),
    title: r.title,
    description: r.description ?? '',
    hashtags: r.hashtags ?? [],
    videoUri: reachableMediaUrl(r.video_url),
    posterUri: reachableMediaUrl(r.poster_url),
    aspectRatio: (r.aspect_ratio as AspectRatio) ?? '9:16',
    durationSec: r.duration_sec,
    projectId: r.project_id ?? undefined,
    interactive: r.project_snapshot ?? undefined,
    rendered: !!r.video_url,
    remixable: r.remixable,
    remixOfPostId: r.remix_of_post_id ?? undefined,
    remixOfCreator: r.remix_of_creator ?? undefined,
    visibility: r.visibility as PostVisibility,
    moderationStatus: r.moderation_status as FeedPost['moderationStatus'],
    promoted: r.promoted,
    music: r.music ?? undefined,
    createdAt: r.created_at,
    counts: { likes: r.likes, comments: r.comments, saves: r.saves, views: r.views, remixes: r.remixes },
    viewerLiked: liked.has(r.id),
    viewerSaved: saved.has(r.id),
  };
}

export function currentUserId(): string | null {
  return useAuth.getState().user?.id ?? null;
}

/** A néző like/save halmazai a megadott poszt-id-kre (egy körben). */
async function viewerEngagement(postIds: string[]): Promise<{ liked: Set<string>; saved: Set<string> }> {
  const uid = currentUserId();
  const liked = new Set<string>();
  const saved = new Set<string>();
  if (!supabase || !uid || postIds.length === 0) {
    return { liked, saved };
  }
  const [{ data: l }, { data: s }] = await Promise.all([
    supabase.from('post_likes').select('post_id').eq('user_id', uid).in('post_id', postIds),
    supabase.from('post_saves').select('post_id').eq('user_id', uid).in('post_id', postIds),
  ]);
  (l ?? []).forEach((row: { post_id: string }) => liked.add(row.post_id));
  (s ?? []).forEach((row: { post_id: string }) => saved.add(row.post_id));
  return { liked, saved };
}

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

/** Keresés eredménye: illeszkedő posztok + a belőlük kinyert egyedi alkotók. */
export interface SearchResults {
  posts: FeedPost[];
  creators: Creator[];
}

/**
 * 🔎 Keresés a nyilvános feedben: cím / alkotó-username / megjelenített név
 * (ilike), plusz hashtag-egyezés (a `#tag` és a sima szó is). A találatokból
 * kinyerjük az egyedi alkotókat is (a kereső „Alkotók" szekciójához). Csak
 * publikus + moderált (`ok`) posztok — az RLS is ezt engedi kijelentkezve is.
 */
export async function searchFeed(query: string, limit = 40): Promise<SearchResults> {
  const q = query.trim();
  if (!q) {
    return { posts: [], creators: [] };
  }
  const sb = requireSupabase();
  // ilike-biztos minta: a `%`, `_`, `\` speciális karaktereket kiöljük
  const safe = q.replace(/[%_\\]/g, ' ').trim();
  const like = `%${safe}%`;
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

  const [textRes, tagRes] = await Promise.all([textReq, tagReq]);
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

  // egyedi alkotók a találatokból (első előfordulás sorrendjében)
  const creatorMap = new Map<string, Creator>();
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

/** Egy csatorna: az alkotó posztjai + statisztika + követem-e. */
export interface ChannelData {
  userId: string;
  creator: Creator | null;
  /** 🖼️ borítókép (banner) URL — a csatorna-fejlécben; hiányában gradient-placeholder */
  coverUri?: string;
  // 🎨 Creator réteg (publikus mezők a public_profile-ból)
  bio?: string;
  aboutMe?: string;
  whatIMake?: string;
  workingOn?: string;
  creatorTypes?: string[];
  skills?: string[];
  interests?: string[];
  languages?: string[];
  posts: FeedPost[];
  followers: number;
  following: number;
  postCount: number;
  isFollowing: boolean;
  isMe: boolean;
}

export async function getChannel(userId: string): Promise<ChannelData> {
  const sb = requireSupabase();
  const me = currentUserId();
  const { data, error } = await sb
    .from('posts')
    .select(POST_COLUMNS)
    .eq('creator_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  const posts = rows.map((r) => toPost(r, liked, saved));

  const { data: stats } = await sb.rpc('channel_stats', { p_user: userId });
  const s = (stats ?? {}) as { followers?: number; following?: number; posts?: number };

  let isFollowing = false;
  if (me && me !== userId) {
    const { data: fr } = await sb
      .from('follows')
      .select('follower_id')
      .eq('follower_id', me)
      .eq('following_id', userId)
      .maybeSingle();
    isFollowing = !!fr;
  }

  // A csatorna identitása (név/avatar/borító) a profiles-ból — a PUBLIKUS mezőket
  // BÁRKINEK a public_profile SECURITY DEFINER függvény adja (a privát mezők — telefon/
  // születésnap — nem szivárognak). Így poszt nélküli csatorna is helyes fejlécet kap.
  const { data: profRows } = await sb.rpc('public_profile', { p_user: userId });
  const prof = (Array.isArray(profRows) ? profRows[0] : profRows) as
    | {
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        cover_url: string | null;
        bio?: string | null;
        about_me?: string | null;
        what_i_make?: string | null;
        working_on?: string | null;
        creator_types?: string[] | null;
        skills?: string[] | null;
        interests?: string[] | null;
        languages?: string[] | null;
      }
    | undefined;
  const emailHandle = me === userId ? (useAuth.getState().user?.email?.split('@')[0] ?? null) : null;
  // az EGYEDI username a profiles-ból (public_profile); csak fallback a poszt/email
  const username = prof?.username ?? posts[0]?.creator.username ?? emailHandle ?? userId.slice(0, 8);
  const creator: Creator = {
    id: userId,
    username,
    displayName: prof?.full_name || posts[0]?.creator.displayName || username,
    avatarUri: reachableMediaUrl(prof?.avatar_url ?? null) ?? posts[0]?.creator.avatarUri,
  };
  const coverUri = reachableMediaUrl(prof?.cover_url ?? null) ?? undefined;

  return {
    userId,
    creator,
    coverUri,
    bio: prof?.bio ?? undefined,
    aboutMe: prof?.about_me ?? undefined,
    whatIMake: prof?.what_i_make ?? undefined,
    workingOn: prof?.working_on ?? undefined,
    creatorTypes: prof?.creator_types ?? undefined,
    skills: prof?.skills ?? undefined,
    interests: prof?.interests ?? undefined,
    languages: prof?.languages ?? undefined,
    posts,
    followers: s.followers ?? 0,
    following: s.following ?? 0,
    postCount: s.posts ?? posts.length,
    isFollowing,
    isMe: me === userId,
  };
}

async function creatorFields(): Promise<{
  username: string | null;
  name: string | null;
  avatar: string | null;
}> {
  const user = useAuth.getState().user;
  const email = user?.email ?? null;
  const emailHandle = email ? email.split('@')[0] : null;
  // a poszt „username"-je az EGYEDI login-handle (profiles.username), NEM az
  // email-előtag; a display name a full_name (a kettő szándékosan külön mező)
  let username: string | null = emailHandle;
  let name: string | null = null;
  let avatar: string | null = null;
  if (supabase && user?.id) {
    const { data } = await supabase
      .from('profiles')
      .select('username, full_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
    username = (data?.username as string | undefined) || emailHandle;
    name = (data?.full_name as string | undefined) || username;
    avatar = (data?.avatar_url as string | undefined) ?? null;
  }
  return { username, name, avatar };
}

/**
 * Projekt megosztása a feedbe (poszt létrehozása). A `project_snapshot` a REMIX
 * alapja. A videó/borító feltöltése (Storage) későbbi lépés — addig a poszt
 * metaadattal + snapshottal jön (a saját projekt lokálisan lejátszható/remixelhető).
 */
export async function publishPost(
  project: Project,
  opts?: {
    visibility?: PostVisibility;
    posterUrl?: string | null;
    videoUrl?: string | null;
    remixOfPostId?: string;
    remixOfCreator?: string;
  }
): Promise<FeedPost> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { username, name, avatar } = await creatorFields();
  // CSAK az interaktív (hotspot) réteget hordozzuk a poszton (feed-overlay) — a
  // teljes, szerkeszthető projektet SZÁNDÉKOSAN nem (a remix a videót importálja).
  const interactiveTrack = project.tracks.find((tr) => tr.type === 'interactive');
  const interactiveSnapshot =
    interactiveTrack && interactiveTrack.clips.length > 0 ? { tracks: [interactiveTrack] } : null;
  const row = {
    creator_id: uid,
    creator_avatar: avatar,
    project_id: project.id,
    title: project.seo?.title || project.name,
    description: project.seo?.description ?? null,
    hashtags: project.seo?.hashtags ?? [],
    video_url: opts?.videoUrl ?? null,
    poster_url: opts?.posterUrl ?? null,
    aspect_ratio: project.aspectRatio,
    duration_sec: Math.round(projectDuration(project) * 10) / 10,
    project_snapshot: interactiveSnapshot,
    visibility: opts?.visibility ?? 'public',
    remixable: true,
    remix_of_post_id: opts?.remixOfPostId ?? null,
    remix_of_creator: opts?.remixOfCreator ?? null,
    creator_username: username,
    creator_name: name,
  };
  const { data, error } = await sb.from('posts').insert(row).select(POST_COLUMNS).single();
  if (error) {
    throw new Error(error.message);
  }
  return toPost(data as PostRow, new Set(), new Set());
}

/**
 * 📼 Live VOD megosztása a feedbe (D158). Az adás után a LiveKit Egress által S3-ba
 * rögzített MP4-ből rendes, **remixelhető** feed-poszt lesz: a poszt `video_url`-je a
 * VOD-é, a remix a megszokott módon importálja a videót. A `project` a `kind:'live'`
 * projekt (a cím/leírás/hashtag innen jön). A tényleges felvételhez a worker-en
 * `EGRESS_VOD=1` + S3 kell (különben az egress nem ad vissza `vodUrl`-t).
 */
export async function publishLiveVod(
  project: Project,
  vodUrl: string,
  opts?: { visibility?: PostVisibility; posterUrl?: string | null }
): Promise<FeedPost> {
  return publishPost(project, {
    videoUrl: vodUrl,
    posterUrl: opts?.posterUrl ?? null,
    visibility: opts?.visibility,
  });
}

/**
 * 🎞️ A projekt RENDERELT videójának megosztása a feedbe. Ha még nincs renderelt
 * változat → renderel + a projektre menti; ha még nincs feltöltve → feltölti a
 * publikus Storage-ba; majd posztol a valódi `video_url`-lel. Az így elkészült
 * renderelt változat (uri + url) a projekten marad (újramegosztáshoz).
 * Visszaadja a posztot + a frissített projektet.
 */
export async function publishRenderedProject(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void,
  opts?: { visibility?: PostVisibility }
): Promise<{ post: FeedPost; project: Project }> {
  let updated = project;
  let rendered = project.rendered;

  if (!rendered?.uri) {
    // 🌐 weben nincs on-device render → a SZERVER renderel + a kész MP4 a Storage-ba
    // kerül (a visszakapott `rendered` már url-lel). Natívan: eszköz/felhő render.
    rendered =
      Platform.OS === 'web'
        ? await renderAndUploadWeb(project, onProgress)
        : await renderProjectVersion(project, onProgress);
    updated = { ...updated, rendered };
    await saveProject(updated);
  }
  // ⚠️ A cache-elt `rendered.url` SZÁRMAZHAT egy korábbi (lokális) munkamenetből —
  // az a JELENLEGI (prod) kliensnek 404. Ezért ha nincs url VAGY loopback/lokális,
  // a videót ÚJRA feltöltjük a mostani (prod) tárba, projekt-mappába (<id>/video/…).
  if (!rendered.url || isLoopbackUrl(rendered.url)) {
    const url = await uploadMedia(rendered.uri, {
      projectId: project.id,
      kind: 'video',
      name: `${project.id}.mp4`,
    });
    rendered = { ...rendered, url };
    updated = { ...updated, rendered };
    await saveProject(updated);
  }

  // 🖼️ §2.8: borítókép a feed-rácshoz — ha nincs poster, a kész videó egy
  // reprezentatív kockájából generálunk egyet és feltöltjük (<id>/poster/…).
  // Best-effort: a getFilmstrip weben null-t ad, hibánál csendesen kimarad — a
  // publikálást SOHA nem buktatja. (A ffmpeg-transcoding + több-thumbnail a worker/infra.)
  if (needsPoster(rendered)) {
    try {
      const [poster] = await getFilmstrip(rendered.uri, [
        snapThumbTime(posterFrameTime(rendered.durationSec)),
      ]);
      if (poster) {
        const posterUrl = await uploadMedia(poster, {
          projectId: project.id,
          kind: 'poster',
          name: `${project.id}.jpg`,
        });
        rendered = { ...rendered, posterUrl };
        updated = { ...updated, rendered };
        await saveProject(updated);
      }
    } catch {
      // best-effort — poster nélkül is publikálható
    }
  }

  const post = await publishPost(updated, {
    visibility: opts?.visibility ?? 'public',
    videoUrl: rendered.url ?? null,
    posterUrl: rendered.posterUrl ?? null,
    // ha ez remix-projekt, csatoljuk a forrás-poszthoz (remix_of_post_id → lineage)
    remixOfPostId: updated.remixOf?.postId,
    remixOfCreator: updated.remixOf?.name,
  });
  return { post, project: updated };
}

/** Töröl egy saját posztot. */
/**
 * A saját posztok denormalizált avatarjának frissítése, amikor a profilkép változik
 * — így a KORÁBBI posztok is a friss profilképet mutatják a feedben. Best-effort.
 */
export async function syncMyPostsAvatar(avatarUrl: string | null): Promise<void> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return;
  }
  try {
    await supabase.from('posts').update({ creator_avatar: avatarUrl }).eq('creator_id', uid);
  } catch {
    // best-effort: a régi posztok maradnak a korábbi avatarral
  }
}

export async function deletePost(postId: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('posts').delete().eq('id', postId);
}

/**
 * 🔗 Egy projekthez tartozó ÖSSZES saját feed-poszt törlése (a projekt törlésekor):
 * „nincs projekt → nincs videó". Best-effort, csak a saját posztokra (RLS).
 */
export async function deletePostsForProject(projectId: string): Promise<void> {
  const uid = currentUserId();
  if (!supabase || !uid) {
    return;
  }
  await supabase.from('posts').delete().eq('creator_id', uid).eq('project_id', projectId);
}

export async function toggleLike(postId: string, liked: boolean): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    return;
  }
  if (liked) {
    await sb.from('post_likes').upsert({ post_id: postId, user_id: uid });
  } else {
    await sb.from('post_likes').delete().eq('post_id', postId).eq('user_id', uid);
  }
}

export async function toggleSave(postId: string, saved: boolean): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    return;
  }
  if (saved) {
    await sb.from('post_saves').upsert({ post_id: postId, user_id: uid });
  } else {
    await sb.from('post_saves').delete().eq('post_id', postId).eq('user_id', uid);
  }
}

export async function toggleFollow(userId: string, follow: boolean): Promise<void> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid || uid === userId) {
    return;
  }
  if (follow) {
    await sb.from('follows').upsert({ follower_id: uid, following_id: userId });
  } else {
    await sb.from('follows').delete().eq('follower_id', uid).eq('following_id', userId);
  }
}

/** Megtekintés rögzítése (szerver-számláló). Best-effort. */
export async function recordView(postId: string): Promise<void> {
  if (!supabase) {
    return;
  }
  await supabase.rpc('record_post_view', { p_post: postId }).then(
    () => {},
    () => {}
  );
}

/**
 * 👁️ A néző SAJÁT nézési eseménye (watched/duration ms) a `post_view_events`-be —
 * a For-You ranking VALÓS jeleihez ([viewSignals.ts](./viewSignals.ts) aggregálja).
 * Csak hitelesített néző (RLS: viewer_id = auth.uid()); best-effort (a hiba nem
 * zavarja a lejátszást, és forgalom-érzékeny → elnyeljük).
 */
export async function recordViewEvent(postId: string, watchedMs: number, durationMs: number): Promise<void> {
  if (!supabase) {
    return;
  }
  const uid = useAuth.getState().user?.id;
  if (!uid) {
    return;
  }
  await supabase
    .from('post_view_events')
    .insert({
      post_id: postId,
      viewer_id: uid,
      watched_ms: Math.max(0, Math.round(watchedMs)),
      duration_ms: Math.max(0, Math.round(durationMs)),
    })
    .then(
      () => {},
      () => {}
    );
}

/** Egy poszt nézési eseményei (a TULAJ analitikájához; a `viewSignals` aggregálja). */
export async function fetchViewEvents(postId: string): Promise<ViewEvent[]> {
  if (!supabase) {
    return [];
  }
  const { data, error } = await supabase
    .from('post_view_events')
    .select('post_id, viewer_id, watched_ms, duration_ms')
    .eq('post_id', postId);
  if (error) {
    return [];
  }
  return mapValid(data, (o) => {
    const pid = str(o.post_id);
    if (!pid) {
      return null;
    }
    return {
      postId: pid,
      viewerId: str(o.viewer_id),
      watchedMs: finiteNum(o.watched_ms) ?? 0,
      durationMs: finiteNum(o.duration_ms) ?? 0,
    };
  });
}

/**
 * REMIX (új modell): NEM az eredeti projektet klónozzuk, hanem a poszt RENDERELT
 * videóját (`videoUri`) importáljuk egy ÚJ, üres projektbe — a remixelő ezt
 * kiegészítheti, de az eredeti réteg-projektet nem éri el/szerkeszti. Az új projekt
 * logikusan elnevezve („Remix – <cím>"), és megjegyzi a forrás-posztot (`remixOf.postId`),
 * hogy publikáláskor a poszthoz csatolódjon. Visszaadja az új projekt id-ját, vagy null.
 */
export async function remixFromPost(post: FeedPost): Promise<string | null> {
  // renderelt videó nélkül nincs mit importálni
  if (!post.remixable || !post.videoUri) {
    return null;
  }
  const duration = post.durationSec > 0 ? post.durationSec : 5;
  const assetId = makeId('ast');
  const clip: VideoClip = {
    kind: 'video',
    id: makeId('clip'),
    start: 0,
    duration,
    uri: post.videoUri,
    assetId,
    trimIn: 0,
    sourceDuration: duration,
    speed: 1,
    volume: 1,
    filterId: 'none',
  };
  const asset: Asset = {
    id: assetId,
    kind: 'video',
    uri: post.videoUri,
    provider: 'remote',
    remoteUrl: post.videoUri,
    duration,
  };
  const base = createEmptyProject(`Remix – ${post.title}`, post.aspectRatio ?? '9:16');
  const project: Project = {
    ...base,
    assets: [asset],
    tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)),
    remixOf: { projectId: post.projectId ?? post.id, name: post.creator.displayName, postId: post.id },
  };
  await saveProject(project);
  return project.id;
}

// ── 💬 Kommentek ────────────────────────────────────────────────────────────

/** Egy komment (a szerző denormalizált — mint a posztnál, nincs cross-profil olvasás). */
export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  author: Creator;
  body: string;
  createdAt: string;
}

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  author_username: string | null;
  author_name: string | null;
  author_avatar: string | null;
  created_at: string;
}

const COMMENT_COLUMNS =
  'id, post_id, author_id, body, author_username, author_name, author_avatar, created_at';

function toComment(r: CommentRow): PostComment {
  return {
    id: r.id,
    postId: r.post_id,
    authorId: r.author_id,
    author: {
      id: r.author_id,
      username: r.author_username ?? r.author_id.slice(0, 8),
      displayName: r.author_name ?? r.author_username ?? 'Creator',
      avatarUri: reachableMediaUrl(r.author_avatar) ?? undefined,
    },
    body: r.body,
    createdAt: r.created_at,
  };
}

/** Egy poszt kommentjei (legújabb elöl). Az RLS csak látható posztokra enged. */
export async function listComments(postId: string, limit = 200): Promise<PostComment[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('post_comments')
    .select(COMMENT_COLUMNS)
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => toComment(r as CommentRow));
}

/** Komment hozzáadása (a szerző = a bejelentkezett user; a szám­lálót trigger tartja). */
export async function addComment(postId: string, body: string): Promise<PostComment> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const text = body.trim();
  if (!text) {
    throw new Error('Üres komment.');
  }
  const { username, name, avatar } = await creatorFields();
  const { data, error } = await sb
    .from('post_comments')
    .insert({
      post_id: postId,
      author_id: uid,
      body: text.slice(0, 2000),
      author_username: username,
      author_name: name,
      author_avatar: avatar,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) {
    throw new Error(error.message);
  }
  return toComment(data as CommentRow);
}

/** Monoton számláló egyedi realtime-topichoz (lásd a notifications mintát). */
let commentChannelSeq = 0;

/**
 * 🔴 Élő kommentek egy poszthoz: új komment INSERT-re értesít. A `post_comments`
 * tábla realtime-publikált; az RLS csak látható poszt kommentjeit engedi. A topic
 * egyedi (`:${++seq}`) a gyors újra-feliratkozás miatt (mint a notifications/chat).
 */
export function subscribeComments(
  postId: string,
  onInsert: (c: PostComment) => void
): () => void {
  const sb = supabase;
  if (!sb) {
    return () => {};
  }
  const channel = sb
    .channel(`post_comments:${postId}:${++commentChannelSeq}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` },
      (payload) => onInsert(toComment(payload.new as CommentRow))
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}

/**
 * Komment törlése. Az RLS engedi a SZERZŐnek a sajátját, ÉS a POSZT-TULAJnak
 * bármelyiket a saját posztján (moderáció) — a kliens csak megkísérli.
 */
export async function deleteComment(commentId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.from('post_comments').delete().eq('id', commentId);
  if (error) {
    throw new Error(error.message);
  }
}

// ── 🔀 Remix-felügyelet (tulajdonosi moderáció) ─────────────────────────────

/**
 * Egy posztból SZÁRMAZÓ remixek (a `removed`-ekkel együtt — az RLS engedi, ha én
 * vagyok a forrás-poszt tulajdonosa). A saját posztod remix-felügyeletéhez.
 */
export async function listRemixesOf(postId: string): Promise<FeedPost[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('posts')
    .select(POST_COLUMNS)
    .eq('remix_of_post_id', postId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  return rows.map((r) => toPost(r, liked, saved));
}

/**
 * A tartalmamból származó remix feed-láthatóságának moderálása (soft):
 * `'removed'` → kikerül a nyilvános feedből (visszafordítható), `'ok'` → vissza.
 * A jogosultságot a `moderate_remix` RPC ellenőrzi (csak a forrás-poszt tulaja).
 */
export async function moderateRemix(remixPostId: string, status: 'removed' | 'ok'): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('moderate_remix', { p_remix: remixPostId, p_status: status });
  if (error) {
    throw new Error(error.message);
  }
}
