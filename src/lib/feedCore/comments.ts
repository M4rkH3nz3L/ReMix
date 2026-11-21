import { reachableMediaUrl } from '@/lib/mediaUrl';
import type { Creator } from '@/types/social';

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

export interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  author_username: string | null;
  author_name: string | null;
  author_avatar: string | null;
  created_at: string;
}

export const COMMENT_COLUMNS =
  'id, post_id, author_id, body, author_username, author_name, author_avatar, created_at';

export function toComment(r: CommentRow): PostComment {
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
