import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { type ReactNode, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { cssBlendMode, palette } from '@/constants/editor';
import { activePipClips, sourceTimeAt } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * PiP-réteg (több videóréteg): a pip-sáv MINDEN, a lejátszófejnél aktív klipjét
 * a fő videó FÖLÉ rendereli (idősorrendben — a később kezdődő kerül felülre, a
 * render-overlay sorrendjével egyezően). A VIDEÓ-klip saját szinkron lejátszót
 * kap; a KÉP-klip NEM hoz létre videolejátszót (a közös elrendezés/gesztus/keret
 * a `usePipClipLayout` hookban, hogy egy üresjárati natív player se induljon
 * feleslegesen — perf).
 */
export function PipLayer({ box, editable }: { box: { w: number; h: number }; editable: boolean }) {
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const clips = project ? activePipClips(project, playhead) : [];

  return (
    <>
      {clips.map((clip) =>
        clip.kind === 'video' ? (
          <PipVideoClip key={clip.id} clip={clip} box={box} editable={editable} />
        ) : (
          <PipImageClip key={clip.id} clip={clip} box={box} editable={editable} />
        )
      )}
    </>
  );
}

/**
 * Közös PiP-elrendezés: `transform` szerinti méret+pozíció, húzás+csippentés
 * (élő shared-value, commit a végén), és a `pipFrame` (lekerekítés/keret/árnyék/
 * blend). Nincs benne lejátszó — így a kép- és videó-változat is használhatja.
 */
function usePipClipLayout(
  clip: VideoClip | ImageClip,
  box: { w: number; h: number },
  editable: boolean
) {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const updateClip = useEditorStore((s) => s.updateClip);
  const selectClip = useEditorStore((s) => s.selectClip);
  const asset = useEditorStore((s) =>
    clip.assetId ? s.project?.assets.find((a) => a.id === clip.assetId) : null
  );

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

  return {
    composed,
    animStyle,
    left,
    top,
    pipW,
    pipH,
    opacity: clip.opacity ?? 1,
    shadow: !!frame?.shadow,
    radiusPx,
    borderW,
    borderCol,
    isSelected,
    blendMode: frame?.blendMode ? cssBlendMode(frame.blendMode) : undefined,
  };
}

/** Közös PiP-wrapper (gesztus + árnyékos külső + vágó belső); a média a `children`. */
function PipClipFrame({
  layout,
  children,
}: {
  layout: ReturnType<typeof usePipClipLayout>;
  children: ReactNode;
}) {
  return (
    <GestureDetector gesture={layout.composed}>
      <Animated.View
        style={[
          styles.outer,
          { left: layout.left, top: layout.top, width: layout.pipW, height: layout.pipH, opacity: layout.opacity },
          layout.shadow ? styles.shadow : null,
          layout.animStyle,
        ]}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: layout.radiusPx,
              overflow: 'hidden',
              backgroundColor: '#000',
              borderWidth: layout.isSelected ? Math.max(2, layout.borderW) : layout.borderW,
              borderColor: layout.isSelected ? palette.accent : layout.borderCol,
              // 🎨 keverés a fő videóval (light-leak/screen-overlay) — a renderrel egyezik (CSS-név)
              mixBlendMode: layout.blendMode,
            },
          ]}
        >
          {children}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Videó PiP-klip: 2. `expo-video` lejátszó a mesterórához szinkronban
 * (forráscsere+seek+play/pause a fő videó mintájára).
 */
function PipVideoClip({
  clip,
  box,
  editable,
}: {
  clip: VideoClip;
  box: { w: number; h: number };
  editable: boolean;
}) {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const playhead = useEditorStore((s) => s.playhead);
  const layout = usePipClipLayout(clip, box, editable);
  const player = useVideoPlayer(null);
  const loadedUri = useRef<string | null>(null);

  // forráscsere + kezdő-seek
  useEffect(() => {
    const uri = clip.uri;
    if (loadedUri.current === uri) {
      return;
    }
    loadedUri.current = uri;
    player
      .replaceAsync(uri)
      .then(() => {
        const st = useEditorStore.getState();
        player.currentTime = sourceTimeAt(clip, st.playhead);
        if (st.isPlaying) {
          player.play();
        }
      })
      .catch(() => {});
  }, [player, clip]);

  // sebesség + hangerő
  useEffect(() => {
    player.playbackRate = clip.speed;
    player.volume = clip.volume ?? 1;
  }, [player, clip]);

  // play/pause + álló seek
  useEffect(() => {
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
      player.currentTime = sourceTimeAt(clip, playhead);
    }
  }, [player, isPlaying, clip, playhead]);

  return (
    <PipClipFrame layout={layout}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
    </PipClipFrame>
  );
}

/** Kép PiP-klip: NINCS videolejátszó — csak a közös elrendezés + a kép. */
function PipImageClip({
  clip,
  box,
  editable,
}: {
  clip: ImageClip;
  box: { w: number; h: number };
  editable: boolean;
}) {
  const layout = usePipClipLayout(clip, box, editable);
  return (
    <PipClipFrame layout={layout}>
      <Image source={{ uri: clip.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
    </PipClipFrame>
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
