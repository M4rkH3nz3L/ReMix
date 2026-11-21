import { makeId } from '@/lib/id';
import { audioRemixProject, imageRemixProject } from '@/lib/imageRemix';
import { downloadToCache } from '@/lib/media';
import { extractVideoAudio } from '@/lib/videoAudioImport';
import { File } from 'expo-file-system';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import type { Asset, Project, VideoClip } from '@/types/project';
import type { FeedPost } from '@/types/social';
import { logCaught } from '@/lib/logCaught';
import { manifestUris, remixProjectFromManifest } from '@/lib/remixTracks';

/**
 * REMIX (új modell): NEM az eredeti projektet klónozzuk, hanem a poszt RENDERELT
 * videóját (`videoUri`) importáljuk egy ÚJ, üres projektbe — a remixelő ezt
 * kiegészítheti, de az eredeti réteg-projektet nem éri el/szerkeszti. Az új projekt
 * logikusan elnevezve („Remix – <cím>"), és megjegyzi a forrás-posztot (`remixOf.postId`),
 * hogy publikáláskor a poszthoz csatolódjon. Visszaadja az új projekt id-ját, vagy null.
 */
export async function remixFromPost(post: FeedPost): Promise<string | null> {
  if (post.remixable && post.images?.length) {
    const remix = imageRemixProject(post);
    await saveProject(remix);
    return remix.id;
  }
  // 🔀 C3: az alkotó a sávokat is adta → szerkeszthető sávok (a fájlok a projekt mappájába letöltve);
  // ha egy sem jön le, a régi út (a videó hangja)
  if (post.remixable && post.sourceKind === 'audio' && post.remixTracks) {
    const local = new Map<string, string>();
    for (const [i, url] of manifestUris(post.remixTracks).entries()) {
      const got = await downloadToCache(reachableMediaUrl(url) ?? url, `remix_${post.id}_${i}.${(url.split('.').pop() || 'wav').slice(0, 4)}`);
      if (got) local.set(url, got);
    }
    if (local.size > 0) {
      const base = createEmptyProject(`Remix – ${post.title}`, post.aspectRatio ?? '9:16', undefined, 'audio');
      const remix: Project = {
        ...remixProjectFromManifest(base, post.remixTracks, local, makeId),
        remixOf: { projectId: post.projectId ?? post.id, name: post.creator.displayName, postId: post.id },
      };
      await saveProject(remix);
      return remix.id;
    }
  }
  // 🎵 hang-poszt: a videó hangja kinyerve → hang-projekt (ha a kinyerés nem megy, a régi videós remix)
  if (post.remixable && post.sourceKind === 'audio' && post.videoUri) {
    const local = await downloadToCache(post.videoUri, `remix_${post.id}.mp4`);
    if (local) {
      const r = await extractVideoAudio(local, post.title);
      try {
        new File(local).delete();
      } catch (caught) {
        logCaught('lib/feed.ts:remixAudioCleanup', caught);
      }
      if (r.ok) {
        const remix = audioRemixProject(post, { uri: r.uri, duration: r.duration });
        await saveProject(remix);
        return remix.id;
      }
    }
  }
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
