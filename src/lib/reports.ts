import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/store/authStore';

/**
 * 🚩 Tartalom-bejelentés (report) kliens. Bárki bejelenthet posztot/kommentet a
 * saját nevében (RLS); a `report.review` jog birtokosai (moderátor/admin) látják és
 * lezárják — az admin-panel „Bejelentések" szekciójában.
 */

export type ReportReason = 'spam' | 'offensive' | 'harassment' | 'illegal' | 'other';
export const REPORT_REASONS: ReportReason[] = ['spam', 'offensive', 'harassment', 'illegal', 'other'];

async function insertReport(row: Record<string, unknown>): Promise<void> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { error } = await sb.from('reports').insert({ ...row, reporter_id: uid });
  // 23505 = dedup (már bejelentetted ugyanezt) — ne dobjunk, csendben „kész"
  if (error && !/duplicate|23505/i.test(error.message)) {
    throw new Error(error.message);
  }
}

export async function reportPost(postId: string, reason: ReportReason, note?: string): Promise<void> {
  await insertReport({ target_type: 'post', post_id: postId, reason, note: note ?? null });
}

export async function reportComment(commentId: string, reason: ReportReason, note?: string): Promise<void> {
  await insertReport({ target_type: 'comment', comment_id: commentId, reason, note: note ?? null });
}

export interface ReportRow {
  id: string;
  targetType: 'post' | 'comment';
  postId: string | null;
  commentId: string | null;
  reason: string;
  note: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
}

interface RawReport {
  id: string;
  target_type: 'post' | 'comment';
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  note: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

/** A nyitott bejelentések (a `report.review` birtokosának — RLS). */
export async function listOpenReports(limit = 100): Promise<ReportRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('reports')
    .select('id, target_type, post_id, comment_id, reason, note, status, created_at')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(error.message);
  }
  return ((data ?? []) as RawReport[]).map((r) => ({
    id: r.id,
    targetType: r.target_type,
    postId: r.post_id,
    commentId: r.comment_id,
    reason: r.reason,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/** Bejelentés lezárása: `resolved` (kezelve) vagy `dismissed` (elutasítva). */
export async function resolveReport(id: string, status: 'resolved' | 'dismissed'): Promise<void> {
  const sb = requireSupabase();
  const uid = useAuth.getState().user?.id;
  const { error } = await sb
    .from('reports')
    .update({ status, resolved_by: uid ?? null, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw new Error(error.message);
  }
}
