import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🟡 Moderáció-fellebbezés (devs/tasks/remix/16): eltávolított poszt tulajdonosa
 * fellebbezhet; a `report.review` jog birtokosa elbírálja (granted → a poszt
 * visszaáll a `moderate_post` RPC-vel, denied → marad removed).
 */

export async function submitAppeal(postId: string, note?: string): Promise<void> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { error } = await sb
    .from('content_appeals')
    .insert({ appellant_id: uid, post_id: postId, note: note ?? null });
  // 23505 = már van nyitott fellebbezés erre a posztra → csendben „kész"
  if (error && !/duplicate|23505/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export interface AppealRow {
  id: string;
  postId: string;
  postTitle: string | null;
  postDescription: string | null;
  note: string | null;
  createdAt: string;
}

interface RawAppeal {
  id: string;
  post_id: string;
  note: string | null;
  created_at: string;
  post: { title: string | null; description: string | null } | null;
}

/** A nyitott fellebbezések (a `report.review` birtokosának — RLS). */
export async function listOpenAppeals(limit = 100): Promise<AppealRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('content_appeals')
    .select('id, post_id, note, created_at, post:posts(title, description)')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as unknown as RawAppeal[]).map((r) => ({
    id: r.id,
    postId: r.post_id,
    postTitle: r.post?.title ?? null,
    postDescription: r.post?.description ?? null,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/**
 * Fellebbezés elbírálása. `granted` → a poszt visszaáll (`moderate_post(post,'ok')`
 * — ehhez `post.moderate` jog is kell), `denied` → marad removed. Mindkettő
 * rögzíti a döntést az appeal-soron.
 */
export async function resolveAppeal(
  id: string,
  postId: string,
  decision: 'granted' | 'denied',
): Promise<void> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  if (decision === 'granted') {
    const { error: modErr } = await sb.rpc('moderate_post', { p_post: postId, p_status: 'ok' });
    if (modErr) {
      throw new Error(modErr.message);
    }
  }
  const { error } = await sb
    .from('content_appeals')
    .update({ status: decision, resolved_by: uid ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}
