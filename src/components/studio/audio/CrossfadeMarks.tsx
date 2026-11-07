import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { crossfadePairs } from '@/lib/offlineMix';
import type { AudioClip } from '@/types/project';

/**
 * ✖️ Az automatikus crossfade-ek az idővonalon: az átfedő tartomány fölött X — ugyanazzal a
 * szabállyal, ahogy a keverő (`crossfadePairs`) halkít, így a kép és a hang nem tér el.
 */
export function CrossfadeMarks({ clips, pxPerSec, height, color }: { clips: AudioClip[]; pxPerSec: number; height: number; color: string }) {
  const pairs = useMemo(() => crossfadePairs(clips), [clips]);
  return (
    <>
      {pairs.map((p) => {
        const w = Math.max(2, p.length * pxPerSec);
        return (
          <View
            key={`${p.outId}>${p.inId}`}
            testID={`crossfade-${p.outId}-${p.inId}`}
            pointerEvents="none"
            style={[styles.mark, { left: p.start * pxPerSec, width: w, height, borderColor: color }]}
          >
            <Svg width={w} height={height}>
              <Line x1={0} y1={4} x2={w} y2={height - 4} stroke={color} strokeWidth={1.5} />
              <Line x1={0} y1={height - 4} x2={w} y2={4} stroke={color} strokeWidth={1.5} />
            </Svg>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', top: 0, borderLeftWidth: 1, borderRightWidth: 1, backgroundColor: '#ffffff14' },
});
