import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Polygon } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { DEFAULT_CORNERS, normalizeCorners, type Corners } from '@/lib/cornerPin';
import { canvasToLayerBox, layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import type { PhotoLayer } from '@/types/project';

/**
 * 🔲 4-sarkos perspektíva fogói (IMAGE-PROD S18): a fotó négy sarka a vásznon húzható, a tartalom a
 * négyszögre torzul. A fogó a réteg dobozán belül marad (a forgatott rétegen is a saját terében).
 * Húzás közben `onLive` élőben rajzol; a végén `onCommit` egy visszavonási lépés.
 */
export function CornerPinOverlay({
  layer,
  box,
  canvas,
  zoom = 1,
  onLive,
  onCommit,
}: {
  layer: PhotoLayer;
  box: { w: number; h: number };
  canvas: { width: number; height: number };
  zoom?: number;
  onLive: (corners: Corners) => void;
  onCommit: (corners: Corners) => void;
}) {
  const { t } = useTranslation();
  const start = useRef<{ corners: Corners; at: { x: number; y: number } } | null>(null);
  const pending = useRef<Corners | null>(null);
  const corners = normalizeCorners(layer.corners) ?? DEFAULT_CORNERS;
  const s = 1 / zoom;
  const onScreen = corners.map((c) => {
    const p = layerBoxToCanvas(c, layer, canvas);
    return { x: p.x * box.w, y: p.y * box.h };
  });

  const gesture = (i: number) =>
    Gesture.Pan()
      .withTestId(`pin-${i}`)
      .runOnJS(true)
      .maxPointers(1)
      .minDistance(0)
      .hitSlop(10)
      .onStart(() => {
        start.current = { corners, at: onScreen[i] };
        pending.current = null;
      })
      .onUpdate((e) => {
        const st = start.current;
        if (!st) return;
        const sx = st.at.x + e.translationX * s;
        const sy = st.at.y + e.translationY * s;
        const local = canvasToLayerBox({ x: sx / box.w, y: sy / box.h }, layer, canvas);
        const next = st.corners.map((c, k) => (k === i ? { x: Math.max(0, Math.min(1, local.x)), y: Math.max(0, Math.min(1, local.y)) } : c)) as Corners;
        pending.current = next;
        onLive(next);
      })
      .onEnd(() => {
        if (pending.current) onCommit(pending.current);
        pending.current = null;
        start.current = null;
      })
      .onFinalize((_e, ok) => {
        if (!ok) {
          pending.current = null;
          start.current = null;
        }
      });

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Polygon points={onScreen.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={palette.accent} strokeWidth={1.5 * s} strokeDasharray={[6 * s, 4 * s]} />
      </Svg>
      {onScreen.map((p, i) => (
        <GestureDetector key={i} gesture={gesture(i)}>
          <View accessibilityRole="adjustable" accessibilityLabel={t('studio.image.cornerPin.corner', { n: i + 1 })} style={[styles.handle, { left: p.x - 22, top: p.y - 22, transform: [{ scale: s }] }]}>
            <View style={styles.dot} />
          </View>
        </GestureDetector>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  handle: { position: 'absolute', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: palette.accent },
});
