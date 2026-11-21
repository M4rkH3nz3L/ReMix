import { reachableMediaUrl } from '@/lib/mediaUrl';
import { parseRemixManifest } from '@/lib/remixTracks';
import type { AspectRatio, Track } from '@/types/project';
import type { Creator, FeedPost, PostVisibility } from '@/types/social';

/** 🧱 A `posts` sor alakja + a sor → FeedPost leképezés (expo-mentes, tiszta). */

export interface PostRow {
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
  project_snapshot: { tracks?: Track[]; carousel?: string[] } | null;
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
export const POST_COLUMNS =
  'id, creator_id, project_id, title, description, hashtags, video_url, poster_url, aspect_ratio, duration_sec, project_snapshot, visibility, moderation_status, promoted, remixable, remix_of_post_id, remix_of_creator, music, creator_username, creator_name, creator_avatar, likes, comments, saves, views, remixes, created_at';

function toCreator(r: PostRow): Creator {
  return {
    id: r.creator_id,
    username: r.creator_username ?? r.creator_id.slice(0, 8),
    displayName: r.creator_name ?? r.creator_username ?? 'Creator',
    avatarUri: reachableMediaUrl(r.creator_avatar) ?? undefined,
  };
}

export function toPost(r: PostRow, liked: Set<string>, saved: Set<string>): FeedPost {
  // a project_snapshot jsonb KÉTFÉLE hasznot hordozhat: interaktív (hotspot) sáv
  // `{ tracks }`, és/vagy a carousel kép-lista `{ carousel }` (kép-projekt lapozható
  // megosztása). Visszafelé kompatibilis: a régi posztok csak `{ tracks }`-ot tároltak.
  const snap = (r.project_snapshot ?? null) as { tracks?: Track[]; carousel?: string[]; sourceKind?: string; remixTracks?: unknown } | null;
  const carousel = Array.isArray(snap?.carousel)
    ? snap!.carousel.map((u) => reachableMediaUrl(u)).filter((u): u is string => !!u)
    : undefined;
  return {
    id: r.id,
    creator: toCreator(r),
    title: r.title,
    description: r.description ?? '',
    hashtags: r.hashtags ?? [],
    videoUri: reachableMediaUrl(r.video_url),
    images: carousel && carousel.length > 0 ? carousel : undefined,
    posterUri: reachableMediaUrl(r.poster_url),
    aspectRatio: (r.aspect_ratio as AspectRatio) ?? '9:16',
    durationSec: r.duration_sec,
    projectId: r.project_id ?? undefined,
    interactive: snap?.tracks ? { tracks: snap.tracks } : undefined,
    rendered: !!r.video_url,
    ...(snap?.sourceKind === 'audio' ? { sourceKind: 'audio' as const } : {}),
    // 🔀 C3: a sáv-leírás idegen adat → ellenőrizve (csak hang-poszton és remixelhetőn)
    ...(snap?.sourceKind === 'audio' && r.remixable && snap.remixTracks ? (() => {
      const m = parseRemixManifest(snap.remixTracks);
      return m ? { remixTracks: m } : {};
    })() : {}),
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
