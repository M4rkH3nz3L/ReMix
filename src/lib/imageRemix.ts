import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { createEmptyProject } from '@/lib/projectUtils';
import type { Asset, AudioClip, Project } from '@/types/project';
import type { FeedPost } from '@/types/social';

/** 🔀 Remix: a videós poszt a videóból, a kép-poszt a képeiből indul. */
export const canRemix = (post: FeedPost): boolean => post.remixable && (!!post.videoUri || !!post.images?.length);

export const remixRoute = (post: FeedPost, projectId: string): string =>
  post.images?.length ? `/studio/image/${projectId}` : post.sourceKind === 'audio' ? `/studio/audio/${projectId}` : `/editor/${projectId}`;

/**
 * 🎵 A hang-posztból (hang-projektből készült poszt) a remix hang-projekt: a poszt videójának kinyert
 * hangja egy klipként a zene-sávon, a forrás megjelölésével. Az eredeti sávokat itt sem kapja meg a
 * remixelő — csak azt, amit a poszt nyilvánosan ad.
 */
export function audioRemixProject(post: FeedPost, audio: { uri: string; duration: number }, ids: (prefix: string) => string = makeId): Project {
  const base = createEmptyProject(`Remix – ${post.title}`, post.aspectRatio ?? '9:16', undefined, 'audio');
  const assetId = ids('ast');
  const clip: AudioClip = { kind: 'audio', id: ids('clip'), assetId, uri: audio.uri, label: post.title, start: 0, duration: audio.duration, trimIn: 0, sourceDuration: audio.duration, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const asset: Asset = { id: assetId, kind: 'audio', uri: audio.uri, provider: 'local', name: post.title, duration: audio.duration };
  return {
    ...base,
    assets: [asset],
    tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)),
    remixOf: { projectId: post.projectId ?? post.id, name: post.creator.displayName, postId: post.id },
  };
}

/**
 * A kép-poszt lapjai új kép-projektbe kerülnek, lapként egy-egy fotórétegen. Az eredeti rétegeket
 * a remixelő nem kapja meg, mint a videónál: csak azt, amit a poszt nyilvánosan mutat.
 */
export function imageRemixProject(post: FeedPost): Project {
  const name = `Remix – ${post.title}`;
  const aspect = post.aspectRatio ?? '1:1';
  const docs = (post.images ?? []).map((uri, i) =>
    addLayer(createImageDoc(`${name} ${i + 1}`, aspect, () => makeId('lyr')), {
      kind: 'photo',
      id: makeId('lyr'),
      name: `${i + 1}`,
      uri,
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fit: 'contain',
    })
  );
  return {
    ...createEmptyProject(name, aspect, undefined, 'image'),
    imageDocs: docs,
    remixOf: { projectId: post.projectId ?? post.id, name: post.creator.displayName, postId: post.id },
  };
}
