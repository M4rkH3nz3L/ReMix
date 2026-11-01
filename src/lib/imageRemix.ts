import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { createEmptyProject } from '@/lib/projectUtils';
import type { Project } from '@/types/project';
import type { FeedPost } from '@/types/social';

/** 🔀 Remix: a videós poszt a videóból, a kép-poszt a képeiből indul. */
export const canRemix = (post: FeedPost): boolean => post.remixable && (!!post.videoUri || !!post.images?.length);

export const remixRoute = (post: FeedPost, projectId: string): string =>
  post.images?.length ? `/studio/image/${projectId}` : `/editor/${projectId}`;

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
