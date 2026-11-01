import { StyleSheet, View } from 'react-native';

import { gridLines } from '@/lib/imageGrid';
import type { ImageGrid } from '@/types/project';

/** 🔲 Rács a vászon fölött: csak a szerkesztőben látszik, az exportba nem kerül. */
export function GridOverlay({ grid, canvas, box }: { grid: ImageGrid | undefined; canvas: { width: number; height: number }; box: { w: number; h: number } }) {
  const { xs, ys } = gridLines(grid, canvas, box);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {xs.map((x) => (
        <View key={`x${x}`} style={[styles.line, { left: x * box.w, top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
      ))}
      {ys.map((y) => (
        <View key={`y${y}`} style={[styles.line, { top: y * box.h, left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ line: { position: 'absolute', backgroundColor: 'rgba(124,92,255,0.55)' } });
