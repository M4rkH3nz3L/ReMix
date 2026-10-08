import type { Asset, Clip, TrackType } from '@/types/project';

/**
 * 🗂️→🎬 A forrás-mappa egy assetéből KLIP építése a timeline-ra (a megadott
 * `start`-nál). Pure → tesztelhető; ugyanazt használja a Toolbar „insert"-je, a
 * dokkolt forrás-panel koppintása és a forrás→timeline húzás (EDITOR-UX §2.2).
 *
 * A kép/videó a `video` sávra, a hang a `music` sávra kerül (a kanonikus
 * alapértelmezés; a továbbküldést/kompatibilitást a `canHostClip` + `MOVE_CLIP`
 * adja). A `null` csak ismeretlen fajtánál.
 */
export function buildSourceClip(
  asset: Asset,
  start: number,
  makeId: () => string
): { trackType: TrackType; clip: Clip } | null {
  const at = Math.max(0, start);
  if (asset.kind === 'video') {
    const duration = asset.duration && asset.duration > 0 ? asset.duration : 5;
    return {
      trackType: 'video',
      clip: {
        kind: 'video',
        id: makeId(),
        start: at,
        duration,
        uri: asset.uri,
        trimIn: 0,
        sourceDuration: duration,
        speed: 1,
        volume: 1,
        filterId: 'none',
      },
    };
  }
  if (asset.kind === 'image') {
    return {
      trackType: 'video',
      clip: { kind: 'image', id: makeId(), start: at, duration: 4, uri: asset.uri, filterId: 'none' },
    };
  }
  if (asset.kind === 'audio') {
    const duration = asset.duration && asset.duration > 0 ? asset.duration : 5;
    return {
      trackType: 'music',
      clip: {
        kind: 'audio',
        id: makeId(),
        start: at,
        duration,
        trimIn: 0,
        sourceDuration: duration,
        uri: asset.uri,
        label: asset.name ?? '',
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        source: 'imported',
      },
    };
  }
  return null;
}
