import { requireSupabase, supabase } from '@/lib/supabase';
import { COMMENT_COLUMNS, toComment, type CommentRow, type PostComment } from '@/lib/feedCore/comments';
import { creatorFields, currentUserId } from '@/lib/feedClient/session';

// 💬 Kommentek — lekérés, hozzáadás, élő feliratkozás, törlés (a sor-leképezés: feedCore/comments)

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
