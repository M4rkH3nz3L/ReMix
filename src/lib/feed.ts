import { makeId } from '@/lib/id';
import type { ProgressUpdate } from '@/lib/progress';
import { migrateProject, projectDuration } from '@/lib/projectUtils';
import { renderProjectVersion, uploadMedia } from '@/lib/render';
import { saveProject } from '@/lib/storage';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import type { AspectRatio, Project } from '@/types/project';
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
  project_snapshot: Project | null;
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

const POST_COLUMNS =
  'id, creator_id, project_id, title, description, hashtags, video_url, poster_url, aspect_ratio, duration_sec, project_snapshot, visibility, moderation_status, promoted, remixable, remix_of_post_id, remix_of_creator, music, creator_username, creator_name, creator_avatar, likes, comments, saves, views, remixes, created_at';

function toCreator(r: PostRow): Creator {
  return {
    id: r.creator_id,
    username: r.creator_username ?? r.creator_id.slice(0, 8),
    displayName: r.creator_name ?? r.creator_username ?? 'Creator',
    avatarUri: r.creator_avatar ?? undefined,
  };
}

function toPost(r: PostRow, liked: Set<string>, saved: Set<string>): FeedPost {
  return {
    id: r.id,
    creator: toCreator(r),
    title: r.title,
    description: r.description ?? '',
    hashtags: r.hashtags ?? [],
    videoUri: r.video_url,
    posterUri: r.poster_url,
    aspectRatio: (r.aspect_ratio as AspectRatio) ?? '9:16',
    durationSec: r.duration_sec,
    projectId: r.project_id ?? undefined,
    projectSnapshot: r.project_snapshot ?? undefined,
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

/** A feed (foryou/latest = legújabb publikus; following = a követettjeim). */
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
    .eq('visibility', 'public')
    .eq('moderation_status', 'ok')
    // kiemelt (megfizetett) posztok előre, aztán legújabb
    .order('promoted', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (creatorIds) {
    q = q.in('creator_id', creatorIds);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as PostRow[];
  const { liked, saved } = await viewerEngagement(rows.map((r) => r.id));
  return rows.map((r) => toPost(r, liked, saved));
}

/** Egy csatorna: az alkotó posztjai + statisztika + követem-e. */
export interface ChannelData {
  userId: string;
  creator: Creator | null;
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

  return {
    userId,
    creator: posts[0]?.creator ?? null,
    posts,
    followers: s.followers ?? 0,
    following: s.following ?? 0,
    postCount: s.posts ?? posts.length,
    isFollowing,
    isMe: me === userId,
  };
}

async function creatorFields(): Promise<{ username: string | null; name: string | null }> {
  const user = useAuth.getState().user;
  const email = user?.email ?? null;
  const username = email ? email.split('@')[0] : null;
  let name: string | null = username;
  if (supabase && user?.id) {
    const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    name = (data?.full_name as string | undefined) || username;
  }
  return { username, name };
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
  const { username, name } = await creatorFields();
  const row = {
    creator_id: uid,
    project_id: project.id,
    title: project.seo?.title || project.name,
    description: project.seo?.description ?? null,
    hashtags: project.seo?.hashtags ?? [],
    video_url: opts?.videoUrl ?? null,
    poster_url: opts?.posterUrl ?? null,
    aspect_ratio: project.aspectRatio,
    duration_sec: Math.round(projectDuration(project) * 10) / 10,
    project_snapshot: { ...project },
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
    rendered = await renderProjectVersion(project, onProgress);
    updated = { ...updated, rendered };
    await saveProject(updated);
  }
  if (!rendered.url) {
    const url = await uploadMedia(rendered.uri, `${project.id}.mp4`);
    rendered = { ...rendered, url };
    updated = { ...updated, rendered };
    await saveProject(updated);
  }

  const post = await publishPost(updated, {
    visibility: opts?.visibility ?? 'public',
    videoUrl: rendered.url ?? null,
    posterUrl: rendered.posterUrl ?? null,
  });
  return { post, project: updated };
}

/** Töröl egy saját posztot. */
export async function deletePost(postId: string): Promise<void> {
  const sb = requireSupabase();
  await sb.from('posts').delete().eq('id', postId);
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
 * REMIX: a poszt project_snapshotjából ÚJ helyi projekt (a Studióban nyílik). A
 * remix-lánc attribúciója (remix_of_post_id) a `remixOf`-ban utazik, hogy a
 * későbbi publikálás beköthesse. Visszaadja az új projekt id-ját, vagy null.
 */
export async function remixFromPost(post: FeedPost): Promise<string | null> {
  const snap = post.projectSnapshot;
  if (!snap || !post.remixable) {
    return null;
  }
  const project = migrateProject({
    ...(snap as Project),
    id: makeId('prj'),
    name: `${post.title} (remix)`,
    remixOf: { projectId: post.projectId ?? post.id, name: post.creator.displayName },
  });
  await saveProject(project);
  return project.id;
}
