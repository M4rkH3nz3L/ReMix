import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Polygon,
  Polyline,
  Stop,
} from 'react-native-svg';

import { cssBlendMode, palette } from '@/constants/editor';
import { polylinePoints } from '@/lib/draw';
import { sampleChannel } from '@/lib/keyframes';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** nyíl/csillag sokszögek 0–100-as koordinátákban — a renderrel megegyezőek */
const POLYGONS: Record<'arrow' | 'star', [number, number][]> = {
  arrow: [
    [0, 35], [60, 35], [60, 12], [100, 50], [60, 88], [60, 65], [0, 65],
  ],
  star: [
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70],
    [21, 91], [32, 57], [2, 35], [39, 35],
  ],
};

function polygonPoints(shape: 'arrow' | 'star', w: number, h: number): string {
  return POLYGONS[shape]
    .map(([px, py]) => `${(px / 100) * w},${(py / 100) * h}`)
    .join(' ');
}

interface Props {
  clip: ShapeClip;
  box: { w: number; h: number };
  editable: boolean;
  selected: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, position: { x: number; y: number }) => void;
  /** húzás közbeni pozíció-jelentés a segédvonalakhoz (null = húzás vége) */
  onDragLive?: (position: { x: number; y: number } | null) => void;
}

/**
 * Forma-réteg az előnézetben (Creative Canvas) — húzással mozgatható,
 * koppintásra kijelölhető; a render Chromium-rasztere vizuálisan ezt tükrözi.
 */
export function ShapeOverlay({
  clip,
  box,
  editable,
  selected,
  onSelect,
  onMove,
  onDragLive,
}: Props) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const reportLive = (dx: number, dy: number) => {
    onDragLive?.({
      x: clip.position.x + dx / box.w,
      y: clip.position.y + dy / box.h,
    });
  };

  const commitMove = (dx: number, dy: number) => {
    onDragLive?.(null);
    onMove?.(clip.id, {
      x: clamp(clip.position.x + dx / box.w, 0.02, 0.98),
      y: clamp(clip.position.y + dy / box.h, 0.02, 0.98),
    });
    dragX.value = 0;
    dragY.value = 0;
  };

  const pan = Gesture.Pan()
    .enabled(editable)
    .onUpdate((e) => {
      dragX.value = e.translationX;
      dragY.value = e.translationY;
      runOnJS(reportLive)(e.translationX, e.translationY);
    })
    .onEnd((e) => {
      runOnJS(commitMove)(e.translationX, e.translationY);
    });

  const tap = Gesture.Tap()
    .enabled(editable)
    .onEnd(() => {
      if (onSelect) {
        runOnJS(onSelect)(clip.id);
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  // 🎯 animált pozíció/méret a lejátszófejnél (követés/kulcskocka); kf nélkül a statikus érték
  const playhead = useEditorStore((s) => s.playhead);
  const tIn = clamp(playhead - clip.start, 0, clip.duration);
  const posX = sampleChannel(clip.keyframes?.x, tIn, clip.position.x);
  const posY = sampleChannel(clip.keyframes?.y, tIn, clip.position.y);
  const kfScale = sampleChannel(clip.keyframes?.scale, tIn, 1);

  const w = clip.w * kfScale * box.w;
  const h = (clip.shape === 'line' ? Math.max(clip.h, 0.004) : clip.h) * kfScale * box.h;
  // a vonalvastagság a vászon MAGASSÁGÁNAK %-a (ugyanaz a szabály, mint a
  // renderben) — így az előnézet és a beégetett videó vonala egyforma vastag
  const strokePx = Math.max(1, ((clip.strokeWidth ?? 0.9) / 100) * box.h);
  const radius =
    clip.shape === 'ellipse'
      ? Math.max(w, h)
      : (clip.cornerRadius ?? 0) * Math.min(w, h);
  const borderWidth = ((clip.borderWidth ?? 0) / 100) * box.h;

  const baseStyle = {
    width: w,
    height: h,
    borderRadius: radius,
    borderWidth,
    borderColor: clip.borderColor ?? 'transparent',
  };

  return (
    <GestureDetector gesture={Gesture.Simultaneous(tap, pan)}>
      <Animated.View
        style={[
          styles.wrap,
          {
            left: posX * box.w - w / 2,
            top: posY * box.h - h / 2,
            opacity: clip.opacity ?? 1,
            // valódi blend az előnézetben (RN új architektúra; CSS-névre fordítva)
            mixBlendMode: clip.blendMode ? cssBlendMode(clip.blendMode) : undefined,
          },
          // árnyék-közelítés (a valódi, sziluett-követő drop-shadow a renderben)
          clip.shadow ? styles.shadow : null,
          dragStyle,
          selected && editable ? styles.selected : null,
        ]}
      >
        {clip.shape === 'path' && clip.points && clip.points.length >= 2 ? (
          // ✏️ szabadkézi vonal — a renderrel AZONOS pont-sztringből, hogy az
          // előnézet és a beégetett videó ugyanazt rajzolja
          <Svg width={w} height={h} style={styles.pathSvg}>
            {clip.glow ? (
              <Polyline
                points={polylinePoints(clip.points, w, h)}
                fill="none"
                stroke={clip.glow.color}
                strokeWidth={strokePx * 2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.35}
              />
            ) : null}
            <Polyline
              points={polylinePoints(clip.points, w, h)}
              fill="none"
              stroke={clip.fill}
              strokeWidth={strokePx}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : clip.shape === 'arrow' || clip.shape === 'star' ? (
          <Svg width={w} height={h}>
            {clip.fillGradient ? (
              <Defs>
                <SvgGradient id={`g-${clip.id}`} x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={clip.fillGradient.from} />
                  <Stop offset="1" stopColor={clip.fillGradient.to} />
                </SvgGradient>
              </Defs>
            ) : null}
            <Polygon
              points={polygonPoints(clip.shape, w, h)}
              fill={clip.fillGradient ? `url(#g-${clip.id})` : clip.fill}
            />
          </Svg>
        ) : clip.imageUri ? (
          <Image
            source={{ uri: clip.imageUri }}
            style={[baseStyle, { overflow: 'hidden' }]}
            contentFit="contain"
          />
        ) : clip.fillGradient ? (
          <LinearGradient
            colors={[clip.fillGradient.from, clip.fillGradient.to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={baseStyle}
          />
        ) : (
          <View style={[baseStyle, { backgroundColor: clip.fill }]} />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pathSvg: {
    // a kerek vonalvég kilóghat a dobozból — ne vágja le
    overflow: 'visible',
  },
  wrap: {
    position: 'absolute',
  },
  shadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 6,
  },
  selected: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
    margin: -3,
    padding: 2,
  },
});
