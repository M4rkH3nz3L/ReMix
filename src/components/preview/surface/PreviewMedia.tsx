import { Image } from 'expo-image';
import { VideoView, type VideoPlayer } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';

import { SkiaFilteredImage } from '@/components/preview/SkiaFilteredImage';
import { SkiaFilteredVideo } from '@/components/preview/SkiaFilteredVideo';
import { videoFill } from '@/components/preview/videoFill';
import { palette } from '@/constants/editor';
import { sourceTimeAt } from '@/lib/projectUtils';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * blur-háttér: a sávok kitöltése a klip cover-változatával — képnél
 * valódi blur, videónál ambient-közelítés (ugyanaz a player, a
 * valódi blur a renderben ég be). A transzform nem érinti.
 */
export function BlurBackdrop({
  videoClip,
  imageClip,
  player,
  imageSrcUri,
}: {
  videoClip: VideoClip | null;
  imageClip: ImageClip | null;
  player: VideoPlayer;
  imageSrcUri: string | null;
}) {
  return (videoClip ?? imageClip)?.backgroundFill === 'blur' ? (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {videoClip ? (
        <VideoView
          player={player}
          style={[videoFill, { opacity: 0.55 }]}
          contentFit="cover"
          nativeControls={false}
        />
      ) : imageClip ? (
        <Image
          source={{ uri: imageSrcUri ?? imageClip.uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={24}
        />
      ) : null}
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#00000055' }]}
      />
    </View>
  ) : null;
}

interface MediaLayerProps {
  videoClip: VideoClip | null;
  imageClip: ImageClip | null;
  player: VideoPlayer;
  playbackUri: string | null;
  imageSrcUri: string | null;
  box: { w: number; h: number };
  mediaOpacity: number;
  transformStyle: AnimatedStyle<ViewStyle>;
  videoSkiaActive: boolean;
  imageSkiaActive: boolean;
  playhead: number;
  isPlaying: boolean;
  /** az üres-állapot súgó látszik-e (nincs vizuális klip esetén) */
  showEmptyHint: boolean;
}

/** a fő média (videó/kép) a vászon-transzformmal — vagy az üres-állapot */
export function MediaLayer({
  videoClip,
  imageClip,
  player,
  playbackUri,
  imageSrcUri,
  box,
  mediaOpacity,
  transformStyle,
  videoSkiaActive,
  imageSkiaActive,
  playhead,
  isPlaying,
  showEmptyHint,
}: MediaLayerProps) {
  const { t } = useTranslation();
  return videoClip || imageClip ? (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: mediaOpacity }, transformStyle]}
    >
      {videoClip ? (
        // 🎬 A nyers VideoView VÁLTOZATLAN: ez adja az AUDIO-t + a teljes
        // playback-logikát (replaceAsync/seek/rate/volume). Ha van tényleges
        // grade/effekt (`videoSkiaActive`), FÖLÉ egy szűrt Skia-réteg kerül
        // (JSX-ben a VideoView UTÁN → fölé rajzol); amíg a Skia-frame null,
        // a nyers VideoView látszik alatta (nincs üres villanás). Szűrő
        // nélkül NINCS Skia → a VideoView pontosan a mai (nulla regresszió).
        <>
          <VideoView
            player={player}
            style={videoFill}
            contentFit="contain"
            nativeControls={false}
          />
          {videoSkiaActive && playbackUri ? (
            <SkiaFilteredVideo
              uri={playbackUri}
              box={box}
              contentFit="contain"
              sourceTime={sourceTimeAt(videoClip, playhead)}
              playing={isPlaying}
              adjust={videoClip.adjust}
              effects={videoClip.effects}
            />
          ) : null}
        </>
      ) : imageClip ? (
        // 🌫️ mélység-fókusznál a worker portré-blur változata megy
        (() => {
          const uri = imageClip.depthFocus?.previewUri ?? imageSrcUri ?? imageClip.uri;
          const fit = imageClip.backgroundFill === 'blur' ? 'contain' : 'cover';
          // 🎨 valódi grade/effekt-előnézet Skiával (ha hat); különben a nyers expo-image (perf)
          return imageSkiaActive ? (
            <SkiaFilteredImage
              uri={uri}
              box={box}
              contentFit={fit}
              adjust={imageClip.adjust}
              effects={imageClip.effects}
            />
          ) : (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={fit} />
          );
        })()
      ) : null}
    </Animated.View>
  ) : (
    <View style={styles.empty}>
      {/* az üres-állapot súgó NEM folyhat rá a látható overlay-ekre (szöveg/forma/hotspot),
          és kis preview-n (billentyűzet, nyitott lap) sem fér el — ott elhagyjuk (T1/3) */}
      {showEmptyHint ? (
        <Text style={styles.emptyText}>
          {t('editor.preview.emptyNoClip')}
          {'\n'}
          {t('editor.preview.emptyHint')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: palette.textDim,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
  },
});
