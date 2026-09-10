import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getProxyUriSync } from '@/lib/proxy';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { clamp } from '@/lib/time';
import type { ImageClip, VideoClip } from '@/types/project';

interface Props {
  clip: VideoClip | ImageClip;
  /** a klip renderelt szélessége px-ben */
  widthPx: number;
  /** a klip renderelt magassága px-ben */
  heightPx: number;
}

const MAX_TILES = 24;

/**
 * Filmstrip a videó/kép klipek hátterében: négyzetes csempék a klip
 * trim/sebesség-helyes forrás-időpontjairól. A generálás debounce-olt
 * (pinch-zoom közben nem pörög), a kockák (uri, mp) kulcson cache-elődnek.
 */
export function ClipFilmstrip({ clip, widthPx, heightPx }: Props) {
  const tile = Math.max(24, heightPx);
  const count = clamp(Math.ceil(widthPx / tile), 1, MAX_TILES);

  const times = useMemo(() => {
    if (clip.kind === 'image') {
      return [];
    }
    return Array.from({ length: count }, (_, i) =>
      snapThumbTime(clip.trimIn + (i + 0.5) * (clip.duration / count) * clip.speed)
    );
  }, [clip, count]);
  const timesKey = times.join(',');

  const [thumbs, setThumbs] = useState<(string | null)[]>([]);

  useEffect(() => {
    if (clip.kind !== 'video') {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // ha van 720p proxy, a képkockák abból gyorsabban jönnek
      const sourceUri = getProxyUriSync(clip.uri) ?? clip.uri;
      getFilmstrip(sourceUri, times).then((uris) => {
        if (!cancelled) {
          setThumbs(uris);
        }
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // a timesKey lefedi a times tartalmát — identitás-váltásra nem kell újragenerálni
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.kind, clip.uri, timesKey]);

  if (clip.kind === 'image') {
    return (
      <View pointerEvents="none" style={styles.wrap}>
        <Image source={{ uri: clip.uri }} style={styles.fill} contentFit="cover" />
      </View>
    );
  }

  if (thumbs.length === 0) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.row}>
        {thumbs.map((uri, i) =>
          uri ? (
            <Image
              key={`${i}-${uri}`}
              source={{ uri }}
              style={{ width: tile, height: heightPx }}
              contentFit="cover"
            />
          ) : (
            <View key={i} style={{ width: tile, height: heightPx }} />
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 4.5,
    overflow: 'hidden',
    opacity: 0.75,
  },
  row: {
    flexDirection: 'row',
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
