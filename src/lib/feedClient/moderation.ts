import { requireSupabase } from '@/lib/supabase';
import type { FeedPost } from '@/types/social';
import { POST_COLUMNS, toPost, type PostRow } from '@/lib/feedCore/postRows';
import { viewerEngagement } from '@/lib/feedClient/session';

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
