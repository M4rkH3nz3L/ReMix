import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createElement, type ReactNode, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * 🎞️ Videó-előnézet kártya — a videó ELSŐ KOCKÁJÁT mutatja (nem sablonos név),
 * és HOVER-re (web egérrel) vagy NYOMVA-tartásra (natív, ujjal) NÉMÁN belejátszik,
 * loopban. Kattintás/koppintás → `onPress`. Poszter hiányában is ad frame-et
 * (web), különben egy diszkrét play-jelvényes placeholdert.
 *
 * Cél: a csatorna-rács, a remix-lapozó és minden más videó-lista élő, interaktív
 * előnézetet kapjon — egy helyen definiálva.
 */
export interface VideoThumbProps {
  videoUri?: string | null;
  posterUri?: string | null;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** overlay-ek a thumb tetején (pl. nézettség-számláló) */
  children?: ReactNode;
  /** akadálymentes címke */
  label?: string;
}

function Placeholder() {
  return (
    <LinearGradient colors={['#1a1e2e', '#0c0d12', '#241a3a']} style={[StyleSheet.absoluteFill, styles.center]}>
      <Ionicons name="play" size={20} color="#ffffff99" />
    </LinearGradient>
  );
}

/** 🌐 WEB: natív <video> — első kocka (preload=metadata + seek) + hover-play. */
function WebThumb({ videoUri, posterUri, style, onPress, children, label }: VideoThumbProps) {
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  return (
    <Pressable
      style={[styles.wrap, style]}
      onPress={onPress}
      accessibilityLabel={label}
      onHoverIn={() => {
        const v = videoElRef.current;
        if (v) {
          v.currentTime = 0;
          void v.play().catch(() => {});
        }
      }}
      onHoverOut={() => {
        const v = videoElRef.current;
        if (v) {
          v.pause();
          try {
            v.currentTime = 0.05;
          } catch {
            // seek before metadata — nem baj
          }
        }
      }}
    >
      {videoUri
        ? createElement('video', {
            src: videoUri,
            poster: posterUri ?? undefined,
            muted: true,
            loop: true,
            playsInline: true,
            preload: 'metadata',
            tabIndex: -1,
            ref: (el: HTMLVideoElement | null) => {
              videoElRef.current = el;
              if (el) {
                // az első kocka megjelenítése (a metaadat betöltése után egy pici seek)
                el.onloadedmetadata = () => {
                  try {
                    el.currentTime = 0.05;
                  } catch {
                    // ignore
                  }
                };
              }
            },
            style: {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              backgroundColor: '#0c0d12',
            },
          })
        : posterUri
          ? <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          : <Placeholder />}
      {children}
    </Pressable>
  );
}

/** 📱 NATÍV: poszter/placeholder + NYOMVA-tartásra belejátszik (egy lejátszó / kártya). */
function NativeThumb({ videoUri, posterUri, style, onPress, children, label }: VideoThumbProps) {
  const [preview, setPreview] = useState(false);
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const start = () => {
    if (!videoUri) {
      return;
    }
    setPreview(true);
    player
      .replaceAsync(videoUri)
      .then(() => player.play())
      .catch(() => {});
  };
  const stop = () => {
    setPreview(false);
    player.pause();
  };
  return (
    <Pressable
      style={[styles.wrap, style]}
      onPress={onPress}
      onLongPress={start}
      onPressOut={stop}
      delayLongPress={160}
      accessibilityLabel={label}
    >
      {posterUri ? (
        <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <Placeholder />
      )}
      {preview && videoUri ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      ) : null}
      {children}
    </Pressable>
  );
}

export function VideoThumb(props: VideoThumbProps) {
  return Platform.OS === 'web' ? <WebThumb {...props} /> : <NativeThumb {...props} />;
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#0c0d12' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
