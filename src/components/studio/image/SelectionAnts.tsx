import { Canvas, DashPathEffect, Path } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { selectionSkPath } from '@/components/studio/image/selectionPath';
import type { Selection } from '@/lib/selection';

/** ✂️ A kijelölés körvonala: fehér-fekete szaggatott vonal, így világos és sötét képen is látszik. */
export function SelectionAnts({ selection, box }: { selection: Selection; box: { w: number; h: number } }) {
  const path = useMemo(() => selectionSkPath(selection.ops, box.w, box.h, selection.invert), [selection, box.w, box.h]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Path path={path} style="stroke" strokeWidth={1.5} color="#000000" />
        <Path path={path} style="stroke" strokeWidth={1.5} color="#ffffff">
          <DashPathEffect intervals={[6, 6]} />
        </Path>
      </Canvas>
    </View>
  );
}
