import { relinkImageDocs } from '@/lib/imageDocMedia';
import type { Clip, Project } from '@/types/project';

/**
 * Egy régi uri minden előfordulásának cseréje (klipek + kép-kitöltésű formák
 * imageUri-ja + asset-registry) — a logó/kivágás/vízjel rétegek is relinkelnek.
 */
export function relinkUri(project: Project, oldUri: string, newUri: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        let next = clip;
        if ('uri' in next && next.uri === oldUri) {
          next = { ...next, uri: newUri };
        }
        if (next.kind === 'shape' && next.imageUri === oldUri) {
          next = { ...next, imageUri: newUri };
        }
        return next;
      }),
    })),
    assets: project.assets.map((asset) =>
      asset.uri === oldUri ? { ...asset, uri: newUri } : asset
    ),
    imageDocs: relinkImageDocs(project.imageDocs, oldUri, newUri),
  };
}

export function replaceClip(project: Project, next: Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => (c.id === next.id ? next : c)),
    })),
  };
}
