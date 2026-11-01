import { Canvas, Circle, RadialGradient, vec } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

const STOPS = 16;

/** Az ffmpeg `vignette` sötétítése a középponttól mért arány szerint: cos⁴. */
export function vignetteFactor(angle: number, r: number): number {
  const c = Math.cos(angle * Math.min(1, r));
  return c * c * c * c;
}

/** 🔦 A dokumentum-szintű vignetták a vásznon: ugyanaz a görbe, mint a renderben, egymásra szorozva. */
export function DocVignette({ angles, box }: { angles: number[]; box: { w: number; h: number } }) {
  if (angles.length === 0) {
    return null;
  }
  const radius = Math.hypot(box.w, box.h) / 2;
  const positions = Array.from({ length: STOPS + 1 }, (_, i) => i / STOPS);
  const colors = positions.map((r) => `rgba(0,0,0,${(1 - angles.reduce((f, a) => f * vignetteFactor(a, r), 1)).toFixed(4)})`);
  const center = vec(box.w / 2, box.h / 2);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Circle cx={center.x} cy={center.y} r={radius}>
          <RadialGradient c={center} r={radius} colors={colors} positions={positions} />
        </Circle>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
