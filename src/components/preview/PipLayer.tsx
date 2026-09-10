import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { palette } from '@/constants/editor';
import { activePipClips, sourceTimeAt } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * PiP-réteg (több videóréteg): a pip-sáv MINDEN, a lejátszófejnél aktív klipjét
 * a fő videó FÖLÉ rendereli (idősorrendben — a később kezdődő kerül felülre, a
 * render-overlay sorrendjével egyezően). Minden klip önálló `PipClipLayer`, saját
 * szinkronizált lejátszóval, gesztusaival és keretével.
 */
export function PipLayer({ box, editable }: { box: { w: number; h: number }; editable: boolean }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const clips = project ? activePipClips(project, playhead) : [];

  return (
    <>
      {clips.map((clip) => (
        <PipClipLayer key={clip.id} clip={clip} box={box} editable={editable} />
      ))}
    </>
  );
}

/**
 * Egyetlen PiP-klip: 2. `expo-video` lejátszó a mesterórához szinkronban
 * (forráscsere+seek+play/pause a fő videó mintájára), a `transform` szerint
 * méretezve+pozicionálva, húzható+csippenthető, a `pipFrame` szerint keretezve.
 */
function PipClipLayer({
  clip,
  box,
  editable,
}: {
  clip: VideoClip | ImageClip;
  box: { w: number; h: number };
  editable: boolean;
}) {
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const selectClip = useEditorStore((s) => s.selectClip);
  const asset = useEditorStore((s) =>
    clip.assetId ? s.project?.assets.find((a) => a.id === clip.assetId) : null
  );

  const videoClip = clip.kind === 'video' ? clip : null;
  const imageClip = clip.kind === 'image' ? clip : null;

  const player = useVideoPlayer(null);
  const loadedUri = useRef<string | null>(null);

  // forráscsere + kezdő-seek
  useEffect(() => {
    const uri = videoClip?.uri ?? null;
    if (loadedUri.current === uri) {
      return;
    }
    loadedUri.current = uri;
    player
      .replaceAsync(uri)
      .then(() => {
        if (!videoClip) {
          return;
        }
        const st = useEditorStore.getState();
        player.currentTime = sourceTimeAt(videoClip, st.playhead);
        if (st.isPlaying) {
          player.play();
        }
      })
      .catch(() => {});
  }, [player, videoClip]);

  // sebesség + hangerő
  useEffect(() => {
    if (videoClip) {
      player.playbackRate = videoClip.speed;
      player.volume = videoClip.volume ?? 1;
    }
  }, [player, videoClip]);

  // play/pause + álló seek
  useEffect(() => {
    if (isPlaying && videoClip) {
      player.play();
    } else {
      player.pause();
      if (videoClip && !isPlaying) {
        player.currentTime = sourceTimeAt(videoClip, playhead);
      }
    }
  }, [player, isPlaying, videoClip, playhead]);

  // ---- elrendezés (a renderrel egyezően: width = scale·W, aspect a forrásból) ----
  const tr = clip.transform ?? { scale: 0.32, x: 0.3, y: -0.32 };
  const aspect = asset?.width && asset?.height ? asset.height / asset.width : 1;
  const scale = Math.max(0.05, Math.min(1, tr.scale ?? 0.32));
  const pipW = scale * box.w;
  const pipH = pipW * aspect;
  const left = box.w / 2 - pipW / 2 + (tr.x ?? 0) * box.w;
  const top = box.h / 2 - pipH / 2 + (tr.y ?? 0) * box.h;

  // ---- gesztusok (élő shared-value, commit a végén) ----
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const pinch = useSharedValue(1);

  const commitMove = (ndx: number, ndy: number) => {
    updateClip(clip.id, {
      transform: { ...tr, x: (tr.x ?? 0) + ndx / box.w, y: (tr.y ?? 0) + ndy / box.h },
    });
  };
  const commitScale = (factor: number) => {
    const next = Math.max(0.08, Math.min(1, scale * factor));
    updateClip(clip.id, { transform: { ...tr, scale: next } });
  };

  const pan = Gesture.Pan()
    .enabled(editable)
    .onBegin(() => runOnJS(selectClip)(clip.id))
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX, e.translationY);
      dx.value = 0;
      dy.value = 0;
    });
  const pinchG = Gesture.Pinch()
    .enabled(editable)
    .onUpdate((e) => {
      pinch.value = e.scale;
    })
    .onEnd((e) => {
      runOnJS(commitScale)(e.scale);
      pinch.value = 1;
    });
  const composed = Gesture.Simultaneous(pan, pinchG);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { scale: pinch.value }],
  }));

  // 🎬 PiP-keret: a keret BELÜL (RN border-box, egyezik a render pad-jével), a
  // lekerekítés a rövidebb él arányában; az árnyék a NEM-vágó wrapperre kerül
  // (a tartalom overflow:hidden-je különben levágná).
  const frame = clip.pipFrame;
  const radiusPx = frame ? (frame.radius ?? 0) * Math.min(pipW, pipH) : 10;
  const borderW = frame?.borderWidth ? frame.borderWidth * box.h : 0;
  const borderCol = frame?.borderColor ?? '#ffffff';
  const isSelected = editable && selectedClipId === clip.id;

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={[
          styles.outer,
          { left, top, width: pipW, height: pipH, opacity: clip.opacity ?? 1 },
          frame?.shadow ? styles.shadow : null,
          animStyle,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radiusPx,
              overflow: 'hidden',
              backgroundColor: '#000',
              borderWidth: isSelected ? Math.max(2, borderW) : borderW,
              borderColor: isSelected ? palette.accent : borderCol,
              // 🎨 keverés a fő videóval (light-leak/screen-overlay) — a renderrel egyezik
              mixBlendMode: frame?.blendMode,
            },
          ]}
        >
          {videoClip ? (
            <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
          ) : imageClip ? (
            <Image source={{ uri: imageClip.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : null}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
});
