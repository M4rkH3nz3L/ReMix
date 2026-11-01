import { makeId } from '@/lib/id';
import { withImageDocAssets } from '@/lib/imageDocMedia';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import type { ImageClip, ImageDoc, Project } from '@/types/project';

/**
 * 🖼️➡️🎬 Kép a videóba úgy, hogy szerkeszthető maradjon: a klip a lapított kép mellett a dokumentumot
 * is hordozza (`docId`), így a videó-szerkesztőből a rétegek újra megnyithatók. A PNG az azonnali
 * lejátszáshoz kell; a fotók a videó-projekt médiájába is bekerülnek.
 */
export function addImageDocToVideo(video: Project, doc: ImageDoc, renderedUri: string, duration = 4): Project {
  const clip: ImageClip = {
    kind: 'image',
    id: makeId('clip'),
    start: trackEnd(trackOf(video, 'video')),
    duration,
    uri: renderedUri,
    filterId: 'none',
    docId: doc.id,
  };
  const withClip: Project = {
    ...video,
    imageDocs: [...(video.imageDocs ?? []).filter((d) => d.id !== doc.id), doc],
    tracks: video.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [...tr.clips, clip] } : tr)),
    assets: [...video.assets, { id: makeId('ast'), kind: 'image', uri: renderedUri, provider: 'local', name: doc.name }],
  };
  return withImageDocAssets(withClip, doc);
}
