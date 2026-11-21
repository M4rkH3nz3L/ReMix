import { t as tr } from 'i18next';

import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { projectDuration } from '@/lib/projectUtils';
import { requireSupabase } from '@/lib/supabase';
import type { Project, Track } from '@/types/project';
import type { FeedPost, PostVisibility } from '@/types/social';
import type { RemixTracksManifest } from '@/lib/remixTracks';
import { POST_COLUMNS, toPost, type PostRow } from '@/lib/feedCore/postRows';
import { creatorFields, currentUserId } from '@/lib/feedClient/session';

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
    /** 🔀 az alkotó engedélye: remixelhető-e a poszt (B27 — eddig mindig true volt) */
    remixable?: boolean;
    /** 🖐️ carousel kép-poszt (kép-projekt lapozható megosztása): a lapok feltöltött URL-jei */
    carouselUrls?: string[];
    /** 🔀 C3: a remix a sávokat kapja (a feltöltött sáv-leírás) */
    remixTracks?: RemixTracksManifest;
  }
): Promise<FeedPost> {
  const sb = requireSupabase();
  const uid = currentUserId();
  if (!uid) {
    throw new Error('Nincs bejelentkezett felhasználó.');
  }
  const { username, name, avatar } = await creatorFields();
  // CSAK az interaktív (hotspot) réteget hordozzuk a poszton (feed-overlay) — a
  // teljes, szerkeszthető projektet SZÁNDÉKOSAN nem (a remix a videót importálja);
  // kivétel a C3: a hang-sávok leírása, ha az alkotó engedte.
  // A carousel kép-lista (ha van) ugyanebbe a jsonb-be megy (`carousel`).
  const interactiveTrack = project.tracks.find((tr) => tr.type === 'interactive');
  // 🎵 hang-projektből készült poszt: a remixe hang-projekt lesz (ugyanebben a jsonb-ben — migráció nélkül)
  const snapshot: { tracks?: Track[]; carousel?: string[]; sourceKind?: 'audio'; remixTracks?: RemixTracksManifest } = {};
  if (project.kind === 'audio') snapshot.sourceKind = 'audio';
  // 🔀 C3: csak ha az alkotó engedte (a hang-sávok — más projekt-adat nem kerül a posztba)
  if (project.kind === 'audio' && opts?.remixTracks && opts.remixable !== false) snapshot.remixTracks = opts.remixTracks;
  if (interactiveTrack && interactiveTrack.clips.length > 0) {
    snapshot.tracks = [interactiveTrack];
  }
  if (opts?.carouselUrls && opts.carouselUrls.length > 0) {
    snapshot.carousel = opts.carouselUrls;
  }
  const interactiveSnapshot = Object.keys(snapshot).length > 0 ? snapshot : null;
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
    remixable: opts?.remixable ?? true,
    remix_of_post_id: opts?.remixOfPostId ?? null,
    remix_of_creator: opts?.remixOfCreator ?? null,
    creator_username: username,
    creator_name: name,
  };
  const { data, error } = await sb.from('posts').insert(row).select(POST_COLUMNS).single();
  if (error) {
    // a szerver-oldali remix-kapu (posts_enforce_remix trigger) érthető üzenettel
    if (/remix_not_allowed/.test(error.message)) {
      throw new Error(tr('feed.remixNotAllowed'));
    }
    throw new Error(error.message);
  }
  // 📊 CSWCR: a poszt a lánc egyik „befejezése" (export · poszt · csomag) — csak helyi napló
  logCswcr({ type: 'post', projectId: project.id, kind: studioKindOf(project.kind) });
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
