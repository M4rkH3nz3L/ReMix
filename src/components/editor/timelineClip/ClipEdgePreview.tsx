import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { getProxyUriSync } from '@/lib/proxy';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { formatTime } from '@/lib/time';
import type { ClipEdgePreviewState } from '@/lib/timelineClipOps';
import type { Clip, VideoClip } from '@/types/project';

/** 🔍 clip-edge preview: a vágott szélen lévő képkocka + időkód */
export function ClipEdgePreview({ clip, edge }: { clip: Clip; edge: ClipEdgePreviewState }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.edgePreview,
        edge.side === 'left' ? styles.edgePreviewLeft : styles.edgePreviewRight,
      ]}
    >
      {clip.kind === 'video' ? <EdgeThumb clip={clip} srcTime={edge.srcTime} /> : null}
      {clip.kind === 'image' ? (
        <Image source={{ uri: clip.uri }} style={styles.edgeThumb} contentFit="cover" />
      ) : null}
      <Text style={styles.edgeTime}>{formatTime(edge.tlTime)}</Text>
    </View>
  );
}

/** Egyetlen képkocka a trim-szélen lévő forrás-időpontról (cache-elt, proxyból). */
function EdgeThumb({ clip, srcTime }: { clip: VideoClip; srcTime: number }) {
  const [uri, setUri] = useState<string | null>(null);
  const qTime = snapThumbTime(srcTime);
  useEffect(() => {
    if (clip.pending) {
      return;
    }
    let alive = true;
    const source = getProxyUriSync(clip.uri) ?? clip.uri;
    getFilmstrip(source, [qTime]).then((uris) => {
      if (alive) {
        setUri(uris[0] ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, [clip.uri, qTime, clip.pending]);
  return uri ? (
    <Image source={{ uri }} style={styles.edgeThumb} contentFit="cover" />
  ) : (
    <View style={styles.edgeThumb} />
  );
}

const styles = StyleSheet.create({
  edgePreview: {
    position: 'absolute',
    top: -52,
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: '#07080dee',
  },
  edgePreviewLeft: {
    left: -12,
  },
  edgePreviewRight: {
    right: -12,
  },
  edgeThumb: {
    width: 56,
    height: 32,
    borderRadius: 3,
    backgroundColor: palette.surfaceHigh,
  },
  edgeTime: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
