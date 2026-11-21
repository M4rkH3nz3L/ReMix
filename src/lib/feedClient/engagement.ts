import { finiteNum, mapValid, str } from '@/lib/parseGuards';
import type { ViewEvent } from '@/lib/viewSignals';
import { requireSupabase, supabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';
import { logCaught } from '@/lib/logCaught';
import { currentUserId } from '@/lib/feedClient/session';

/** Töröl egy saját posztot. */
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
    (caught: unknown) => { logCaught('lib/feed.ts:recordView', caught); }
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
      (caught: unknown) => { logCaught('lib/feed.ts:recordViewEvent', caught); }
    );
}

/** Egy poszt nézési eseményei (a TULAJ analitikájához; a `viewSignals` aggregálja). */
export async function fetchViewEvents(postId: string): Promise<ViewEvent[]> {
  if (!supabase) {
    return [];
  }
  // névtelen sorok: az alkotó azt látja, mennyit néztek, azt nem, hogy ki
  const { data, error } = await supabase.rpc('post_view_stats', { p_post: postId });
  if (error) {
    logCaught('lib/feed.ts:fetchViewEvents', error);
    return [];
  }
  return mapValid(data, (o) => {
    const pid = str(o.post_id);
    if (!pid) {
      return null;
    }
    return {
      postId: pid,
      viewerId: str(o.viewer_key),
      watchedMs: finiteNum(o.watched_ms) ?? 0,
      durationMs: finiteNum(o.duration_ms) ?? 0,
    };
  });
}
