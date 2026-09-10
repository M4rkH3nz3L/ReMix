import { Directory, File, Paths } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Platform } from 'react-native';

import { makeId } from '@/lib/id';
import { sourceTimeAt } from '@/lib/projectUtils';
import type { Asset, ImageClip, VideoClip } from '@/types/project';

/**
 * Capture Frame (Creative Canvas): a playhead alatti videó-képkocka
 * szerkeszthető KÉP-assetté válik — a videósávra kerül a playheadtől (az
 * átfedésnél a későbbi klip győz, így freeze-frame hatást ad), és a Kép
 * eszközökkel (szűrő, maszk, animálás…) szerkeszthető tovább.
 */
export async function captureFrame(
  clip: VideoClip,
  playhead: number
): Promise<{ clip: ImageClip; asset: Asset } | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const sourceSec = sourceTimeAt(clip, playhead);
  const { uri } = await VideoThumbnails.getThumbnailAsync(clip.uri, {
    time: Math.max(0, Math.round(sourceSec * 1000)),
    quality: 1,
  });
  // tartós helyre másolás — a thumbnail-cache ideiglenes
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) {
    dir.create();
  }
  const target = new File(dir, `frame_${makeId('img')}.jpg`);
  new File(uri).copy(target);

  const asset: Asset = {
    id: makeId('ast'),
    kind: 'image',
    uri: target.uri,
    provider: 'local',
    name: 'Képkocka',
  };
  const image: ImageClip = {
    kind: 'image',
    id: makeId('clip'),
    start: playhead,
    duration: 2,
    uri: target.uri,
    assetId: asset.id,
    filterId: 'none',
  };
  return { clip: image, asset };
}
